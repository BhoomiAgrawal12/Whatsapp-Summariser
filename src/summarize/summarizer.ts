import type { Logger } from '../logger.js';
import type { MessageRepo } from '../store/messages.js';
import type { SettingsRepo } from '../store/settings.js';
import type { SummaryRepo } from '../store/summaries.js';
import type { CitationRef, LlmProvider, SavedSummary, StoredMessage, SummaryWindow } from '../types.js';
import { dayKey, daySpan, formatDayHeading, formatTime, formatTs } from '../util/time.js';
import { chunkLines, DEFAULT_CHUNK_OPTIONS } from './chunk.js';
import { chunkMapPrompt, reducePrompt, singleShotPrompt, SYSTEM_PROMPT } from './prompts.js';

const KIND_LABEL: Record<string, string> = {
  image: '📷 image',
  video: '🎬 video',
  sticker: '🩹 sticker',
  audio: '🎙 voice note',
  document: '📄 document',
};

/** Longest excerpt stored per citation; enough for WA Web search, short enough to stay cheap. */
const SNIPPET_LENGTH = 80;

export interface SummarizerOptions {
  /**
   * Base URL of the dashboard as reachable from the user's phone. When set, the
   * reference footer links each citation straight to its context view, which is
   * what makes `[n]` actionable from inside WhatsApp.
   */
  publicUrl?: string;
}

/**
 * Map-reduce summarization over a message window.
 *
 * Messages get 1-based indices `[n]`; the LLM cites them, and we map citations
 * back to message identity (internal id + WhatsApp id) so both the dashboard and
 * the Chrome extension can resolve a citation to the exact message.
 *
 * Windows spanning more than one calendar day are rendered and summarized
 * *date-wise*: each line carries its date and the digest is asked for one block
 * per day, so a multi-day range reads as a timeline rather than a blur.
 */
export class Summarizer {
  constructor(
    private readonly provider: LlmProvider,
    private readonly messages: MessageRepo,
    private readonly summaries: SummaryRepo,
    private readonly settings: SettingsRepo,
    private readonly logger: Logger,
    private readonly options: SummarizerOptions = {}
  ) {}

  /** Returns null when the window contains no messages. */
  async summarize(chatJid: string, window: SummaryWindow): Promise<SavedSummary | null> {
    const msgs = this.messages.inRange(chatJid, window.fromTs, window.toTs);
    if (msgs.length === 0) return null;

    const chatName = this.messages.chatName(chatJid) || chatJid;
    const interests = this.settings.getTopicProfile()?.interests ?? null;

    // Day-wise only matters when the messages themselves straddle days: a "last
    // 24h" window technically spans two dates but usually reads as one session.
    const days = new Set(msgs.map((m) => dayKey(m.timestamp)));
    const perDay = days.size > 1 && daySpan(window.fromTs, window.toTs) > 1;

    const lines = renderTranscript(msgs, perDay);
    const chunks = chunkLines(lines, DEFAULT_CHUNK_OPTIONS).map((chunk) =>
      perDay ? withLeadingDayHeading(chunk, msgs) : chunk
    );

    this.logger.info(
      { chatName, messages: msgs.length, days: days.size, perDay, chunks: chunks.length, provider: this.provider.name },
      'summarizing'
    );

    let digest: string;
    if (chunks.length === 1) {
      digest = await this.provider.complete(
        SYSTEM_PROMPT,
        singleShotPrompt(chatName, window.label, chunks[0]!.join('\n'), interests, perDay)
      );
    } else {
      // Map phase runs chunks concurrently; reduce merges the partial notes.
      const partials = await Promise.all(
        chunks.map(async (chunk) =>
          this.provider.complete(SYSTEM_PROMPT, chunkMapPrompt(chatName, chunk.join('\n'), perDay))
        )
      );
      digest = await this.provider.complete(
        SYSTEM_PROMPT,
        reducePrompt(chatName, window.label, partials, interests, perDay)
      );
    }

    const { content, citations } = this.resolveCitations(digest, msgs);
    const saved: Omit<SavedSummary, 'id'> = {
      chatJid,
      chatName,
      fromTs: window.fromTs,
      toTs: window.toTs,
      createdAt: Date.now(),
      content,
      citations,
      messageCount: msgs.length,
    };
    const id = this.summaries.save(saved);
    return { id, ...saved };
  }

  /**
   * Maps `[n]` citations back to messages and appends a reference footer
   * (sender + time, plus a dashboard link when one is configured) so a citation
   * is traceable to the exact message from WhatsApp itself, not only in the UI.
   */
  private resolveCitations(
    digest: string,
    msgs: StoredMessage[]
  ): { content: string; citations: CitationRef[] } {
    const citedIndices: number[] = [];
    for (const match of digest.matchAll(/\[(\d+)\]/g)) {
      const n = Number(match[1]);
      if (n >= 1 && n <= msgs.length && !citedIndices.includes(n)) citedIndices.push(n);
    }
    citedIndices.sort((a, b) => a - b);

    const citations: CitationRef[] = citedIndices.map((n) => {
      const m = msgs[n - 1]!;
      return {
        n,
        messageId: m.id,
        chatJid: m.chatJid,
        waMessageId: m.waMessageId,
        timestamp: m.timestamp,
        senderName: m.senderName,
        snippet: snippetOf(m),
      };
    });

    const base = this.options.publicUrl?.replace(/\/+$/, '');
    const footer = citations
      .slice(0, 25)
      .map((c) => {
        const link = base ? ` → ${base}/m/${c.messageId}` : '';
        return `[${c.n}] ${c.senderName} · ${formatTs(c.timestamp ?? 0)}${link}`;
      })
      .join('\n');

    // WhatsApp has no per-message deep link on mobile, so a citation cannot open
    // the group itself. Say where the link *does* go, rather than leaving the
    // reader to tap it and wonder why WhatsApp did not open.
    const heading = base ? '_Refs_ — tap to read the message in context:' : '_Refs:_';
    const content = footer ? `${digest.trim()}\n\n${heading}\n${footer}` : digest.trim();
    return { content, citations };
  }
}

/**
 * Number every message `[n]` and render it for the LLM.
 * In day-wise mode each day is introduced by a heading and lines carry only the
 * clock time; otherwise each line carries the full "01 Jul 14:32" stamp.
 */
export function renderTranscript(msgs: StoredMessage[], perDay: boolean): string[] {
  const lines: string[] = [];
  let currentDay = '';
  msgs.forEach((m, i) => {
    if (perDay) {
      const key = dayKey(m.timestamp);
      if (key !== currentDay) {
        currentDay = key;
        lines.push(`=== ${formatDayHeading(m.timestamp)} ===`);
      }
    }
    lines.push(renderLine(i + 1, m, perDay));
  });
  return lines;
}

function renderLine(index: number, m: StoredMessage, timeOnly: boolean): string {
  const media = KIND_LABEL[m.kind];
  const body = m.text ? (media ? `${media}: ${m.text}` : m.text) : (media ?? m.kind);
  const reply = m.quotedId ? ' (reply)' : '';
  const edited = m.edited ? ' (edited)' : '';
  const stamp = timeOnly ? formatTime(m.timestamp) : formatTs(m.timestamp);
  return `[${index}] ${stamp} ${m.senderName}${reply}${edited}: ${body}`;
}

/**
 * Chunking can cut the transcript between a day heading and its messages, which
 * would leave that chunk's dates unattributable. Re-state the heading at the top
 * of any chunk that does not already start with one.
 */
function withLeadingDayHeading(chunk: string[], msgs: StoredMessage[]): string[] {
  const first = chunk[0];
  if (!first || first.startsWith('===')) return chunk;
  const index = Number(/^\[(\d+)\]/.exec(first)?.[1] ?? '0');
  const msg = msgs[index - 1];
  return msg ? [`=== ${formatDayHeading(msg.timestamp)} ===`, ...chunk] : chunk;
}

function snippetOf(m: StoredMessage): string {
  const text = m.text.replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > SNIPPET_LENGTH ? text.slice(0, SNIPPET_LENGTH) : text;
}
