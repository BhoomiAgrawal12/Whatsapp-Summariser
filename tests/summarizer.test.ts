import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { openDb, type Db } from '../src/store/db.js';
import { MessageRepo } from '../src/store/messages.js';
import { SettingsRepo } from '../src/store/settings.js';
import { SummaryRepo } from '../src/store/summaries.js';
import { Summarizer } from '../src/summarize/summarizer.js';
import type { LlmProvider } from '../src/types.js';
import { dayEnd, dayStart } from '../src/util/time.js';

const CHAT = '123-456@g.us';
const logger = pino({ level: 'silent' });

/** Fake LLM: echoes a digest citing the first and third message. */
class FakeProvider implements LlmProvider {
  readonly name = 'fake';
  calls: string[] = [];

  async complete(_system: string, user: string): Promise<string> {
    this.calls.push(user);
    return '*📌 Overview*\nPeople planned dinner [1] and shared a link [3].';
  }
}

describe('Summarizer integration (temp DB, fake LLM)', () => {
  let dir: string;
  let db: Db;
  let messages: MessageRepo;
  let summaries: SummaryRepo;
  let settings: SettingsRepo;

  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'wa-sum-test-'));
    db = openDb(dir);
    messages = new MessageRepo(db);
    summaries = new SummaryRepo(db);
    settings = new SettingsRepo(db);

    messages.upsertChat(CHAT, 'Test Group', true);
    const base = Date.now() - 3_600_000;
    const texts = ['dinner at 9?', 'sounds good', 'check https://example.com', 'ok'];
    texts.forEach((text, i) =>
      messages.insert({
        chatJid: CHAT,
        waMessageId: `MSG${i}`,
        senderJid: `u${i}@s.whatsapp.net`,
        senderName: `User${i}`,
        timestamp: base + i * 60_000,
        text,
        kind: 'conversation',
        quotedId: null,
        raw: null,
      })
    );
  });

  after(async () => {
    db.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('summarizes a window, resolves citations and saves the result', async () => {
    const provider = new FakeProvider();
    const summarizer = new Summarizer(provider, messages, summaries, settings, logger);
    const summary = await summarizer.summarize(CHAT, {
      fromTs: 0,
      toTs: Date.now(),
      label: 'test window',
    });

    assert.ok(summary);
    assert.equal(summary.messageCount, 4);
    assert.equal(summary.chatName, 'Test Group');
    // Citations [1] and [3] resolved to the 1st and 3rd stored messages, carrying
    // the WhatsApp identity the extension needs to jump to the exact message.
    const stored = messages.inRange(CHAT, 0, Date.now());
    assert.deepEqual(
      summary.citations.map((c) => [c.n, c.messageId, c.waMessageId, c.chatJid, c.senderName, c.snippet]),
      [
        [1, stored[0]!.id, 'MSG0', CHAT, 'User0', 'dinner at 9?'],
        [3, stored[2]!.id, 'MSG2', CHAT, 'User2', 'check https://example.com'],
      ]
    );
    assert.equal(summary.citations[0]!.timestamp, stored[0]!.timestamp);
    // Reference footer appended for WhatsApp delivery.
    assert.match(summary.content, /_Refs:_/);
    assert.match(summary.content, /\[1\] User0/);
    // Prompt contained the indexed messages.
    assert.match(provider.calls[0]!, /\[1\].*User0.*dinner at 9\?/);
    // Persisted round-trip.
    const loaded = summaries.get(summary.id);
    assert.equal(loaded?.content, summary.content);
    assert.deepEqual(loaded?.citations, summary.citations);
  });

  it('returns null for an empty window', async () => {
    const summarizer = new Summarizer(new FakeProvider(), messages, summaries, settings, logger);
    const summary = await summarizer.summarize(CHAT, { fromTs: 1, toTs: 2, label: 'empty' });
    assert.equal(summary, null);
  });

  it('message context returns neighbourhood around a target', () => {
    const stored = messages.inRange(CHAT, 0, Date.now());
    const context = messages.context(stored[1]!.id, 2);
    assert.ok(context.length >= 3);
    assert.ok(context.some((m) => m.id === stored[1]!.id));
  });
});

describe('Summarizer date-wise behaviour', () => {
  let dir: string;
  let db: Db;
  let messages: MessageRepo;
  let summaries: SummaryRepo;
  let settings: SettingsRepo;

  /** Local noon on a given day offset from today, so tests never straddle midnight. */
  const noonDaysAgo = (days: number): number => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    d.setHours(12, 0, 0, 0);
    return d.getTime();
  };

  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'wa-sum-days-'));
    db = openDb(dir);
    messages = new MessageRepo(db);
    summaries = new SummaryRepo(db);
    settings = new SettingsRepo(db);
    messages.upsertChat(CHAT, 'Multi Day', true);
    [3, 2, 1].forEach((daysAgo, i) =>
      messages.insert({
        chatJid: CHAT,
        waMessageId: `D${i}`,
        senderJid: 'u@s.whatsapp.net',
        senderName: 'User',
        timestamp: noonDaysAgo(daysAgo),
        text: `message from ${daysAgo} days ago`,
        kind: 'conversation',
        quotedId: null,
        raw: null,
      })
    );
  });

  after(async () => {
    db.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('groups the transcript by day when the window spans several dates', async () => {
    const provider = new FakeProvider();
    const summarizer = new Summarizer(provider, messages, summaries, settings, logger);
    const summary = await summarizer.summarize(CHAT, {
      fromTs: dayStart(noonDaysAgo(3)),
      toTs: dayEnd(noonDaysAgo(1)),
      label: '3 days',
    });

    assert.ok(summary);
    assert.equal(summary.messageCount, 3);
    const prompt = provider.calls[0]!;
    // One "=== <weekday> <date> ===" heading per day, and clock-only stamps.
    assert.equal((prompt.match(/^=== /gm) ?? []).length, 3);
    assert.match(prompt, /Day by day/);
    assert.match(prompt, /^\[1\] \d{2}:\d{2} User: /m);
  });

  it('keeps the single-day layout when everything happened on one date', async () => {
    const provider = new FakeProvider();
    const summarizer = new Summarizer(provider, messages, summaries, settings, logger);
    const summary = await summarizer.summarize(CHAT, {
      fromTs: dayStart(noonDaysAgo(2)),
      toTs: dayEnd(noonDaysAgo(2)),
      label: 'one day',
    });

    assert.ok(summary);
    assert.equal(summary.messageCount, 1);
    const prompt = provider.calls[0]!;
    assert.doesNotMatch(prompt, /^=== /m);
    assert.match(prompt, /Topics/);
  });

  it('links citations to the dashboard when a public URL is configured', async () => {
    const summarizer = new Summarizer(new FakeProvider(), messages, summaries, settings, logger, {
      publicUrl: 'http://192.168.1.5:8790/',
    });
    const summary = await summarizer.summarize(CHAT, {
      fromTs: dayStart(noonDaysAgo(3)),
      toTs: dayEnd(noonDaysAgo(1)),
      label: '3 days',
    });
    assert.ok(summary);
    assert.match(summary.content, /http:\/\/192\.168\.1\.5:8790\/m\/\d+/);
  });
});
