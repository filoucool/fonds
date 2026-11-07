import type { Schedule } from '../api/types';

const ET = 'America/New_York';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '\u2014';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: ET,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
  return `${formatted} ET`;
}

export function formatTime(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: ET,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

export function formatBytes(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '\u2014';
  const sign = value < 0 ? '-' : '';
  let size = Math.abs(value);
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  const digits = index === 0 ? 0 : size >= 100 ? 0 : size >= 10 ? 1 : 2;
  return `${sign}${size.toFixed(digits)} ${units[index]}`;
}

export function formatPercent(part: number, whole: number): string {
  if (!whole) return '\u2014';
  return `${((part / whole) * 100).toFixed(1)}%`;
}

export function sourceHost(value: string | null | undefined): string {
  if (!value) return '\u2014';
  try {
    const host = new URL(value).host;
    return host || value;
  } catch {
    return value;
  }
}

export function shortOid(oid: string | null | undefined, given?: string | null): string {
  if (given) return given;
  if (!oid) return '\u2014';
  return oid.slice(0, 7);
}

export function lines(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || seen.has(line)) continue;
    seen.add(line);
    out.push(line);
  }
  return out;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatSchedule(schedule: Schedule | null | undefined): string {
  if (!schedule) return '\u2014';
  switch (schedule.kind) {
    case 'manual':
      return 'Manual';
    case 'interval':
      return `Every ${schedule.everySeconds}s`;
    case 'daily':
      return `Daily at ${pad(schedule.hour)}:${pad(schedule.minute)}`;
    case 'weekly':
      return `${WEEKDAYS[schedule.weekday] ?? `Weekday ${schedule.weekday}`} at ${pad(schedule.hour)}:${pad(schedule.minute)}`;
    case 'monthly':
      return `Day ${schedule.day} at ${pad(schedule.hour)}:${pad(schedule.minute)}`;
    default:
      return 'Schedule';
  }
}

export function formatClock(date: Date): string {
  return `${formatTime(date)} ET`;
}

export function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
