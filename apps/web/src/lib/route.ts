import type { LocationQuery } from 'vue-router';

export function routeId(param: string | string[] | undefined): string {
  if (Array.isArray(param)) return param[0] ?? '';
  return param ?? '';
}

export function queryString(query: LocationQuery, key: string): string {
  const value = query[key];
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0] ?? '';
  return '';
}

export function assignQuery(
  current: LocationQuery,
  partial: Record<string, string | undefined>,
): LocationQuery {
  const next: LocationQuery = { ...current };
  for (const [key, value] of Object.entries(partial)) {
    if (!value) delete next[key];
    else next[key] = value;
  }
  return next;
}
