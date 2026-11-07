import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { assertFetchUrlShape } from '@repo-archive/shared';
import { GitCommandError, isOid, isValidRefName, runGit, type GitRunOptions } from './executor';

export type RefNamespace = 'heads' | 'tags' | 'notes' | 'pull' | 'merge-requests';

export interface RefTip {
  name: string;
  oid: string;
}

export interface ProtectedRef {
  name: string;
  oid: string;
  reason: 'updated' | 'deleted';
  sourceRef: string;
}

export interface SyncBareInput {
  gitDir: string;
  remoteUrl: string;
  namespaces: RefNamespace[];
  timeoutMs?: number;
  signal?: AbortSignal;
  allowFileProtocol?: boolean;
  gitBinary?: string;
  auth?: { username: string; token: string };
  recordedAt: string;
  templateDir?: string;
}

export interface SyncBareResult {
  current: RefTip[];
  protectedRefs: ProtectedRef[];
  defaultBranch: string | null;
  warnings: string[];
}

const NAMESPACE_PREFIX: Record<RefNamespace, string> = {
  heads: 'refs/heads/',
  tags: 'refs/tags/',
  notes: 'refs/notes/',
  pull: 'refs/pull/',
  'merge-requests': 'refs/merge-requests/',
};

export async function syncBareRepository(input: SyncBareInput): Promise<SyncBareResult> {
  assertFetchUrlShape(input.remoteUrl, input.allowFileProtocol === true);
  await mkdir(path.dirname(input.gitDir), { recursive: true });
  await ensureBareRepo(input);
  const remote = await listRemoteRefs(input);
  await fetchObjects(input);
  await assertObjectsExist(input, remote.refs.map((ref) => ref.oid));
  return publishProtected(input, remote);
}

export async function listRemoteRefs(input: SyncBareInput): Promise<{ refs: RefTip[]; defaultBranch: string | null }> {
  const patterns = ['HEAD', ...input.namespaces.map((namespace) => `${NAMESPACE_PREFIX[namespace]}*`)];
  const result = await git(input, ['ls-remote', '--symref', input.remoteUrl, ...patterns]);
  const refs: RefTip[] = [];
  let defaultBranch: string | null = null;
  for (const line of result.stdout.split('\n')) {
    if (line.length === 0) continue;
    if (line.startsWith('ref:')) {
      const match = /^ref:\s+(\S+)\s+HEAD$/.exec(line);
      if (match?.[1]?.startsWith('refs/heads/')) defaultBranch = match[1];
      continue;
    }
    const [oid, name] = line.split('\t');
    if (!oid || !name || name.endsWith('^{}') || name === 'HEAD') continue;
    if (!isOid(oid) || !isValidRefName(name)) continue;
    if (!input.namespaces.some((namespace) => name.startsWith(NAMESPACE_PREFIX[namespace]))) continue;
    refs.push({ name, oid });
  }
  return { refs, defaultBranch };
}

export async function fetchObjects(input: SyncBareInput): Promise<void> {
  const refspecs = input.namespaces.map(
    (namespace) => `+${NAMESPACE_PREFIX[namespace]}*:refs/staging/${namespace}/*`,
  );
  if (refspecs.length === 0) return;
  await git(input, [
    'fetch',
    '--no-recurse-submodules',
    '--no-tags',
    input.remoteUrl,
    ...refspecs,
  ]);
}

export async function publishProtected(
  input: SyncBareInput,
  remote: { refs: RefTip[]; defaultBranch: string | null },
): Promise<SyncBareResult> {
  const desired = new Map(remote.refs.map((ref) => [ref.name, ref.oid]));
  const current = await listLocalRefs(input, input.namespaces.map((namespace) => NAMESPACE_PREFIX[namespace].replace(/\/$/, '')));
  const keeps = new Set((await listLocalRefs(input, ['refs/archive/keep'])).map((ref) => ref.name));
  const warnings: string[] = [];
  const protectedRefs: ProtectedRef[] = [];
  const lines = ['start'];
  const stamp = `${input.recordedAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}-${randomUUID().slice(0, 8)}`;

  for (const ref of current) {
    const next = desired.get(ref.name);
    if (next === ref.oid) continue;
    const reason = next === undefined ? 'deleted' : 'updated';
    const keep = `refs/archive/keep/${ref.oid}`;
    if (!keeps.has(keep)) {
      lines.push(`create ${keep} ${ref.oid}`);
      keeps.add(keep);
    }
    const history = historyRef(ref.name, stamp, ref.oid);
    if (history && isValidRefName(history)) {
      lines.push(`create ${history} ${ref.oid}`);
      protectedRefs.push({ name: history, oid: ref.oid, reason, sourceRef: ref.name });
    } else {
      warnings.push(`preserved ${ref.oid} without a history ref for ${ref.name}`);
      protectedRefs.push({ name: keep, oid: ref.oid, reason, sourceRef: ref.name });
    }
  }

  for (const ref of remote.refs) {
    const previous = current.find((item) => item.name === ref.name);
    if (!previous) lines.push(`create ${ref.name} ${ref.oid}`);
    else if (previous.oid !== ref.oid) lines.push(`update ${ref.name} ${ref.oid} ${previous.oid}`);
  }
  for (const ref of current) {
    if (!desired.has(ref.name)) lines.push(`delete ${ref.name} ${ref.oid}`);
  }
  lines.push('commit');
  if (lines.length > 2) {
    await git(input, ['update-ref', '--stdin'], { input: `${lines.join('\n')}\n` });
  }
  if (remote.defaultBranch && desired.has(remote.defaultBranch) && isValidRefName(remote.defaultBranch)) {
    try {
      await git(input, ['symbolic-ref', 'HEAD', remote.defaultBranch]);
    } catch {
      warnings.push('unable to update HEAD');
    }
  }
  const published = await listLocalRefs(
    input,
    input.namespaces.map((namespace) => NAMESPACE_PREFIX[namespace].replace(/\/$/, '')),
  );
  return { current: published, protectedRefs, defaultBranch: remote.defaultBranch, warnings };
}

export async function listLocalRefs(input: Pick<SyncBareInput, 'gitDir' | 'timeoutMs' | 'signal' | 'gitBinary' | 'allowFileProtocol'>, prefixes: string[]): Promise<RefTip[]> {
  if (prefixes.length === 0) return [];
  const result = await git(input, ['for-each-ref', `--format=%(objectname)%09%(refname)`, ...prefixes]);
  const refs: RefTip[] = [];
  for (const line of result.stdout.split('\n')) {
    if (line.length === 0) continue;
    const [oid, name] = line.split('\t');
    if (!oid || !name || !isOid(oid)) continue;
    refs.push({ name, oid });
  }
  return refs;
}

async function assertObjectsExist(input: SyncBareInput, oids: string[]): Promise<void> {
  const unique = [...new Set(oids)];
  if (unique.length === 0) return;
  const result = await git(input, ['cat-file', '--batch-check'], { input: `${unique.join('\n')}\n` });
  const missing = result.stdout
    .split('\n')
    .filter((line) => line.endsWith(' missing') || line.includes(' missing'));
  if (missing.length > 0) {
    throw new GitCommandError('fetch did not download every advertised object', 1, missing.join('\n'), ['cat-file']);
  }
}

async function ensureBareRepo(input: SyncBareInput): Promise<void> {
  const marker = await git(input, ['rev-parse', '--is-bare-repository']).catch(() => null);
  if (marker?.stdout.trim() === 'true') return;
  const args = ['init', '--bare', '--initial-branch=main'];
  if (input.templateDir) args.push(`--template=${input.templateDir}`);
  args.push(input.gitDir);
  const options = baseOptions(input);
  delete options.gitDir;
  await runGit(args, options);
  await git(input, ['config', '--local', 'core.hooksPath', '/dev/null']);
  await git(input, ['config', '--local', 'gc.auto', '0']);
  await git(input, ['config', '--local', 'gc.pruneExpire', 'never']);
}

function historyRef(sourceRef: string, stamp: string, oid: string): string | null {
  const rest = sourceRef.replace(/^refs\//, '');
  return `refs/archive/history/${rest}/${stamp}-${oid.slice(0, 12)}`;
}

async function git(
  input: Pick<SyncBareInput, 'gitDir' | 'timeoutMs' | 'signal' | 'gitBinary' | 'allowFileProtocol' | 'auth' | 'remoteUrl'> | Pick<SyncBareInput, 'gitDir' | 'timeoutMs' | 'signal' | 'gitBinary' | 'allowFileProtocol'>,
  args: string[],
  extra?: { input?: string },
) {
  const options = baseOptions(input);
  if ('auth' in input) options.auth = input.auth;
  if ('remoteUrl' in input && (input.remoteUrl.startsWith('/') || input.remoteUrl.startsWith('file:'))) {
    options.allowFileProtocol = true;
  }
  return runGit(args, { ...options, input: extra?.input });
}

function baseOptions(
  input: Pick<SyncBareInput, 'gitDir' | 'timeoutMs' | 'signal' | 'gitBinary' | 'allowFileProtocol'>,
): GitRunOptions {
  return {
    gitDir: input.gitDir,
    timeoutMs: input.timeoutMs ?? 60_000,
    signal: input.signal,
    gitBinary: input.gitBinary,
    allowFileProtocol: input.allowFileProtocol === true,
  };
}
