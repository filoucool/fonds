export type Schedule =
  | { kind: 'manual' }
  | { kind: 'interval'; everySeconds: number }
  | { kind: 'daily'; hour: number; minute: number }
  | { kind: 'weekly'; weekday: number; hour: number; minute: number }
  | { kind: 'monthly'; day: number; hour: number; minute: number };

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
}

const WEEKDAYS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export function isSchedule(value: unknown): value is Schedule {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as { kind?: unknown };
  if (record.kind === 'manual') return true;
  if (record.kind === 'interval') {
    const every = (value as { everySeconds?: unknown }).everySeconds;
    return typeof every === 'number' && Number.isInteger(every) && every >= 60 && every <= 366 * 24 * 3600;
  }
  if (record.kind === 'daily' || record.kind === 'weekly' || record.kind === 'monthly') {
    const hour = (value as { hour?: unknown }).hour;
    const minute = (value as { minute?: unknown }).minute;
    if (!isHour(hour) || !isMinute(minute)) return false;
    if (record.kind === 'weekly') {
      const weekday = (value as { weekday?: unknown }).weekday;
      return typeof weekday === 'number' && Number.isInteger(weekday) && weekday >= 0 && weekday <= 6;
    }
    if (record.kind === 'monthly') {
      const day = (value as { day?: unknown }).day;
      return typeof day === 'number' && Number.isInteger(day) && day >= 1 && day <= 31;
    }
    return true;
  }
  return false;
}

export function computeNextRun(schedule: Schedule, timeZone: string, from: Date): Date | null {
  if (!isValidTimeZone(timeZone)) throw new Error(`invalid timezone ${timeZone}`);
  if (schedule.kind === 'manual') return null;
  if (schedule.kind === 'interval') {
    return new Date(from.getTime() + schedule.everySeconds * 1000);
  }
  const start = new Date(from.getTime() + 60_000);
  if (schedule.kind === 'daily') {
    return nextDaily(start, timeZone, schedule.hour, schedule.minute);
  }
  if (schedule.kind === 'weekly') {
    return nextWeekly(start, timeZone, schedule.weekday, schedule.hour, schedule.minute);
  }
  return nextMonthly(start, timeZone, schedule.day, schedule.hour, schedule.minute);
}

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const mapped: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== 'literal') mapped[part.type] = part.value;
  }
  const weekday = WEEKDAYS[mapped.weekday ?? ''];
  if (weekday === undefined) throw new Error('unable to read weekday');
  return {
    year: numberPart(mapped.year),
    month: numberPart(mapped.month),
    day: numberPart(mapped.day),
    hour: numberPart(mapped.hour),
    minute: numberPart(mapped.minute),
    second: numberPart(mapped.second),
    weekday,
  };
}

export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = zonedParts(new Date(utc), timeZone);
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0);
    const desired = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
    const diff = desired - asUtc;
    if (diff === 0) return new Date(utc);
    utc += diff;
  }
  return new Date(utc);
}

function nextDaily(from: Date, timeZone: string, hour: number, minute: number): Date {
  const parts = zonedParts(from, timeZone);
  let candidate = zonedTimeToUtc(parts.year, parts.month, parts.day, hour, minute, timeZone);
  if (candidate.getTime() <= from.getTime()) {
    const next = addDays(parts.year, parts.month, parts.day, 1);
    candidate = zonedTimeToUtc(next.year, next.month, next.day, hour, minute, timeZone);
  }
  return candidate;
}

function nextWeekly(
  from: Date,
  timeZone: string,
  weekday: number,
  hour: number,
  minute: number,
): Date {
  const parts = zonedParts(from, timeZone);
  const delta = (weekday - parts.weekday + 7) % 7;
  const day = addDays(parts.year, parts.month, parts.day, delta);
  let candidate = zonedTimeToUtc(day.year, day.month, day.day, hour, minute, timeZone);
  if (candidate.getTime() <= from.getTime()) {
    const following = addDays(day.year, day.month, day.day, 7);
    candidate = zonedTimeToUtc(following.year, following.month, following.day, hour, minute, timeZone);
  }
  return candidate;
}

function nextMonthly(
  from: Date,
  timeZone: string,
  day: number,
  hour: number,
  minute: number,
): Date {
  const parts = zonedParts(from, timeZone);
  const thisMonth = clampDay(parts.year, parts.month, day);
  let candidate = zonedTimeToUtc(parts.year, parts.month, thisMonth, hour, minute, timeZone);
  if (candidate.getTime() <= from.getTime()) {
    const next = parts.month === 12 ? { year: parts.year + 1, month: 1 } : { year: parts.year, month: parts.month + 1 };
    const nextDay = clampDay(next.year, next.month, day);
    candidate = zonedTimeToUtc(next.year, next.month, nextDay, hour, minute, timeZone);
  }
  return candidate;
}

function addDays(year: number, month: number, day: number, amount: number): { year: number; month: number; day: number } {
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function clampDay(year: number, month: number, day: number): number {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Math.min(day, last);
}

function numberPart(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error('invalid date part');
  return parsed;
}

function isHour(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 23;
}

function isMinute(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 59;
}
