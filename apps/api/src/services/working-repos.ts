import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { runGit } from '@fonds/git-exec';
import { HttpError } from '../errors';
import { asRow, id, nowIso, text } from '../rows';

const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,62}$/i;

export interface WorkingRepoRecord {
  id: string;
  name: string;
  archiveRepositoryId: string | null;
  relativePath: string;
  createdAt: string;
  updatedAt: string;
}

export class WorkingRepositoryService {
  constructor(
    private readonly sqlite: Database.Database,
    private readonly dataDir: string,
  ) {}

  root(): string {
    return path.join(this.dataDir, 'working-repos');
  }

  gitDir(record: WorkingRepoRecord): string {
    return path.join(this.root(), record.relativePath);
  }

  list(): WorkingRepoRecord[] {
    return (
      this.sqlite
        .prepare(`SELECT id, name, archive_repository_id, relative_path, created_at, updated_at FROM working_repositories ORDER BY name COLLATE NOCASE`)
        .all() as Record<string, unknown>[]
    ).map(mapRow);
  }

  get(idOrName: string): WorkingRepoRecord {
    const row = asRow(
      this.sqlite
        .prepare(
          `SELECT id, name, archive_repository_id, relative_path, created_at, updated_at FROM working_repositories
           WHERE id = ? OR name = ? COLLATE NOCASE`,
        )
        .get(idOrName, idOrName),
    );
    if (!row) throw new HttpError(404, 'working repository not found');
    return mapRow(row);
  }

  async create(input: { name: string; archiveRepositoryId?: string | null; fromArchiveGitDir?: string }): Promise<WorkingRepoRecord> {
    const name = input.name.trim();
    if (!NAME_PATTERN.test(name)) throw new HttpError(400, 'working repository name is invalid');
    const repoId = id();
    const relativePath = path.join(name, 'repository.git');
    const gitDir = path.join(this.root(), relativePath);
    await mkdir(path.dirname(gitDir), { recursive: true, mode: 0o700 });
    if (input.fromArchiveGitDir) {
      await cp(input.fromArchiveGitDir, gitDir, { recursive: true, force: false });
    } else {
      await runGit(['init', '--bare', gitDir], { allowFileProtocol: true, timeoutMs: 60_000 });
    }
    const now = nowIso();
    this.sqlite
      .prepare(
        `INSERT INTO working_repositories (id, name, archive_repository_id, relative_path, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(repoId, name, input.archiveRepositoryId ?? null, relativePath, now, now);
    return this.get(repoId);
  }

  delete(workingId: string): void {
    this.get(workingId);
    this.sqlite.prepare(`DELETE FROM working_repositories WHERE id = ?`).run(workingId);
  }
}

function mapRow(row: Record<string, unknown>): WorkingRepoRecord {
  return {
    id: text(row, 'id'),
    name: text(row, 'name'),
    archiveRepositoryId: row.archive_repository_id === null ? null : text(row, 'archive_repository_id'),
    relativePath: text(row, 'relative_path'),
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
  };
}
