import type { ArchivalProfileConfig, ComponentKey } from '../api/types';
import { COMPONENT_KEYS } from './labels';
import { lines } from './format';

export interface BuiltinFlags {
  builtin?: boolean;
  system?: boolean;
  isBuiltin?: boolean;
  readOnly?: boolean;
}

export function isBuiltinProfile(row: BuiltinFlags): boolean {
  return row.builtin === true || row.system === true || row.isBuiltin === true || row.readOnly === true;
}

export function blankConfig(enabled = true): ArchivalProfileConfig {
  const components = {} as Record<ComponentKey, boolean>;
  for (const key of COMPONENT_KEYS) components[key] = enabled;
  return {
    components,
    limits: {
      maxRepositoryBytes: null,
      maxAssetBytes: null,
      maxComponentBytes: null,
    },
    exclusions: [],
  };
}

export function normalizeConfig(
  input: Partial<ArchivalProfileConfig> | null | undefined,
): ArchivalProfileConfig {
  const config = blankConfig(false);
  if (!input) return config;
  for (const key of COMPONENT_KEYS) {
    const value = input.components?.[key];
    if (typeof value === 'boolean') config.components[key] = value;
  }
  config.limits.maxRepositoryBytes = input.limits?.maxRepositoryBytes ?? null;
  config.limits.maxAssetBytes = input.limits?.maxAssetBytes ?? null;
  config.limits.maxComponentBytes = input.limits?.maxComponentBytes ?? null;
  config.exclusions = Array.isArray(input.exclusions)
    ? input.exclusions.filter((item): item is string => typeof item === 'string')
    : [];
  return config;
}

export function limitToInput(value: number | null | undefined): string {
  return value == null ? '' : String(value);
}

export function parseByteLimit(raw: string, label: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`${label} must be blank or a whole number of bytes.`);
  }
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) throw new Error(`${label} is too large.`);
  return value;
}

export function exclusionText(values: string[] | null | undefined): string {
  return (values ?? []).join('\n');
}

export function parseExclusions(text: string): string[] {
  return lines(text);
}

export function requireInt(
  value: number | string,
  label: string,
  min: number,
  max = Number.MAX_SAFE_INTEGER,
): number {
  const numeric = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isInteger(numeric) || numeric < min || numeric > max) {
    const range = max === Number.MAX_SAFE_INTEGER ? `${min} or more` : `${min}–${max}`;
    throw new Error(`${label} must be a whole number from ${range}.`);
  }
  return numeric;
}

export function assertTimezone(value: string): string {
  const zone = value.trim();
  if (!zone) throw new Error('Timezone is required.');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(new Date());
  } catch {
    throw new Error('Timezone must be an IANA name, such as America/New_York.');
  }
  return zone;
}
