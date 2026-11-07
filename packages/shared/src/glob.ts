export function matchesAnyExclusion(patterns: readonly string[], relativePath: string): boolean {
  return patterns.some((pattern) => pattern.length > 0 && matchGlob(pattern, relativePath));
}

export function matchGlob(pattern: string, value: string): boolean {
  return globToRegExp(pattern).test(value);
}

function globToRegExp(pattern: string): RegExp {
  let out = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];
    if (char === '*' && next === '*') {
      out += '.*';
      index += 1;
      if (pattern[index + 1] === '/') index += 1;
      continue;
    }
    if (char === '*') {
      out += '[^/]*';
      continue;
    }
    if (char === '?') {
      out += '[^/]';
      continue;
    }
    if (char && '.*+?^${}()|[]\\'.includes(char)) out += `\\${char}`;
    else out += char ?? '';
  }
  out += '$';
  return new RegExp(out);
}
