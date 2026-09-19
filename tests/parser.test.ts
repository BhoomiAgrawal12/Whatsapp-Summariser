import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, parseWindowPhrase, splitTokens, takeTrailingWindow } from '../src/commands/parser.js';

const NOW = new Date(2026, 6, 2, 12, 0, 0).getTime(); // 2 Jul 2026 12:00 local
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('splitTokens', () => {
  it('splits on spaces and keeps quoted strings together', () => {
    assert.deepEqual(splitTokens('/sum "family group" 2d'), ['/sum', 'family group', '2d']);
  });
});

describe('takeTrailingWindow', () => {
  it('parses relative hours', () => {
    const { window, consumed } = takeTrailingWindow(['foo', '6h'], NOW);
    assert.equal(consumed, 1);
    assert.equal(window?.fromTs, NOW - 6 * HOUR);
    assert.equal(window?.toTs, NOW);
  });

  it('parses relative days and weeks', () => {
    assert.equal(takeTrailingWindow(['2d'], NOW).window?.fromTs, NOW - 2 * DAY);
    assert.equal(takeTrailingWindow(['3w'], NOW).window?.fromTs, NOW - 21 * DAY);
    assert.equal(takeTrailingWindow(['6', 'hours'], NOW).window?.fromTs, NOW - 6 * HOUR);
  });

  it('parses today', () => {
    const { window } = takeTrailingWindow(['today'], NOW);
    assert.equal(window?.fromTs, new Date(2026, 6, 2, 0, 0, 0, 0).getTime());
    assert.equal(window?.toTs, NOW);
  });

  it('parses a date range', () => {
    const { window, consumed } = takeTrailingWindow(['x', '2026-07-01..2026-07-02'], NOW);
    assert.equal(consumed, 1);
    assert.equal(window?.fromTs, new Date(2026, 6, 1, 0, 0, 0, 0).getTime());
    assert.equal(window?.toTs, new Date(2026, 6, 2, 23, 59, 59, 999).getTime());
  });

  it('parses a datetime range spanning multiple tokens', () => {
    const tokens = ['tech', 'group', '2026-07-01', '09:00..2026-07-01', '18:00'];
    const { window, consumed } = takeTrailingWindow(tokens, NOW);
    assert.equal(consumed, 3);
    assert.equal(window?.fromTs, new Date(2026, 6, 1, 9, 0).getTime());
    assert.equal(window?.toTs, new Date(2026, 6, 1, 18, 0).getTime());
  });

  it('consumes nothing when there is no window', () => {
    const { window, consumed } = takeTrailingWindow(['family', 'group'], NOW);
    assert.equal(window, null);
    assert.equal(consumed, 0);
  });
});

describe('parseCommand', () => {
  it('ignores non-commands', () => {
    assert.equal(parseCommand('hello there', NOW), null);
  });

  it('parses /sum with group name and window', () => {
    const cmd = parseCommand('/sum family group 2d', NOW);
    assert.ok(cmd?.type === 'sum');
    assert.equal(cmd.group, 'family group');
    assert.match(cmd.window?.label ?? '', /^last 2d \(/);
  });

  it('parses /sum without window', () => {
    const cmd = parseCommand('/sum "tech talks"', NOW);
    assert.ok(cmd?.type === 'sum');
    assert.equal(cmd.group, 'tech talks');
    assert.equal(cmd.window, null);
  });

  it('parses /sum with datetime range', () => {
    const cmd = parseCommand('/sum tech 2026-07-01 09:00..2026-07-01 18:00', NOW);
    assert.ok(cmd?.type === 'sum');
    assert.equal(cmd.group, 'tech');
    assert.ok(cmd.window);
  });

  it('parses /unread', () => {
    const cmd = parseCommand('/unread #3', NOW);
    assert.ok(cmd?.type === 'unread');
    assert.equal(cmd.group, '#3');
  });

  it('parses /topics set', () => {
    const cmd = parseCommand('/topics set tech talks, AI tools', NOW);
    assert.ok(cmd?.type === 'topics-set');
    assert.equal(cmd.interests, 'tech talks, AI tools');
  });

  it('parses /schedule variants', () => {
    assert.ok(parseCommand('/schedule list', NOW)?.type === 'schedule-list');
    const set = parseCommand('/schedule family 20:00', NOW);
    assert.ok(set?.type === 'schedule-set');
    assert.equal(set.group, 'family');
    assert.equal(set.time, '20:00');
    const off = parseCommand('/schedule family off', NOW);
    assert.ok(off?.type === 'schedule-off');
  });

  it('flags unknown commands', () => {
    assert.ok(parseCommand('/nope', NOW)?.type === 'invalid');
  });
});

describe('date-wise windows', () => {
  const day = (y: number, m: number, d: number, h = 0, mi = 0, s = 0, ms = 0) =>
    new Date(y, m, d, h, mi, s, ms).getTime();

  it('treats a bare date as that whole calendar day', () => {
    const cmd = parseCommand('/sum tech 2026-07-01', NOW);
    assert.ok(cmd?.type === 'sum');
    assert.equal(cmd.group, 'tech');
    assert.equal(cmd.window?.fromTs, day(2026, 6, 1));
    assert.equal(cmd.window?.toTs, day(2026, 6, 1, 23, 59, 59, 999));
  });

  it('accepts day-first and month-name date forms', () => {
    for (const written of ['01/07/2026', '01-07-2026', '1 Jul 2026', 'Jul 1 2026', '1 July 2026']) {
      const window = parseWindowPhrase(written, NOW);
      assert.equal(window?.fromTs, day(2026, 6, 1), `failed for "${written}"`);
      assert.equal(window?.toTs, day(2026, 6, 1, 23, 59, 59, 999), `failed for "${written}"`);
    }
  });

  it('expands a bare date range to cover both full days', () => {
    const window = parseWindowPhrase('2026-07-01..2026-07-03', NOW);
    assert.equal(window?.fromTs, day(2026, 6, 1));
    assert.equal(window?.toTs, day(2026, 6, 3, 23, 59, 59, 999));
  });

  it('accepts "to" as a range separator and repairs a reversed range', () => {
    const window = parseWindowPhrase('2026-07-03 to 2026-07-01', NOW);
    assert.equal(window?.fromTs, day(2026, 6, 1));
    assert.equal(window?.toTs, day(2026, 6, 3, 23, 59, 59, 999));
  });

  it('parses named periods', () => {
    assert.equal(parseWindowPhrase('yesterday', NOW)?.fromTs, day(2026, 6, 1));
    assert.equal(parseWindowPhrase('yesterday', NOW)?.toTs, day(2026, 6, 1, 23, 59, 59, 999));
    // NOW is Thursday 2 Jul 2026 -> this ISO week started Monday 29 Jun.
    assert.equal(parseWindowPhrase('this week', NOW)?.fromTs, day(2026, 5, 29));
    assert.equal(parseWindowPhrase('last week', NOW)?.fromTs, day(2026, 5, 22));
    assert.equal(parseWindowPhrase('this month', NOW)?.fromTs, day(2026, 6, 1));
    assert.equal(parseWindowPhrase('last month', NOW)?.fromTs, day(2026, 5, 1));
    assert.equal(parseWindowPhrase('last month', NOW)?.toTs, day(2026, 6, 1) - 1);
  });

  it('every window label states the range it actually covers', () => {
    assert.equal(parseWindowPhrase('2026-07-01', NOW)?.label, '01 Jul 2026');
    assert.equal(parseWindowPhrase('2026-07-01..2026-07-03', NOW)?.label, '01 Jul → 03 Jul 2026');
    assert.match(parseWindowPhrase('today', NOW)?.label ?? '', /^today \(/);
  });

  it('reports an unreadable date instead of folding it into the group name', () => {
    const cmd = parseCommand('/sum family 2026-13-45', NOW);
    assert.ok(cmd?.type === 'invalid');
    assert.match(cmd.reason, /Couldn't read "2026-13-45"/);
  });

  it('leaves group names that merely contain words alone', () => {
    const cmd = parseCommand('/sum Trip to Goa', NOW);
    assert.ok(cmd?.type === 'sum');
    assert.equal(cmd.group, 'Trip to Goa');
    assert.equal(cmd.window, null);
  });

  it('lets a date-looking group name through when it is quoted', () => {
    const cmd = parseCommand('/sum "Batch 2025-26"', NOW);
    assert.ok(cmd?.type === 'sum');
    assert.equal(cmd.group, 'Batch 2025-26');
  });
});
