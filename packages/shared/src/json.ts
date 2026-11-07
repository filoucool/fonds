export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseJson(text: string): unknown {
  return JSON.parse(text);
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => sortValue(entry));
  if (!isRecord(value)) return value;
  const keys = Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const sorted: Record<string, unknown> = {};
  for (const key of keys) sorted[key] = sortValue(value[key]);
  return sorted;
}

export function encodeCursor(value: Record<string, string | number | null>): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function decodeCursor(value: string): unknown {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '==='.slice((value.length + 3) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return parseJson(new TextDecoder().decode(bytes));
}

export function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length < 6) continue;
    out = out.split(secret).join('[redacted]');
  }
  return out
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/g, 'Bearer [redacted]')
    .replace(/\b(ghp_|github_pat_|glpat-)[A-Za-z0-9_]+/g, '[redacted]');
}
