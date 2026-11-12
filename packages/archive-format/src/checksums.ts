import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, readlink } from 'node:fs/promises';
import path from 'node:path';
import { isRecord, parseJson } from '@fonds/shared';
import { atomicWriteFile } from './atomic';
import { isGitPayloadPath, toPosixRelative } from './layout';

export interface ChecksumEntry {
  path: string;
  sha256: string;
  bytes: number;
  kind: 'file' | 'symlink';
}

export interface ChecksumFile {
  schemaVersion: 1;
  algorithm: 'sha256';
  generatedAt: string;
  files: ChecksumEntry[];
}

export async function writeChecksums(root: string, generatedAt: string): Promise<ChecksumFile> {
  const files = await collectChecksums(root);
  const document: ChecksumFile = {
    schemaVersion: 1,
    algorithm: 'sha256',
    generatedAt,
    files,
  };
  await atomicWriteFile(path.join(root, 'checksums.json'), `${JSON.stringify(document, null, 2)}\n`);
  return document;
}

export async function collectChecksums(root: string): Promise<ChecksumEntry[]> {
  const files: ChecksumEntry[] = [];
  await walk(root, root, files);
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return files;
}

export async function verifyChecksums(root: string): Promise<{ ok: boolean; failures: string[] }> {
  const document = parseChecksumFile(parseJson(await readFile(path.join(root, 'checksums.json'), 'utf8')));
  const failures: string[] = [];
  const present = new Set<string>();
  for (const entry of document.files) {
    present.add(entry.path);
    const full = path.join(root, ...entry.path.split('/'));
    const relative = path.relative(root, full);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      failures.push(`${entry.path}: escapes archive root`);
      continue;
    }
    let info;
    try {
      info = await lstat(full);
    } catch {
      failures.push(`${entry.path}: missing`);
      continue;
    }
    if (entry.kind === 'symlink') {
      if (!info.isSymbolicLink()) {
        failures.push(`${entry.path}: expected a symlink`);
        continue;
      }
      const target = await readlink(full);
      const hash = createHash('sha256').update(target).digest('hex');
      if (hash !== entry.sha256) failures.push(`${entry.path}: symlink target changed`);
      continue;
    }
    if (!info.isFile()) {
      failures.push(`${entry.path}: expected a file`);
      continue;
    }
    const data = await readFile(full);
    const hash = createHash('sha256').update(data).digest('hex');
    if (hash !== entry.sha256 || data.byteLength !== entry.bytes) failures.push(`${entry.path}: checksum mismatch`);
  }
  const actual = await collectChecksums(root);
  for (const entry of actual) {
    if (!present.has(entry.path)) failures.push(`${entry.path}: unexpected file`);
  }
  return { ok: failures.length === 0, failures };
}

export function parseChecksumFile(value: unknown): ChecksumFile {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.algorithm !== 'sha256' || !Array.isArray(value.files)) {
    throw new Error('checksum file is invalid');
  }
  const files: ChecksumEntry[] = [];
  for (const entry of value.files) {
    if (!isRecord(entry) || typeof entry.path !== 'string' || typeof entry.sha256 !== 'string') {
      throw new Error('checksum entry is invalid');
    }
    if (entry.kind !== 'file' && entry.kind !== 'symlink') throw new Error('checksum kind is invalid');
    if (typeof entry.bytes !== 'number') throw new Error('checksum size is invalid');
    files.push({ path: entry.path, sha256: entry.sha256, bytes: entry.bytes, kind: entry.kind });
  }
  return { schemaVersion: 1, algorithm: 'sha256', generatedAt: String(value.generatedAt ?? ''), files };
}

async function walk(root: string, current: string, files: ChecksumEntry[]): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(current, entry.name);
    const relative = toPosixRelative(root, full);
    if (relative === 'checksums.json' || relative.endsWith('.tmp')) continue;
    if (isGitPayloadPath(relative)) continue;
    const info = await lstat(full);
    if (info.isSymbolicLink()) {
      const target = await readlink(full);
      files.push({
        path: relative,
        sha256: createHash('sha256').update(target).digest('hex'),
        bytes: Buffer.byteLength(target),
        kind: 'symlink',
      });
      continue;
    }
    if (info.isDirectory()) {
      await walk(root, full, files);
      continue;
    }
    if (!info.isFile()) continue;
    const data = await readFile(full);
    files.push({
      path: relative,
      sha256: createHash('sha256').update(data).digest('hex'),
      bytes: data.byteLength,
      kind: 'file',
    });
  }
}
