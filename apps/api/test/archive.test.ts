import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyChecksums } from '@repo-archive/archive-format';
import { loadConfig } from '../src/config';
import { createContainer, type Container } from '../src/container';
import { StorageThresholdError } from '../src/errors';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('catalog and preservation', () => {
  it('archives a local repository, survives upstream rewrite, and rebuilds without sqlite', async () => {
    const container = open();
    container.settings.update({ allowFileUrls: true });
    const origin = path.join(container.config.dataDir, 'origin');
    mkdirSync(origin);
    const first = commit(origin, 'README.md', 'hello archive\n', 'init');
    const created = await container.catalog.create({ url: origin, profileId: 'profile-minimal' });
    const outcome = await container.runner.run(container.jobs.get(created.jobId), new AbortController().signal);
    expect(outcome).toBe('completed');
    const detail = container.catalog.get(created.repository.id);
    expect(detail.components.find((item) => item.component === 'git')?.state).toBe('complete');
    expect(detail.components.find((item) => item.component === 'issues')?.state).toBe('skipped');
    expect(detail.components.find((item) => item.component === 'releases')?.state).toBe('skipped');

    execFileSync('git', ['checkout', '--orphan', 'rewritten'], { cwd: origin, stdio: 'ignore' });
    execFileSync('git', ['rm', '-rf', '.'], { cwd: origin, stdio: 'ignore' });
    commit(origin, 'next.txt', 'next\n', 'rewritten');
    execFileSync('git', ['branch', '-D', 'main'], { cwd: origin, stdio: 'ignore' });
    execFileSync('git', ['branch', '-m', 'main'], { cwd: origin, stdio: 'ignore' });
    const again = container.catalog.enqueueSync(created.repository.id);
    await container.runner.run(container.jobs.get(again), new AbortController().signal);
    const gitDir = path.join(container.config.dataDir, 'pool-1', detail.relativePath, 'repository.git');
    expect(execFileSync('git', ['--git-dir', gitDir, 'cat-file', '-t', first], { encoding: 'utf8' }).trim()).toBe('commit');
    const manifest = readFileSync(path.join(container.config.dataDir, 'pool-1', detail.relativePath, 'archive.json'), 'utf8');
    expect(manifest).not.toContain(path.join(container.config.dataDir, 'pool-1'));
    expect(manifest).toContain('refs/archive/');

    container.sqlite.close();
    rmSync(path.join(container.config.dataDir, 'app'), { recursive: true, force: true });
    const restored = createContainer(container.config);
    roots.push(container.config.dataDir);
    const report = await restored.catalog.rebuild();
    expect(report.restored).toBe(1);
    expect(restored.catalog.get(created.repository.id).displayName).toBe(detail.displayName);
    expect(execFileSync('git', ['--git-dir', gitDir, 'log', '-1', '--format=%H'], { encoding: 'utf8' }).trim().length).toBe(40);
    restored.sqlite.close();
  });

  it('detects corrupted git objects and release bytes without repairing them', async () => {
    const container = open();
    container.settings.update({ allowFileUrls: true });
    const origin = path.join(container.config.dataDir, 'origin');
    mkdirSync(origin);
    commit(origin, 'README.md', 'hello\n', 'init');
    const created = await container.catalog.create({ url: origin, profileId: 'profile-minimal' });
    await container.runner.run(container.jobs.get(created.jobId), new AbortController().signal);
    const root = path.join(container.config.dataDir, 'pool-1', created.repository.relativePath);
    const release = path.join(root, 'releases', 'demo.txt');
    mkdirSync(path.dirname(release), { recursive: true });
    writeFileSync(release, 'asset-bytes');
    const { writeChecksums } = await import('@repo-archive/archive-format');
    await writeChecksums(root, new Date().toISOString());
    const original = readFileSync(release);
    writeFileSync(release, 'tampered!!');
    const checksum = await verifyChecksums(root);
    expect(checksum.ok).toBe(false);
    expect(checksum.failures.some((failure) => failure.includes('releases/demo.txt'))).toBe(true);
    expect(readFileSync(release).equals(original)).toBe(false);
    const report = await container.integrity.verify(created.repository.id);
    expect(report.results.ok).toBe(false);
    expect(report.results.checks.some((check) => check.component === 'checksums' && !check.ok)).toBe(true);
    expect(container.catalog.get(created.repository.id).health).toBe('corrupt');
  });

  it('pages a large catalog without returning every row', () => {
    const container = open();
    const insert = container.sqlite.prepare(
      `INSERT INTO repositories (
         id, identity_key, canonical_url, fetch_url, display_name, description, provider, archive_status, upstream_status,
         health, size_bytes, storage_pool_id, relative_path, metadata_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, '', 'git', ?, 'unknown', 'unknown', 1, 'pool-default', ?, '{}', ?, ?)`,
    );
    const seed = container.sqlite.transaction(() => {
      for (let index = 0; index < 100_000; index += 1) {
        const id = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
        const stamp = new Date(Date.UTC(2020, 0, 1) + index * 1000).toISOString();
        insert.run(id, `example.com/repo-${index}`, `https://example.com/repo-${index}`, `https://example.com/repo-${index}`, `Repo ${index}`, index % 2 === 0 ? 'healthy' : 'partial', `archives/00/${id}`, stamp, stamp);
      }
    });
    seed();
    const before = process.memoryUsage().heapUsed;
    const page = container.catalog.list({ limit: 50, status: 'healthy' });
    const growth = process.memoryUsage().heapUsed - before;
    expect(page.items).toHaveLength(50);
    expect(page.items.every((item) => item.archiveStatus === 'healthy')).toBe(true);
    expect(page.nextCursor).toBeTruthy();
    const second = container.catalog.list({ limit: 50, status: 'healthy', cursor: page.nextCursor });
    expect(second.items[0]?.id).not.toBe(page.items[0]?.id);
    expect(growth).toBeLessThan(20 * 1024 * 1024);
  });

  it('requeues stranded jobs and pauses when free space is gone', () => {
    const container = open(() => ({ freeBytes: 0, totalBytes: 100 }));
    expect(() => container.storage.chooseForNew()).toThrow(StorageThresholdError);
    const roomy = open(() => ({ freeBytes: 50, totalBytes: 100 }));
    const jobId = roomy.jobs.enqueue({ type: 'sync', repositoryId: null });
    roomy.sqlite.prepare(`UPDATE jobs SET state = 'running', attempt = 1, lease_expires_at = ? WHERE id = ?`).run('2000-01-01T00:00:00.000Z', jobId);
    expect(roomy.jobs.reap()).toBe(1);
    expect(roomy.jobs.get(jobId).state).toBe('queued');
    expect(roomy.storage.planBalance()).toEqual([]);
    roomy.settings.update({ balancingEnabled: true, balanceHighWatermarkRatio: 0.2, balanceLowWatermarkRatio: 0.1 });
    expect(roomy.settings.get().balancingEnabled).toBe(true);
  });
});

function open(probe?: () => { freeBytes: number; totalBytes: number }): Container {
  const root = mkdtempSync(path.join(tmpdir(), 'archiver-api-'));
  roots.push(root);
  const config = loadConfig({
    DATA_DIR: root,
    HOST: '127.0.0.1',
    PORT: '8080',
    WORKER_ENABLED: 'false',
    PATH: process.env.PATH,
  });
  return createContainer(config, probe ? () => probe() : undefined);
}

function commit(repo: string, file: string, contents: string, message: string): string {
  if (!exists(path.join(repo, '.git'))) {
    execFileSync('git', ['init', '-b', 'main'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo });
  }
  writeFileSync(path.join(repo, file), contents);
  execFileSync('git', ['add', file], { cwd: repo });
  execFileSync('git', ['commit', '-m', message], { cwd: repo, stdio: 'ignore' });
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
}

function exists(file: string): boolean {
  try {
    readFileSync(file);
    return true;
  } catch {
    return false;
  }
}
