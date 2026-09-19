import type { Db } from './db.js';
import type { ScheduleEntry, TopicProfile } from '../types.js';
import { dayKey, dayStart } from '../util/time.js';

/**
 * Key-value store for small app state:
 *  - topic profile ("what I care about")
 *  - per-chat catch-up markers (our "unread" boundary)
 *  - daily digest schedules
 */
export class SettingsRepo {
  constructor(private readonly db: Db) {}

  private get(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  private set(key: string, value: string): void {
    this.db
      .prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      )
      .run(key, value);
  }

  getTopicProfile(): TopicProfile | null {
    const raw = this.get('topic_profile');
    return raw ? (JSON.parse(raw) as TopicProfile) : null;
  }

  setTopicProfile(interests: string, now: number): void {
    const profile: TopicProfile = { interests, updatedAt: now };
    this.set('topic_profile', JSON.stringify(profile));
  }

  /** Timestamp of the user's last catch-up for a chat (0 = never). */
  getCatchupMarker(chatJid: string): number {
    const raw = this.get(`catchup:${chatJid}`);
    return raw ? Number(raw) : 0;
  }

  setCatchupMarker(chatJid: string, ts: number): void {
    this.set(`catchup:${chatJid}`, String(ts));
  }

  getSchedules(): ScheduleEntry[] {
    const raw = this.get('schedules');
    return raw ? (JSON.parse(raw) as ScheduleEntry[]) : [];
  }

  /**
   * Local day ("YYYY-MM-DD") on which a chat's daily digest last fired.
   * Persisted rather than kept in memory so a restart cannot re-send a digest
   * that already went out today.
   */
  getLastDigestDay(chatJid: string): string | null {
    return this.get(`digest_day:${chatJid}`);
  }

  setLastDigestDay(chatJid: string, day: string): void {
    this.set(`digest_day:${chatJid}`, day);
  }

  /**
   * Set (or, with `time === null`, clear) a chat's daily digest time.
   *
   * If the new time has already passed today, today is marked as "already
   * fired" so scheduling "20:00" at 21:00 waits for tomorrow instead of firing
   * a digest the moment the next tick runs.
   */
  setSchedule(chatJid: string, time: string | null, now: number = Date.now()): void {
    const schedules = this.getSchedules().filter((s) => s.chatJid !== chatJid);
    if (time !== null) {
      schedules.push({ chatJid, time });
      const [hours, minutes] = time.split(':').map(Number);
      const dueAt = dayStart(now) + (hours ?? 0) * 3_600_000 + (minutes ?? 0) * 60_000;
      if (now >= dueAt) this.setLastDigestDay(chatJid, dayKey(now));
    }
    this.set('schedules', JSON.stringify(schedules));
  }
}
