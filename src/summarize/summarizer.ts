import type { Logger } from '../logger.js';
import type { MessageRepo } from '../store/messages.js';
import type { SettingsRepo } from '../store/settings.js';
import type { SummaryRepo } from '../store/summaries.js';
import type { CitationRef, LlmProvider, SavedSummary, StoredMessage, SummaryWindow } from '../types.js';
import { formatTs } from '../util/time.js';
import { chunkLines, DEFAULT_CHUNK_OPTIONS } from './chunk.js';
import { chunkMapPrompt, reducePrompt, singleShotPrompt, SYSTEM_PROMPT } from './prompts.js';

const KIND_LABEL: Record<string, string> = {
  image: '📷 image',
  video: '🎬 video',
  sticker: '🩹 sticker',
  audio: '🎙 voice note',
  document: '📄 document',
};

/**
 * Map-reduce summarization over a message window.
 * Messages get 1-based indices [n]; the LLM cites them, and we map citations
 * back to internal message ids so the dashboard can show context for each.
 */
export class Summarizer {
  constructor(
    private readonly provider: LlmProvider,
    private readonly messages: MessageRepo,
    private readonly summaries: SummaryRepo,
    private readonly settings: SettingsRepo,
    private readonly logger: Logger
  ) {}

  /** Returns null when the window contains no messages. */
  async summarize(chatJid: string, window: SummaryWindow): Promise<SavedSummary | null> {
    const msgs = this.messages.inRange(chatJid, window.fromTs, window.toTs);
    if (msgs.length === 0) return null;

    const chatName = this.messages.chatName(chatJid) || chatJid;
    const interests = this.settings.getTopicProfile()?.interests ?? null;
    const lines = msgs.map((m, i) => renderLine(i + 1, m));
    const chunks = chunkLines(lines, DEFAULT_CHUNK_OPTIONS);

    this.logger.info(
      { chatName, messages: msgs.length, chunks: chunks.length, provider: this.provider.name },
      'summarizing'
    );

    let digest: string;
    if (chunks.length === 1) {
      digest = await this.provider.complete(
        SYSTEM_PROMPT,
        singleShotPrompt(chatName, window.label, chunks[0]!.join('\n'), interests)
      );
    } else {
      // Map phase runs chunks concurrently; reduce merges the partial notes.
      const partials = await Promise.all(
        chunks.map(async (chunk) =>
          this.provider.complete(SYSTEM_PROMPT, chunkMapPrompt(chatName, chunk.join('\n')))
        )
      );
      digest = await this.provider.complete(
        SYSTEM_PROMPT,
        reducePrompt(chatName, window.label, partials, interests)
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
   * Maps [n] citations back to message ids and appends a reference footer
   * (sender + time per citation) so citations are meaningful in WhatsApp too.
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
    const citations = citedIndices.map((n) => ({ n, messageId: msgs[n - 1]!.id }));

    const footer = citedIndices
      .slice(0, 25)
      .map((n) => {
        const m = msgs[n - 1]!;
        return `[${n}] ${m.senderName} · ${formatTs(m.timestamp)}`;
      })
      .join('\n');

    const content = footer ? `${digest.trim()}\n\n_Refs:_\n${footer}` : digest.trim();
    return { content, citations };
  }
}

function renderLine(index: number, m: StoredMessage): string {
  const media = KIND_LABEL[m.kind];
  const body = m.text ? (media ? `${media}: ${m.text}` : m.text) : (media ?? m.kind);
  const reply = m.quotedId ? ' (reply)' : '';
  const edited = m.edited ? ' (edited)' : '';
  return `[${index}] ${formatTs(m.timestamp)} ${m.senderName}${reply}${edited}: ${body}`;
}
