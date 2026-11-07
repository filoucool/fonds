import { isRecord, parseJson } from '@repo-archive/shared';

export function asRows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error('expected rows');
  return value.map((row) => {
    if (!isRecord(row)) throw new Error('expected a row object');
    return row;
  });
}

export function asRow(value: unknown): Record<string, unknown> | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) throw new Error('expected a row object');
  return value;
}

export function text(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new Error(`column ${key} is not text`);
  return value;
}

export function textOrNull(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new Error(`column ${key} is not text`);
  return value;
}

export function integer(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`column ${key} is not an integer`);
  return value;
}

export function integerOrNull(row: Record<string, unknown>, key: string): number | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`column ${key} is not an integer`);
  return value;
}

export function flag(row: Record<string, unknown>, key: string): boolean {
  return integer(row, key) !== 0;
}

export function jsonRecord(value: string): Record<string, unknown> {
  const parsed = parseJson(value);
  if (!isRecord(parsed)) throw new Error('stored JSON object is invalid');
  return parsed;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function id(): string {
  return crypto.randomUUID();
}
