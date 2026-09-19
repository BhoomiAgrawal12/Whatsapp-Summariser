import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { Scheduler, scheduledMomentOn } from '../src/scheduler.js';
import { openDb, type Db } from '../src/store/db.js';
import { MessageRepo } from '../src/store/messages.js';
import { SettingsRepo } from '../src/store/settings.js';
import { SummaryRepo } from '../src/store/summaries.js';
import { Summarizer } from '../src/summarize/summarizer.js';
import type { LlmProvider } from '../src/types.js';
import { dayStart } from '../src/util/time.js';

const CHAT = 'sched@g.us';
const logger = pino({ level: 'silent' });

class FakeProvider implements LlmProvider {
  readonly name = 'fake';
  async complete(): Promise<string> {
    return 'digest [1]';
  }
}

/** Local timestamp of HH:MM on the day containing `base`. */
const at = (base: number, hours: number, minutes = 0): number =>
  dayStart(base) + hours * 3_600_000 + minutes * 60_000;

describe('Scheduler', () => {
  let dir: string;
  let db: Db;
  let settings: SettingsRepo;
  let messages: MessageRepo;
  let sent: string[];
  let scheduler: Scheduler;
  /** Noon today, so "18:00 today" is always in the future relative to it. */
  const today = at(Date.now(), 12);

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'wa-sched-'));
    db = openDb(dir);
    settings = new SettingsRepo(db);
    messages = new MessageRepo(db);
    const summaries = new SummaryRepo(db);
    messages.upsertChat(CHAT, 'Sched Group', true);
    messages.insert({
      chatJid: CHAT,
      waMessageId: 'S1',
      senderJid: 'u@s.whatsapp.net',
      senderName: 'User',
      timestamp: at(today, 9),
      text: 'morning',
      kind: 'conversation',
      quotedId: null,
      raw: null,
    });
    sent = [];
    scheduler = new Scheduler({
      settings,
      messages,
      summarizer: new Summarizer(new FakeProvider(), messages, summaries, settings, logger),
      sendToSelf: async (text) => void sent.push(text),
      logger,
    });
  });

  afterEach(async () => {
    db.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('does not fire before the scheduled time', async () => {
    settings.setSchedule(CHAT, '18:00', at(today, 8));
    await scheduler.tick(at(today, 17, 59));
    assert.equal(sent.length, 0);
  });

  it('fires once the time has passed, even if no tick landed on the minute', async () => {
    settings.setSchedule(CHAT, '18:00', at(today, 8));
    // 18:00 came and went while the process was busy; the next tick catches up.
    await scheduler.tick(at(today, 18, 47));
    assert.equal(sent.length, 1);
    assert.match(sent[0]!, /Daily digest — Sched Group/);
  });

  it('fires at most once per day, and survives a restart', async () => {
    settings.setSchedule(CHAT, '18:00', at(today, 8));
    await scheduler.tick(at(today, 18, 1));
    await scheduler.tick(at(today, 18, 31));
    assert.equal(sent.length, 1);

    // A fresh Scheduler reads the persisted marker rather than re-sending.
    const restarted = new Scheduler({
      settings,
      messages,
      summarizer: new Summarizer(new FakeProvider(), messages, new SummaryRepo(db), settings, logger),
      sendToSelf: async (text) => void sent.push(text),
      logger,
    });
    await restarted.tick(at(today, 19));
    assert.equal(sent.length, 1);
  });

  it('does not back-fire when a schedule is set after its time today', async () => {
    settings.setSchedule(CHAT, '08:00', at(today, 20));
    await scheduler.tick(at(today, 20, 1));
    assert.equal(sent.length, 0);
  });
});

describe('scheduledMomentOn', () => {
  const base = at(Date.now(), 12);

  it('resolves HH:MM against the local day of `now`', () => {
    assert.equal(scheduledMomentOn(base, '20:00'), at(base, 20));
    assert.equal(scheduledMomentOn(base, '7:05'), at(base, 7, 5));
  });

  it('rejects malformed times', () => {
    assert.equal(scheduledMomentOn(base, '25:00'), null);
    assert.equal(scheduledMomentOn(base, 'later'), null);
  });
});
