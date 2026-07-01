const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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

/** Parse "YYYY-MM-DD" or "YYYY-MM-DD HH:MM" as local time; null if invalid. */
export function parseDateTime(input: string, endOfDay: boolean): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/.exec(input.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi] = match;
  const year = Number(y);
  const month = Number(mo) - 1;
  const day = Number(d);
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  if (h !== undefined && mi !== undefined) {
    return new Date(year, month, day, Number(h), Number(mi)).getTime();
  }
  return endOfDay
    ? new Date(year, month, day, 23, 59, 59, 999).getTime()
    : new Date(year, month, day, 0, 0, 0, 0).getTime();
}
