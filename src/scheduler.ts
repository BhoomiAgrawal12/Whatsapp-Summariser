import type { Logger } from './logger.js';
import type { MessageRepo } from './store/messages.js';
import type { SettingsRepo } from './store/settings.js';
import type { Summarizer } from './summarize/summarizer.js';
import { DAY_MS, dayKey, dayStart, formatRange } from './util/time.js';

const TICK_MS = 30_000;

export interface SchedulerDeps {
  settings: SettingsRepo;
  messages: MessageRepo;
  summarizer: Summarizer;
  sendToSelf(text: string): Promise<void>;
  logger: Logger;
}

/**
 * Fires daily digests at their configured "HH:MM" (local time).
 *
 * A digest is due when today's scheduled moment has *passed* and today's digest
 * has not been sent yet — not when a tick happens to land inside the scheduled
 * minute. The old exact-minute match silently skipped a whole day whenever the
 * process was busy, asleep or restarting at that minute; the "already fired"
 * marker is persisted for the same reason.
 *
 * Digest window = since that chat's catch-up marker, capped at 24h back.
 */
export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  /** Guards against overlapping runs for the same chat (LLM calls take a while). */
  private running = new Set<string>();

  constructor(private readonly deps: SchedulerDeps) {}

  start(): void {
    this.timer = setInterval(() => {
      void this.tick(Date.now());
    }, TICK_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Exposed for tests: runs one scheduling pass at the given instant. */
  async tick(now: number): Promise<void> {
    const today = dayKey(now);

    for (const entry of this.deps.settings.getSchedules()) {
      if (this.running.has(entry.chatJid)) continue;
      if (this.deps.settings.getLastDigestDay(entry.chatJid) === today) continue;

      const dueAt = scheduledMomentOn(now, entry.time);
      if (dueAt === null || now < dueAt) continue;

      // Mark before sending: a failure must not retry in a tight 30s loop.
      this.deps.settings.setLastDigestDay(entry.chatJid, today);
      this.running.add(entry.chatJid);
      try {
        await this.fire(entry.chatJid, now);
      } finally {
        this.running.delete(entry.chatJid);
      }
    }
  }

  private async fire(chatJid: string, now: number): Promise<void> {
    const { settings, messages, summarizer, sendToSelf, logger } = this.deps;
    const name = messages.chatName(chatJid) || chatJid;
    try {
      const marker = settings.getCatchupMarker(chatJid);
      const fromTs = Math.max(marker, now - DAY_MS);
      const window = {
        fromTs,
        toTs: now,
        label: `daily digest (${formatRange(fromTs, now)})`,
      };
      const summary = await summarizer.summarize(chatJid, window);
      if (!summary) {
        logger.info({ chatJid }, 'scheduled digest: no new messages');
        return;
      }
      settings.setCatchupMarker(chatJid, window.toTs);
      await sendToSelf(
        `⏰ *Daily digest — ${name}* · ${formatRange(fromTs, now)} (${summary.messageCount} messages)\n\n${summary.content}\n\n_Saved as summary #${summary.id}_`
      );
    } catch (err) {
      logger.error({ err, chatJid }, 'scheduled digest failed');
      await sendToSelf(`❌ Daily digest for *${name}* failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/** Local timestamp of "HH:MM today", or null when the stored time is malformed. */
export function scheduledMomentOn(now: number, hhmm: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return dayStart(now) + hours * 3_600_000 + minutes * 60_000;
}
