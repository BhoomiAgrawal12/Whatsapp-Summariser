/**
 * Local-time date helpers.
 *
 * Everything the app stores is unix milliseconds UTC; everything the *user*
 * types or reads is in the machine's local timezone. This module is the only
 * place that converts between the two, so date-window bugs have one home.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Month name -> 0-based index, for "1 Jul" / "July 1" style input. */
const MONTH_INDEX = new Map<string, number>([
  ['jan', 0], ['january', 0],
  ['feb', 1], ['february', 1],
  ['mar', 2], ['march', 2],
  ['apr', 3], ['april', 3],
  ['may', 4],
  ['jun', 5], ['june', 5],
  ['jul', 6], ['july', 6],
  ['aug', 7], ['august', 7],
  ['sep', 8], ['sept', 8], ['september', 8],
  ['oct', 9], ['october', 9],
  ['nov', 10], ['november', 10],
  ['dec', 11], ['december', 11],
]);

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

/** "01 Jul 14:32" in local time. */
export function formatTs(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "14:32" in local time. */
export function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "01 Jul 2026" in local time. */
export function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Human description of a window, collapsed to the shortest unambiguous form:
 *  - whole single day      -> "01 Jul 2026"
 *  - part of a single day  -> "01 Jul 2026 09:00 → 18:00"
 *  - whole days, one span  -> "01 Jul → 03 Jul 2026"
 *  - anything else         -> "01 Jul 09:00 → 03 Jul 18:00, 2026"
 */
export function formatRange(fromTs: number, toTs: number): string {
  const from = new Date(fromTs);
  const to = new Date(toTs);
  const sameDay = dayKey(fromTs) === dayKey(toTs);
  const wholeDays = isDayStart(fromTs) && isDayEnd(toTs);

  if (sameDay && wholeDays) return formatDate(fromTs);
  if (sameDay) return `${formatDate(fromTs)} ${formatTime(fromTs)} → ${formatTime(toTs)}`;
  if (wholeDays && from.getFullYear() === to.getFullYear()) {
    return `${pad(from.getDate())} ${MONTHS[from.getMonth()]} → ${formatDate(toTs)}`;
  }
  return `${formatTs(fromTs)} → ${formatTs(toTs)}`;
}

/** Local midnight at the start of the day containing `ts`. */
export function dayStart(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Last representable millisecond of the local day containing `ts`. */
export function dayEnd(ts: number): number {
  const d = new Date(ts);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

function isDayStart(ts: number): boolean {
  return dayStart(ts) === ts;
}

function isDayEnd(ts: number): boolean {
  return dayEnd(ts) === ts;
}

/** Stable "YYYY-MM-DD" local-day key — used to group messages date-wise. */
export function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "Mon 01 Jul 2026" — heading for a day block in a date-wise digest. */
export function formatDayHeading(ts: number): string {
  const d = new Date(ts);
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
  return `${weekday} ${formatDate(ts)}`;
}

/** How many distinct local calendar days the window touches (>= 1). */
export function daySpan(fromTs: number, toTs: number): number {
  if (toTs < fromTs) return 0;
  return Math.round((dayStart(toTs) - dayStart(fromTs)) / DAY_MS) + 1;
}

/** Local midnight at the start of the ISO week (Monday) containing `ts`. */
export function weekStart(ts: number): number {
  const start = new Date(dayStart(ts));
  // getDay(): 0 = Sunday. Shift so Monday is day 0.
  const offset = (start.getDay() + 6) % 7;
  return start.getTime() - offset * DAY_MS;
}

/** Local midnight on the 1st of the month containing `ts`. */
export function monthStart(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0).getTime();
}

export function addMonths(ts: number, months: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth() + months, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()).getTime();
}

/** A parsed date/time literal. `hasTime` decides whether callers snap to a day edge. */
export interface Moment {
  ts: number;
  hasTime: boolean;
}

/**
 * Parse a date (optionally with a time) written in any of the forms people
 * actually type. All are interpreted in local time. Day-first is assumed for
 * ambiguous numeric forms (`03/07` = 3 July), matching WhatsApp's own display.
 *
 * Accepted:
 *   2026-07-01            2026/07/01
 *   01-07-2026            01/07/2026        01/07 (current year)
 *   1 Jul                 1 July 2026       Jul 1 2026
 *   ...optionally followed by  14:30 | 14:30:05 | T14:30 | 2pm | 2:30 pm
 */
export function parseMoment(input: string, now: number = Date.now()): Moment | null {
  const text = input.trim().replace(/\s+/g, ' ');
  if (!text) return null;

  const split = splitDateAndTime(text);
  if (!split) return null;
  const { datePart, timePart } = split;

  const date = parseDatePart(datePart, now);
  if (!date) return null;
  const time = timePart === null ? null : parseTimePart(timePart);
  if (timePart !== null && time === null) return null;

  const d = new Date(
    date.year,
    date.month,
    date.day,
    time?.hours ?? 0,
    time?.minutes ?? 0,
    time?.seconds ?? 0,
    0
  );
  // Reject impossible dates (31 Feb) — the Date constructor silently rolls over.
  if (d.getFullYear() !== date.year || d.getMonth() !== date.month || d.getDate() !== date.day) {
    return null;
  }
  return { ts: d.getTime(), hasTime: time !== null };
}

/**
 * Backwards-compatible wrapper: returns the moment's timestamp, snapping a
 * date-without-time to the start (or end, when `endOfDay`) of that day.
 */
export function parseDateTime(input: string, endOfDay: boolean, now: number = Date.now()): number | null {
  const moment = parseMoment(input, now);
  if (!moment) return null;
  if (moment.hasTime) return moment.ts;
  return endOfDay ? dayEnd(moment.ts) : dayStart(moment.ts);
}

/**
 * True when a token is *structurally* a date/time literal, whether or not it is
 * a valid one. Used to tell "the user typed a bad date" apart from "that word is
 * part of the group name", so a broken window can be reported instead of being
 * silently folded into the group query.
 *
 * Deliberately conservative: bare words (including month names) never qualify,
 * because plenty of groups are called "May" or "Weekend". A group whose name
 * genuinely looks like a date can always be quoted — quoting makes it a single
 * token, which this never sees.
 */
export function looksLikeDate(token: string): boolean {
  const t = token.trim().toLowerCase();
  if (!t) return false;
  if (t.includes('..')) return true;
  if (/^\d{1,4}[-/]\d{1,2}([-/]\d{1,4})?$/.test(t)) return true;
  if (/^\d{1,2}:\d{2}/.test(t)) return true;
  return /^\d+(h|d|w)$/.test(t);
}

interface DateParts {
  year: number;
  month: number;
  day: number;
}

/** Separate "01 Jul 2026 14:30" into its date and (optional) time halves. */
function splitDateAndTime(text: string): { datePart: string; timePart: string | null } | null {
  // ISO style: 2026-07-01T14:30
  const isoT = /^(\S+)T(\d{1,2}:\d{2}(?::\d{2})?)$/i.exec(text);
  if (isoT) return { datePart: isoT[1]!, timePart: isoT[2]! };

  // Trailing clock time ("… 14:30", "… 2:30 pm", "… 2pm").
  const trailing = /^(.*?)\s+(\d{1,2}(?::\d{2}(?::\d{2})?)?\s*(?:am|pm)?)$/i.exec(text);
  if (trailing && /[:apm]/i.test(trailing[2]!) && trailing[1]!.trim()) {
    // A bare trailing number like "Jul 1" is a day, not a time — require ':' or am/pm.
    return { datePart: trailing[1]!.trim(), timePart: trailing[2]!.trim() };
  }
  return { datePart: text, timePart: null };
}

function parseDatePart(text: string, now: number): DateParts | null {
  const nowYear = new Date(now).getFullYear();

  // 2026-07-01 / 2026/07/01 (year first, unambiguous)
  const ymd = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(text);
  if (ymd) {
    return { year: Number(ymd[1]), month: Number(ymd[2]) - 1, day: Number(ymd[3]) };
  }

  // 01-07-2026 / 01/07/2026 / 1/7/26 — day first.
  const dmy = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})$/.exec(text);
  if (dmy) {
    const rawYear = Number(dmy[3]);
    return {
      year: rawYear < 100 ? 2000 + rawYear : rawYear,
      month: Number(dmy[2]) - 1,
      day: Number(dmy[1]),
    };
  }

  // 01/07 — day first, current year.
  const dm = /^(\d{1,2})[-/](\d{1,2})$/.exec(text);
  if (dm) {
    return { year: nowYear, month: Number(dm[2]) - 1, day: Number(dm[1]) };
  }

  // 1 Jul [2026] / 1st July [2026]
  const dMonth = /^(\d{1,2})(?:st|nd|rd|th)?\.?\s+([a-z]+)\.?(?:\s+(\d{4}))?$/i.exec(text);
  if (dMonth) {
    const month = MONTH_INDEX.get(dMonth[2]!.toLowerCase());
    if (month === undefined) return null;
    return { year: dMonth[3] ? Number(dMonth[3]) : nowYear, month, day: Number(dMonth[1]) };
  }

  // Jul 1 [2026] / July 1st, 2026
  const monthD = /^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?(?:\s+(\d{4}))?$/i.exec(text);
  if (monthD) {
    const month = MONTH_INDEX.get(monthD[1]!.toLowerCase());
    if (month === undefined) return null;
    return { year: monthD[3] ? Number(monthD[3]) : nowYear, month, day: Number(monthD[2]) };
  }

  return null;
}

function parseTimePart(text: string): { hours: number; minutes: number; seconds: number } | null {
  const match = /^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(am|pm)?$/i.exec(text.trim());
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = match[2] ? Number(match[2]) : 0;
  const seconds = match[3] ? Number(match[3]) : 0;
  const meridiem = match[4]?.toLowerCase();
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    if (meridiem === 'pm' && hours !== 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;
  }
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  return { hours, minutes, seconds };
}
