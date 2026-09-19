import type { SummaryWindow } from '../types.js';
import {
  DAY_MS,
  HOUR_MS,
  dayEnd,
  dayStart,
  formatRange,
  looksLikeDate,
  monthStart,
  parseMoment,
  weekStart,
} from '../util/time.js';

/**
 * Pure parser for the self-chat command channel. Grammar:
 *   /help
 *   /groups
 *   /sum <group> [window]
 *   /unread <group>
 *   /topics | /topics set <text> | /topics clear
 *   /schedule list | /schedule <group> HH:MM | /schedule <group> off
 *   /saved [n]
 * <group> may be quoted ("family group"), a name fragment, or #index from /groups.
 *
 * Windows (see `parseWindowPhrase`) accept relative spans (6h, 2d, 3w), named
 * periods (today, yesterday, this week, last month), a single date (summarizes
 * that whole calendar day) and explicit ranges written with ".." or "to".
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

const WINDOW_HELP =
  'Windows: 6h · 2d · 3w · today · yesterday · this week · last week · this month · ' +
  'last month · 2026-07-01 · 01/07/2026 · "1 Jul" · 2026-07-01..2026-07-03 · ' +
  '"2026-07-01 09:00..2026-07-01 18:00"';

export function parseCommand(input: string, now: number): Command | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;

  const [head, ...rest] = splitTokens(trimmed);
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
      if (rest.length === 0) return { type: 'invalid', reason: `Usage: /sum <group> [window]\n${WINDOW_HELP}` };
      const take = takeTrailingWindow(rest, now);
      if (take.error) return { type: 'invalid', reason: take.error };
      const group = rest.slice(0, rest.length - take.consumed).join(' ').trim();
      if (!group) return { type: 'invalid', reason: `Usage: /sum <group> [window]\n${WINDOW_HELP}` };
      return { type: 'sum', group, window: take.window };
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

export interface WindowTake {
  window: SummaryWindow | null;
  /** How many trailing tokens the window consumed. */
  consumed: number;
  /**
   * Set when the trailing tokens clearly *meant* to be a window but could not be
   * parsed. Without this, "/sum family 2026-13-45" silently folded the bad date
   * into the group name and reported "no group matching …", which is what made
   * date-wise summaries look broken.
   */
  error?: string;
}

/** A window phrase may span several tokens ("last week", "1 Jul 2026 09:00..1 Jul 18:00"). */
const MAX_WINDOW_TOKENS = 6;

/**
 * Interpret trailing tokens as a time window, longest phrase first so that
 * "this week" wins over the bare word "week".
 */
export function takeTrailingWindow(tokens: string[], now: number): WindowTake {
  for (let take = Math.min(MAX_WINDOW_TOKENS, tokens.length); take >= 1; take--) {
    const phrase = tokens.slice(tokens.length - take).join(' ');
    const window = parseWindowPhrase(phrase, now);
    if (window) return { window, consumed: take };
  }

  // Nothing parsed. If a group name is present *and* the tail is structurally a
  // date, the user meant a window and got it wrong — say so instead of folding
  // the bad date into the group query and reporting "no group matching ...".
  const last = tokens[tokens.length - 1] ?? '';
  if (tokens.length > 1 && looksLikeDate(last)) {
    return {
      window: null,
      consumed: 0,
      error:
        `Couldn't read "${last}" as a date or time window.\n${WINDOW_HELP}\n` +
        `(If it is part of the group name, quote the name: /sum "My Group ${last}")`,
    };
  }
  return { window: null, consumed: 0 };
}

/**
 * The whole window grammar in one place.
 * Returns null when `phrase` is not a window at all (so callers can keep
 * shrinking the phrase or treat it as group-name text).
 */
export function parseWindowPhrase(phrase: string, now: number): SummaryWindow | null {
  const text = phrase.trim().replace(/\s+/g, ' ');
  if (!text) return null;
  const lower = text.toLowerCase();

  const named = parseNamedPeriod(lower, now);
  if (named) return named;

  const relative = parseRelativeSpan(lower, now);
  if (relative) return relative;

  const range = parseExplicitRange(text, now);
  if (range) return range;

  // A lone date/datetime. A bare date means "that whole calendar day"; a date
  // *with* a time means "from that moment until now".
  const moment = parseMoment(text, now);
  if (moment) {
    const fromTs = moment.hasTime ? moment.ts : dayStart(moment.ts);
    const toTs = moment.hasTime ? Math.max(now, moment.ts) : dayEnd(moment.ts);
    return labelled(fromTs, toTs);
  }
  return null;
}

function parseNamedPeriod(lower: string, now: number): SummaryWindow | null {
  switch (lower) {
    case 'today':
      return labelled(dayStart(now), Math.min(now, dayEnd(now)), 'today');
    case 'yesterday': {
      const start = dayStart(now) - DAY_MS;
      return labelled(start, dayEnd(start), 'yesterday');
    }
    case 'this week':
      return labelled(weekStart(now), now, 'this week');
    case 'last week': {
      const start = weekStart(now) - 7 * DAY_MS;
      return labelled(start, start + 7 * DAY_MS - 1, 'last week');
    }
    case 'this month':
      return labelled(monthStart(now), now, 'this month');
    case 'last month': {
      const thisMonth = new Date(monthStart(now));
      const start = new Date(thisMonth.getFullYear(), thisMonth.getMonth() - 1, 1).getTime();
      return labelled(start, thisMonth.getTime() - 1, 'last month');
    }
    default:
      return null;
  }
}

/** "6h", "2d", "3w", and their spelled-out forms ("6 hours", "2 days"). */
function parseRelativeSpan(lower: string, now: number): SummaryWindow | null {
  const match = /^(?:last\s+|past\s+)?(\d+)\s*(h|hr|hrs|hour|hours|d|day|days|w|week|weeks)$/.exec(lower);
  if (!match) return null;
  const amount = Number(match[1]);
  if (amount <= 0) return null;
  const unit = match[2]!;
  const ms = unit.startsWith('h') ? HOUR_MS : unit.startsWith('w') ? 7 * DAY_MS : DAY_MS;
  const suffix = unit.startsWith('h') ? 'h' : unit.startsWith('w') ? 'w' : 'd';
  return labelled(now - amount * ms, now, `last ${amount}${suffix}`);
}

/** "A..B" or "A to B", where each side is any date/datetime this module accepts. */
function parseExplicitRange(text: string, now: number): SummaryWindow | null {
  const separator = text.includes('..') ? '..' : / to /i.test(text) ? ' to ' : null;
  if (!separator) return null;

  const at = separator === '..' ? text.indexOf('..') : text.toLowerCase().indexOf(' to ');
  const fromRaw = text.slice(0, at).trim();
  const toRaw = text.slice(at + separator.length).trim();
  if (!fromRaw || !toRaw) return null;

  let from = parseMoment(fromRaw, now);
  let to = parseMoment(toRaw, now);
  if (!from || !to) return null;

  // Tolerate a reversed range. Swap the *moments*, before snapping to day edges:
  // swapping afterwards would turn "3 Jul to 1 Jul" into 1 Jul 23:59 → 3 Jul 00:00.
  if (from.ts > to.ts) [from, to] = [to, from];

  // Bare dates expand to the full day on each end, so "1 Jul..3 Jul" covers all
  // three days rather than stopping at 3 Jul 00:00.
  return labelled(
    from.hasTime ? from.ts : dayStart(from.ts),
    to.hasTime ? to.ts : dayEnd(to.ts)
  );
}

/** Every window carries an explicit, unambiguous range in its label. */
function labelled(fromTs: number, toTs: number, name?: string): SummaryWindow {
  const range = formatRange(fromTs, toTs);
  return { fromTs, toTs, label: name ? `${name} (${range})` : range };
}

export const HELP_TEXT = `*WhatsApp Summarizer — commands*
Send these here (only you can see them):

/groups — list your groups
/sum <group> — summarize last 24h
/sum <group> 6h | 2d | 3w
/sum <group> today | yesterday
/sum <group> this week | last week | this month | last month
/sum <group> 2026-07-01 — that whole day
/sum <group> 01/07/2026 · /sum <group> "1 Jul"
/sum <group> 2026-07-01..2026-07-03 — date range (day-wise digest)
/sum <group> "2026-07-01 09:00..2026-07-01 18:00"
/unread <group> — catch up since your last catch-up
/topics — show your topic interests
/topics set tech talks, AI tools, event updates
/topics clear
/schedule <group> 20:00 — daily digest
/schedule <group> off · /schedule list
/saved [n] — recent saved summaries

<group> = name fragment, "quoted name", or #number from /groups.
Ranges over more than one day are summarized *day by day*.
⭐ React with a star on any message to archive it permanently.`;
