import type { Logger } from './logger.js';
import type { MessageRepo } from './store/messages.js';
import type { SettingsRepo } from './store/settings.js';
import type { Summarizer } from './summarize/summarizer.js';
import { formatTime } from './util/time.js';

const DAY = 24 * 3_600_000;
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
 * Digest window = since that chat's catch-up marker (max 24h back).
 */
export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  /** chatJid -> "YYYY-M-D" of the last fired day, to fire at most once per day. */
  private lastFired = new Map<string, string>();

  constructor(private readonly deps: SchedulerDeps) {}

  start(): void {
    this.timer = setInterval(() => {
      void this.tick(new Date());
    }, TICK_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(now: Date): Promise<void> {
    const hhmm = formatTime(now.getTime());
    const today = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;

    for (const entry of this.deps.settings.getSchedules()) {
      if (entry.time !== hhmm || this.lastFired.get(entry.chatJid) === today) continue;
      this.lastFired.set(entry.chatJid, today);
      await this.fire(entry.chatJid);
    }
  }

  private async fire(chatJid: string): Promise<void> {
    const { settings, messages, summarizer, sendToSelf, logger } = this.deps;
    const name = messages.chatName(chatJid) || chatJid;
    try {
      const marker = settings.getCatchupMarker(chatJid);
      const fromTs = Math.max(marker, Date.now() - DAY);
      const window = { fromTs, toTs: Date.now(), label: 'daily digest' };
      const summary = await summarizer.summarize(chatJid, window);
      if (!summary) {
        logger.info({ chatJid }, 'scheduled digest: no new messages');
        return;
      }
      settings.setCatchupMarker(chatJid, window.toTs);
      await sendToSelf(
        `⏰ *Daily digest — ${name}* (${summary.messageCount} messages)\n\n${summary.content}\n\n_Saved as summary #${summary.id}_`
      );
    } catch (err) {
      logger.error({ err, chatJid }, 'scheduled digest failed');
      await sendToSelf(`❌ Daily digest for *${name}* failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
