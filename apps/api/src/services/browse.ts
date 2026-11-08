import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { resolveInside } from '@repo-archive/archive-format';
import { isValidRefName, runGit } from '@repo-archive/git-exec';
import type { CommitView, TreeEntry } from '@repo-archive/shared';
import { HttpError } from '../errors';

export function defaultGitRef(defaultBranch: string | null | undefined, requested?: string | null): string {
  const explicit = requested?.trim();
  if (explicit) return explicit;
  if (defaultBranch && defaultBranch.length > 0) {
    return defaultBranch.startsWith('refs/') ? defaultBranch : `refs/heads/${defaultBranch}`;
  }
  return 'HEAD';
}

export async function listTree(gitDir: string, ref: string, directory: string): Promise<TreeEntry[]> {
  assertRef(ref);
  assertRelative(directory);
  const spec = directory.length === 0 ? ref : `${ref}:${directory}`;
  let result;
  try {
    result = await runGit(['ls-tree', '-l', spec], { gitDir, allowFileProtocol: true, timeoutMs: 30_000 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'tree is not available';
    throw new HttpError(404, message);
  }
  return parseTreeLines(result.stdout, directory);
}

function parseTreeLines(stdout: string, directory: string): TreeEntry[] {
  const entries: TreeEntry[] = [];
  for (const line of stdout.split('\n')) {
    if (line.length === 0) continue;
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const meta = line.slice(0, tab).split(/\s+/);
    const name = line.slice(tab + 1);
    const mode = meta[0] ?? '';
    const type = meta[1] ?? '';
    const oid = meta[2] ?? '';
    const size = meta[3] ?? '-';
    const child = directory.length === 0 ? name : `${directory}/${name}`;
    const base = child.split('/').at(-1) ?? child;
    entries.push({
      name: base,
      path: child,
      kind: type === 'tree' ? 'tree' : type === 'commit' ? 'submodule' : mode === '120000' ? 'symlink' : 'blob',
      mode,
      oid,
      sizeBytes: size === '-' ? null : Number(size),
    });
  }
  return entries;
}

export async function listTreeRecursive(gitDir: string, ref: string): Promise<TreeEntry[]> {
  assertRef(ref);
  let result;
  try {
    result = await runGit(['ls-tree', '-r', '-l', ref], { gitDir, allowFileProtocol: true, timeoutMs: 60_000 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'tree is not available';
    throw new HttpError(404, message);
  }
  return parseTreeLines(result.stdout, '');
}

export async function readBlob(gitDir: string, ref: string, filePath: string): Promise<{
  ref: string;
  path: string;
  oid: string;
  sizeBytes: number;
  binary: boolean;
  truncated: boolean;
  content: string | null;
}> {
  assertRef(ref);
  assertRelative(filePath);
  const resolved = await runGit(['rev-parse', '--verify', `${ref}:${filePath}`], {
    gitDir,
    allowFileProtocol: true,
    timeoutMs: 30_000,
  }).catch(() => null);
  const oid = resolved?.stdout.trim();
  if (!oid) throw new HttpError(404, 'file not found');
  const object = await runGit(['cat-file', '-s', oid], { gitDir, allowFileProtocol: true, timeoutMs: 30_000 });
  const size = Number(object.stdout.trim());
  if (!Number.isFinite(size)) throw new HttpError(404, 'file not found');
  if (size > 200_000) {
    return { ref, path: filePath, oid, sizeBytes: size, binary: true, truncated: true, content: null };
  }
  const blob = await runGit(['cat-file', 'blob', oid], { gitDir, allowFileProtocol: true, timeoutMs: 30_000 });
  const binary = blob.stdout.includes('\0');
  return {
    ref,
    path: filePath,
    oid,
    sizeBytes: size,
    binary,
    truncated: false,
    content: binary ? null : blob.stdout,
  };
}

export async function readCommits(gitDir: string, ref: string, cursor: string | null, limit: number): Promise<{ items: CommitView[]; nextCursor: string | null }> {
  assertRef(ref);
  const args = ['log', `--max-count=${limit + 1}`, '--format=%H%x1f%P%x1f%an%x1f%aI%x1f%s', cursor ?? ref];
  const result = await runGit(args, { gitDir, allowFileProtocol: true, timeoutMs: 30_000 });
  const rows = result.stdout.split('\n').filter((line) => line.length > 0);
  const sliced = cursor ? rows.slice(1) : rows;
  const page = sliced.slice(0, limit).map(parseCommit);
  const next = sliced.length > limit ? page[page.length - 1]?.oid ?? null : null;
  return { items: page, nextCursor: next };
}

export function localAsset(archiveRoot: string, relativePath: string): { stream: ReturnType<typeof createReadStream>; name: string; size: Promise<number> } {
  const full = resolveInside(archiveRoot, relativePath);
  return {
    stream: createReadStream(full),
    name: path.basename(full),
    size: stat(full).then((info) => info.size),
  };
}

function parseCommit(line: string): CommitView {
  const [oid, parents, authorName, authoredAt, summary] = line.split('\u001f');
  return {
    oid: oid ?? '',
    shortOid: (oid ?? '').slice(0, 12),
    summary: summary ?? '',
    authorName: authorName ?? '',
    authoredAt: authoredAt ?? '',
    parentOids: parents ? parents.split(' ').filter((item) => item.length > 0) : [],
  };
}

function assertRef(ref: string): void {
  if (ref === 'HEAD') return;
  if (!isValidRefName(ref)) throw new HttpError(400, 'ref name is not allowed');
}

function assertRelative(value: string): void {
  if (value.includes('\0') || value.startsWith('/') || value.includes('\\') || value.split('/').includes('..')) {
    throw new HttpError(400, 'path is not allowed');
  }
}
