import path from 'node:path';
import type { CatalogService } from './catalog';
import type { StorageService } from './storage';
import type { WorkingRepositoryService, WorkingRepoRecord } from './working-repos';
import { HttpError } from '../errors';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKING_PATTERN = /^[a-z0-9][a-z0-9._-]{0,62}$/i;

export type GitRouteTarget =
  | { kind: 'archive'; repositoryId: string; gitDir: string; readOnly: true }
  | { kind: 'working'; working: WorkingRepoRecord; gitDir: string; readOnly: false };

export class GitAccessService {
  constructor(
    private readonly catalog: CatalogService,
    private readonly storage: StorageService,
    private readonly working: WorkingRepositoryService,
  ) {}

  resolveArchive(repositoryId: string): GitRouteTarget {
    if (!UUID_PATTERN.test(repositoryId)) throw new HttpError(404, 'repository not found');
    const repo = this.catalog.require(repositoryId);
    const located = this.storage.pathsFor(repo.storagePoolId, repo.id);
    return { kind: 'archive', repositoryId: repo.id, gitDir: located.paths.gitDir, readOnly: true };
  }

  resolveWorking(name: string): GitRouteTarget {
    if (!WORKING_PATTERN.test(name)) throw new HttpError(404, 'working repository not found');
    const working = this.working.get(name);
    return { kind: 'working', working, gitDir: this.working.gitDir(working), readOnly: false };
  }

  parseSshRepository(argument: string): { target: GitRouteTarget; operation: 'fetch' | 'push' } {
    const trimmed = argument.trim();
    if (trimmed.startsWith('archive/')) {
      const id = trimmed.slice('archive/'.length).replace(/\.git$/, '');
      return { target: this.resolveArchive(id), operation: 'fetch' };
    }
    if (trimmed.startsWith('working/')) {
      const name = trimmed.slice('working/'.length).replace(/\.git$/, '');
      const target = this.resolveWorking(name);
      return { target, operation: 'push' };
    }
    throw new HttpError(404, 'repository not found');
  }

  cloneUrls(repositoryId: string, publicBaseUrl: string | null, sshHost: string | null, sshPort: number): { https: string | null; ssh: string | null } {
    if (!publicBaseUrl) return { https: null, ssh: null };
    const base = publicBaseUrl.replace(/\/$/, '');
    const https = `${base}/git/archive/${repositoryId}.git`;
    const host = sshHost ?? new URL(base).hostname;
    const ssh = `ssh://git@${host}:${sshPort}/archive/${repositoryId}.git`;
    return { https, ssh };
  }

  safePathInside(root: string, candidate: string): string {
    const resolved = path.resolve(candidate);
    const prefix = path.resolve(root);
    if (resolved !== prefix && !resolved.startsWith(`${prefix}${path.sep}`)) {
      throw new HttpError(403, 'path escapes repository root');
    }
    return resolved;
  }
}
