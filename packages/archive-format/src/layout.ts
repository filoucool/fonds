import path from 'node:path';

export function archiveRelativePath(id: string): string {
  return `archives/${id.slice(0, 2)}/${id}`;
}

export interface ArchivePaths {
  root: string;
  gitDir: string;
  manifest: string;
  checksums: string;
  metadata: string;
  releases: string;
  lfs: string;
  wikiGit: string;
  syncRecords: string;
  submodules: string;
  docs: string;
}

export function archivePaths(poolRoot: string, id: string): ArchivePaths {
  const root = path.join(poolRoot, 'archives', id.slice(0, 2), id);
  return {
    root,
    gitDir: path.join(root, 'repository.git'),
    manifest: path.join(root, 'archive.json'),
    checksums: path.join(root, 'checksums.json'),
    metadata: path.join(root, 'metadata'),
    releases: path.join(root, 'releases'),
    lfs: path.join(root, 'lfs'),
    wikiGit: path.join(root, 'wiki', 'wiki.git'),
    syncRecords: path.join(root, 'sync-records'),
    submodules: path.join(root, 'submodules'),
    docs: path.join(root, 'metadata', 'docs'),
  };
}

export function toPosixRelative(root: string, filePath: string): string {
  const relative = path.relative(root, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('path escapes archive root');
  }
  return relative.split(path.sep).join('/');
}

export function resolveInside(root: string, relativePath: string): string {
  if (relativePath.includes('\0') || path.isAbsolute(relativePath)) {
    throw new Error('archive path is not allowed');
  }
  const normalized = relativePath.split('\\').join('/');
  if (normalized.split('/').includes('..')) throw new Error('archive path is not allowed');
  const target = path.resolve(root, normalized);
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (target !== root && !target.startsWith(prefix)) throw new Error('path escapes archive root');
  return target;
}

export function isGitPayloadPath(relativePath: string): boolean {
  const parts = relativePath.split('/');
  if (parts[0] === 'repository.git') return true;
  if (parts[0] === 'wiki' && parts[1] === 'wiki.git') return true;
  return parts.some((part) => part.endsWith('.git'));
}

export function sanitizeFileName(name: string): string {
  const base = name.split('/').join('_').split('\\').join('_').replace(/[\u0000-\u001f]/g, '');
  const cleaned = base.replace(/^\.+/, '').trim();
  return cleaned.length > 0 ? cleaned.slice(0, 180) : 'file';
}
