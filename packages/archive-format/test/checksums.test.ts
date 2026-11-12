import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectChecksums, verifyChecksums, writeChecksums } from '../src/checksums';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

// @suite pkg.archive-format.checksums
describe('checksums', () => {
  it('writes checksums.json and verifies an unchanged tree', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'archiver-cs-'));
    roots.push(root);
    mkdirSync(path.join(root, 'nested'), { recursive: true });
    writeFileSync(path.join(root, 'nested', 'a.txt'), 'alpha\n');

    await writeChecksums(root, '2020-01-01T00:00:00.000Z');
    const onDisk = readFileSync(path.join(root, 'checksums.json'), 'utf8');
    expect(onDisk).toContain('a.txt');

    const report = await verifyChecksums(root);
    expect(report.ok).toBe(true);

    writeFileSync(path.join(root, 'nested', 'a.txt'), 'beta\n');
    const tampered = await verifyChecksums(root);
    expect(tampered.ok).toBe(false);
  });

  it('collects posix-relative paths', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'archiver-cs-'));
    roots.push(root);
    writeFileSync(path.join(root, 'root.txt'), 'x');
    const entries = await collectChecksums(root);
    expect(entries.some((entry) => entry.path === 'root.txt')).toBe(true);
  });
});
