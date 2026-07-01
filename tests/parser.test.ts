import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, splitTokens, takeTrailingWindow } from '../src/commands/parser.js';

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

  it('parses relative days', () => {
    const { window } = takeTrailingWindow(['2d'], NOW);
    assert.equal(window?.fromTs, NOW - 2 * DAY);
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
    assert.equal(cmd.window?.label, 'last 2d');
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
