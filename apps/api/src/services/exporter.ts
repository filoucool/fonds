import { cp, mkdir, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { runGit } from '@repo-archive/git-exec';
import type { ExportFormat, ExportRecord } from '@repo-archive/shared';
import { HttpError } from '../errors';
import { asRow, id, integerOrNull, nowIso, text, textOrNull } from '../rows';
import type { CatalogService } from './catalog';
import type { StorageService } from './storage';
import { makeGitDirReadOnly, makeGitDirWritable } from './archive-readonly';

export class ExportService {
  constructor(
    private readonly sqlite: Database.Database,
    private readonly catalog: CatalogService,
    private readonly storage: StorageService,
    private readonly dataDir: string,
  ) {}

  create(repositoryId: string, format: ExportFormat): { id: string } {
    this.catalog.require(repositoryId);
    const exportId = id();
    this.sqlite
      .prepare(`INSERT INTO exports (id, repository_id, format, status, created_at) VALUES (?, ?, ?, 'queued', ?)`)
      .run(exportId, repositoryId, format, nowIso());
    return { id: exportId };
  }

  async run(exportId: string): Promise<void> {
    const row = this.requireRow(exportId);
    const repo = this.catalog.require(text(row, 'repository_id'));
    const located = this.storage.pathsFor(repo.storagePoolId, repo.id);
    const root = path.join(this.dataDir, 'exports', exportId);
    await mkdir(root, { recursive: true });
    this.sqlite.prepare(`UPDATE exports SET status = 'running' WHERE id = ?`).run(exportId);
    makeGitDirWritable(located.paths.gitDir);
    try {
      const format = text(row, 'format');
      if (format === 'bundle') {
        await cp(located.paths.manifest, path.join(root, 'archive.json'));
        await cp(located.paths.checksums, path.join(root, 'checksums.json')).catch(() => undefined);
        await runGit(['bundle', 'create', path.join(root, 'repository.bundle'), '--all'], {
          gitDir: located.paths.gitDir,
          allowFileProtocol: true,
          timeoutMs: 60 * 60 * 1000,
        });
        await writeText(path.join(root, 'EXPORT.txt'), 'Clone with: git clone repository.bundle repo\n');
      } else {
        const directory = path.join(root, 'archive');
        await cp(located.paths.root, directory, { recursive: true, verbatimSymlinks: true });
        await writeText(path.join(root, 'PACKAGE.txt'), 'Portable archive directory. Verify checksums.json before trusting the copy.\n');
        if (format === 'package') await tarDirectory(root, path.join(root, 'archive.tar.gz'), 'archive');
      }
      const info = await stat(root);
      this.sqlite.prepare(`UPDATE exports SET status = 'completed', relative_path = ?, byte_size = ?, finished_at = ? WHERE id = ?`).run(path.relative(this.dataDir, root), info.size, nowIso(), exportId);
      this.catalog.event(repo.id, 'export.completed', `Exported ${format}`, { exportId });
    } catch (error) {
      this.sqlite.prepare(`UPDATE exports SET status = 'failed', error = ?, finished_at = ? WHERE id = ?`).run(error instanceof Error ? error.message : 'export failed', nowIso(), exportId);
      throw error;
    } finally {
      try {
        makeGitDirReadOnly(located.paths.gitDir);
      } catch {
        // Some filesystems reject chmod.
      }
    }
  }

  get(exportId: string): ExportRecord {
    return mapExport(this.requireRow(exportId));
  }

  private requireRow(exportId: string): Record<string, unknown> {
    const row = asRow(this.sqlite.prepare(`SELECT * FROM exports WHERE id = ?`).get(exportId));
    if (!row) throw new HttpError(404, 'export not found');
    return row;
  }

  download(exportId: string): { directory: string; file: string | null } {
    const row = this.requireRow(exportId);
    if (text(row, 'status') !== 'completed' || !textOrNull(row, 'relative_path')) throw new HttpError(409, 'export is not ready');
    const directory = path.resolve(this.dataDir, text(row, 'relative_path'));
    const prefix = path.resolve(this.dataDir, 'exports');
    if (!directory.startsWith(`${prefix}${path.sep}`)) throw new HttpError(400, 'export path is not allowed');
    const format = text(row, 'format');
    if (format === 'bundle') return { directory, file: path.join(directory, 'repository.bundle') };
    if (format === 'package') return { directory, file: path.join(directory, 'archive.tar.gz') };
    return { directory, file: null };
  }
}

function mapExport(row: Record<string, unknown>): ExportRecord {
  const format = text(row, 'format');
  if (format !== 'bundle' && format !== 'directory' && format !== 'package') throw new Error('export format is invalid');
  return {
    id: text(row, 'id'),
    repositoryId: text(row, 'repository_id'),
    format,
    status: text(row, 'status'),
    byteSize: integerOrNull(row, 'byte_size'),
    error: textOrNull(row, 'error'),
    createdAt: text(row, 'created_at'),
    finishedAt: textOrNull(row, 'finished_at'),
  };
}

async function writeText(file: string, contents: string): Promise<void> {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(file, contents);
}

function tarDirectory(cwd: string, destination: string, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', ['-czf', destination, '-C', cwd, name], { stdio: 'ignore' });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tar exited ${code}`));
    });
  });
}
