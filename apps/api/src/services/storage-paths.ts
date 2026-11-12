import { accessSync, constants, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export interface StoragePathCandidate {
  path: string;
  label: string;
  kind: 'data-dir' | 'sibling' | 'pool' | 'mount' | 'configured';
  freeBytes: number;
  totalBytes: number;
}

const VIRTUAL_FSTYPES = new Set([
  'proc',
  'sysfs',
  'devpts',
  'tmpfs',
  'cgroup',
  'cgroup2',
  'pstore',
  'bpf',
  'tracefs',
  'debugfs',
  'securityfs',
  'hugetlbfs',
  'mqueue',
  'configfs',
  'fusectl',
  'binfmt_misc',
  'autofs',
  'devtmpfs',
]);

function isWritableDirectory(dir: string): boolean {
  try {
    accessSync(dir, constants.R_OK | constants.W_OK | constants.X_OK);
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function decodeMountPoint(raw: string): string {
  return raw.replace(/\\040/g, ' ').replace(/\\011/g, '\t');
}

export function storageRootsFromEnv(): string[] {
  const raw = process.env.FONDS_STORAGE_ROOTS;
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => path.resolve(entry));
}

export function mountPointsUnderAnchors(anchors: string[]): Array<{ path: string; label: string }> {
  const resolvedAnchors = [...new Set(anchors.map((anchor) => path.resolve(anchor)))];
  if (!resolvedAnchors.length) return [];

  let text: string;
  try {
    text = readFileSync('/proc/mounts', 'utf8');
  } catch {
    return [];
  }

  const seen = new Set<string>();
  const out: Array<{ path: string; label: string }> = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split(' ');
    if (parts.length < 4) continue;
    const mountPoint = path.resolve(decodeMountPoint(parts[1]));
    const fstype = parts[2];
    const options = parts[3];
    if (VIRTUAL_FSTYPES.has(fstype)) continue;
    if (options.split(',').includes('ro')) continue;
    if (!resolvedAnchors.some((anchor) => mountPoint === anchor || mountPoint.startsWith(`${anchor}${path.sep}`))) continue;
    if (seen.has(mountPoint)) continue;
    if (!isWritableDirectory(mountPoint)) continue;
    seen.add(mountPoint);
    out.push({ path: mountPoint, label: `Mount (${fstype})` });
  }
  return out;
}

export function listDataDirChildren(dataDir: string, probe: (dir: string) => { freeBytes: number; totalBytes: number }): StoragePathCandidate[] {
  const out: StoragePathCandidate[] = [];
  let names: string[];
  try {
    names = readdirSync(dataDir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (name === 'app') continue;
    const full = path.join(dataDir, name);
    if (!existsSync(full) || !isWritableDirectory(full)) continue;
    const space = probe(full);
    const kind = name.startsWith('pool') ? 'pool' : 'sibling';
    out.push({
      path: path.resolve(full),
      label: name,
      kind,
      freeBytes: space.freeBytes,
      totalBytes: space.totalBytes,
    });
  }
  return out;
}
