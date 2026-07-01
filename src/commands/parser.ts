import type { SummaryWindow } from '../types.js';
import { parseDateTime } from '../util/time.js';

/**
 * Pure parser for the self-chat command channel. Grammar:
 *   /help
 *   /groups
 *   /sum <group> [window]      window: 6h | 2d | today | yesterday |
 *                                      YYYY-MM-DD..YYYY-MM-DD |
 *                                      "YYYY-MM-DD HH:MM..YYYY-MM-DD HH:MM"
 *   /unread <group>
 *   /topics | /topics set <text> | /topics clear
 *   /schedule list | /schedule <group> HH:MM | /schedule <group> off
 *   /saved [n]
 * <group> may be quoted ("family group"), a name fragment, or #index from /groups.
 */

export type Command =
  | { type: 'help' }
  | { type: 'groups' }
  | { type: 'sum'; group: string; window: SummaryWindow | null }
  | { type: 'unread'; group: string }
  | { type: 'topics-show' }
  | { type: 'topics-set'; interests: string }
  | { type: 'topics-clear' }
  | { type: 'schedule-list' }
  | { type: 'schedule-set'; group: string; time: string }
  | { type: 'schedule-off'; group: string }
  | { type: 'saved'; limit: number }
  | { type: 'invalid'; reason: string };

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export function parseCommand(input: string, now: number): Command | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;

  const [head, ...restParts] = splitTokens(trimmed);
  const rest = restParts;
  const command = (head ?? '').toLowerCase();

  switch (command) {
    case '/help':
      return { type: 'help' };
    case '/groups':
      return { type: 'groups' };
    case '/saved': {
      const limit = rest[0] !== undefined ? Number(rest[0]) : 5;
      return Number.isInteger(limit) && limit > 0
        ? { type: 'saved', limit: Math.min(limit, 20) }
        : { type: 'invalid', reason: 'Usage: /saved [count]' };
    }
    case '/topics': {
      const sub = (rest[0] ?? '').toLowerCase();
      if (sub === '') return { type: 'topics-show' };
      if (sub === 'clear') return { type: 'topics-clear' };
      if (sub === 'set') {
        const interests = rest.slice(1).join(' ').trim();
        return interests
          ? { type: 'topics-set', interests }
          : { type: 'invalid', reason: 'Usage: /topics set <your interests>' };
      }
      return { type: 'invalid', reason: 'Usage: /topics | /topics set <text> | /topics clear' };
    }
    case '/unread': {
      const group = rest.join(' ').trim();
      return group
        ? { type: 'unread', group }
        : { type: 'invalid', reason: 'Usage: /unread <group>' };
    }
    case '/sum': {
      if (rest.length === 0) return { type: 'invalid', reason: 'Usage: /sum <group> [window]' };
      const { window, consumed } = takeTrailingWindow(rest, now);
      const group = rest.slice(0, rest.length - consumed).join(' ').trim();
      if (!group) return { type: 'invalid', reason: 'Usage: /sum <group> [window]' };
      return { type: 'sum', group, window };
    }
    case '/schedule': {
      const sub = (rest[0] ?? '').toLowerCase();
      if (sub === 'list' || sub === '') return { type: 'schedule-list' };
      const last = (rest[rest.length - 1] ?? '').toLowerCase();
      const group = rest.slice(0, -1).join(' ').trim();
      if (!group) return { type: 'invalid', reason: 'Usage: /schedule <group> HH:MM | off' };
      if (last === 'off') return { type: 'schedule-off', group };
      if (/^\d{2}:\d{2}$/.test(last)) return { type: 'schedule-set', group, time: last };
      return { type: 'invalid', reason: 'Usage: /schedule <group> HH:MM | off' };
    }
    default:
      return { type: 'invalid', reason: `Unknown command ${command}. Send /help.` };
  }
}

/** Split on spaces but keep "quoted strings" together. */
export function splitTokens(input: string): string[] {
  const tokens: string[] = [];
  const regex = /"([^"]*)"|(\S+)/g;
  for (const match of input.matchAll(regex)) {
    tokens.push(match[1] ?? match[2] ?? '');
  }
  return tokens;
}

interface WindowTake {
  window: SummaryWindow | null;
  /** How many trailing tokens the window consumed. */
  consumed: number;
}

/**
 * Interpret trailing tokens as a time window.
 * Supports: "6h", "2d", "today", "yesterday",
 * "YYYY-MM-DD..YYYY-MM-DD" and "YYYY-MM-DD HH:MM..YYYY-MM-DD HH:MM"
 * (the datetime range spans up to 4 tokens).
 */
export function takeTrailingWindow(tokens: string[], now: number): WindowTake {
  // Try datetime ranges over the last 1..4 tokens (joined with spaces).
  for (let take = Math.min(4, tokens.length); take >= 1; take--) {
    const candidate = tokens.slice(tokens.length - take).join(' ');
    if (candidate.includes('..')) {
      const [fromRaw, toRaw] = candidate.split('..', 2);
      const fromTs = parseDateTime(fromRaw ?? '', false);
      const toTs = parseDateTime(toRaw ?? '', true);
      if (fromTs !== null && toTs !== null && fromTs <= toTs) {
        return {
          window: { fromTs, toTs, label: `${fromRaw} to ${toRaw}` },
          consumed: take,
        };
      }
    }
  }

  const last = (tokens[tokens.length - 1] ?? '').toLowerCase();
  const relative = /^(\d+)([hd])$/.exec(last);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2] === 'h' ? HOUR : DAY;
    const label = `last ${amount}${relative[2]}`;
    return { window: { fromTs: now - amount * unit, toTs: now, label }, consumed: 1 };
  }
  if (last === 'today') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { window: { fromTs: start.getTime(), toTs: now, label: 'today' }, consumed: 1 };
  }
  if (last === 'yesterday') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return {
      window: { fromTs: start.getTime() - DAY, toTs: start.getTime() - 1, label: 'yesterday' },
      consumed: 1,
    };
  }
  return { window: null, consumed: 0 };
}

export const HELP_TEXT = `*WhatsApp Summarizer — commands*
Send these here (only you can see them):

/groups — list your groups
/sum <group> — summarize last 24h
/sum <group> 6h | 2d | today | yesterday
/sum <group> 2026-07-01..2026-07-02
/sum <group> 2026-07-01 09:00..2026-07-01 18:00
/unread <group> — catch up since your last catch-up
/topics — show your topic interests
/topics set tech talks, AI tools, event updates
/topics clear
/schedule <group> 20:00 — daily digest
/schedule <group> off · /schedule list
/saved [n] — recent saved summaries

<group> = name fragment, "quoted name", or #number from /groups.
⭐ React with a star on any message to archive it permanently.`;
