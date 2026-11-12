import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyChecksums } from '@fonds/archive-format';
import { standardProfile } from '@fonds/shared';
import { loadConfig } from '../src/config';
import { createContainer, type Container } from '../src/container';
import { StorageThresholdError } from '../src/errors';
import { listTreeRecursive } from '../src/services/browse';
import { makeGitDirWritable } from '../src/services/archive-readonly';
import { providerFor } from '../src/services/providers';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    try {
      makeGitDirWritable(root);
    } catch {
      // ignore
    }
    rmSync(root, { recursive: true, force: true });
  }
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
    const { writeChecksums } = await import('@fonds/archive-format');
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

  it('exports nested documentation and keeps profile coverage distinct', async () => {
    const container = open();
    container.settings.update({ allowFileUrls: true });
    const origin = path.join(container.config.dataDir, 'origin');
    mkdirSync(path.join(origin, 'docs'), { recursive: true });
    commit(origin, 'docs/guide.md', 'nested guide\n', 'docs');
    const created = await container.catalog.create({ url: origin, profileId: 'profile-standard' });
    await container.runner.run(container.jobs.get(created.jobId), new AbortController().signal);
    const archived = path.join(container.config.dataDir, 'pool-1', created.repository.relativePath, 'metadata', 'docs', 'guide.md');
    expect(readFileSync(archived, 'utf8')).toBe('nested guide\n');
    const detail = container.catalog.get(created.repository.id);
    expect(detail.components.find((item) => item.component === 'issues')?.state).toBe('skipped');

    const other = path.join(container.config.dataDir, 'origin-complete');
    mkdirSync(path.join(other, 'docs'), { recursive: true });
    commit(other, 'docs/guide.md', 'nested guide\n', 'docs');
    const full = await container.catalog.create({ url: other, profileId: 'profile-complete' });
    await container.runner.run(container.jobs.get(full.jobId), new AbortController().signal);
    const fullDetail = container.catalog.get(full.repository.id);
    expect(fullDetail.components.find((item) => item.component === 'docs')?.state).toBe('complete');
    expect(fullDetail.components.find((item) => item.component === 'issues')?.state).toBe('unsupported');
    expect(providerFor('github').capabilities().has('discussions')).toBe(true);
    expect(providerFor('gitlab').capabilities().has('issues')).toBe(true);
    expect(providerFor('gitlab').capabilities().has('discussions')).toBe(false);
    expect(providerFor('git').capabilities().has('issues')).toBe(false);
  });

  it('stops docs export at the component byte limit', async () => {
    const container = open();
    container.settings.update({ allowFileUrls: true });
    const config = standardProfile();
    config.limits.maxComponentBytes = 8;
    container.sqlite.prepare(`UPDATE archival_profiles SET config_json = ? WHERE id = ?`).run(JSON.stringify(config), 'profile-standard');
    const origin = path.join(container.config.dataDir, 'origin');
    mkdirSync(path.join(origin, 'docs'), { recursive: true });
    commit(origin, 'docs/guide.md', 'this document is longer than eight bytes\n', 'docs');
    const created = await container.catalog.create({ url: origin, profileId: 'profile-standard' });
    const outcome = await container.runner.run(container.jobs.get(created.jobId), new AbortController().signal);
    expect(outcome).toBe('partial');
    expect(container.catalog.get(created.repository.id).components.find((item) => item.component === 'docs')?.state).toBe('partial');
    expect(exists(path.join(container.config.dataDir, 'pool-1', created.repository.relativePath, 'docs', 'guide.md'))).toBe(false);
  });

  it('attributes a damaged git object to git and does not repair it', async () => {
    const container = open();
    container.settings.update({ allowFileUrls: true });
    const origin = path.join(container.config.dataDir, 'origin');
    mkdirSync(origin);
    commit(origin, 'README.md', 'hello\n', 'init');
    const created = await container.catalog.create({ url: origin, profileId: 'profile-minimal' });
    await container.runner.run(container.jobs.get(created.jobId), new AbortController().signal);
    const gitDir = path.join(container.config.dataDir, 'pool-1', created.repository.relativePath, 'repository.git');
    const damaged = damageGitObject(gitDir);
    const report = await container.integrity.verify(created.repository.id);
    expect(report.results.ok).toBe(false);
    expect(report.results.checks.some((check) => check.component === 'git' && !check.ok)).toBe(true);
    expect(readFileSync(damaged, 'utf8')).toBe('damaged');
    expect(container.catalog.get(created.repository.id).health).toBe('corrupt');
  });

  it('browses and verifies an archive after the upstream is gone', async () => {
    const container = open();
    container.settings.update({ allowFileUrls: true });
    const origin = path.join(container.config.dataDir, 'origin');
    mkdirSync(origin);
    commit(origin, 'README.md', 'offline\n', 'init');
    const created = await container.catalog.create({ url: origin, profileId: 'profile-minimal' });
    await container.runner.run(container.jobs.get(created.jobId), new AbortController().signal);
    rmSync(origin, { recursive: true, force: true });
    const gitDir = path.join(container.config.dataDir, 'pool-1', created.repository.relativePath, 'repository.git');
    const entries = await listTreeRecursive(gitDir, 'HEAD');
    expect(entries.some((entry) => entry.path === 'README.md')).toBe(true);
    const report = await container.integrity.verify(created.repository.id);
    expect(report.results.ok).toBe(true);
  });
});

function open(probe?: () => { freeBytes: number; totalBytes: number }): Container {
  const root = mkdtempSync(path.join(tmpdir(), 'fonds-api-'));
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

function damageGitObject(gitDir: string): string {
  const packDir = path.join(gitDir, 'objects', 'pack');
  try {
    const pack = readdirSync(packDir).find((name) => name.endsWith('.pack'));
    if (pack) {
      const file = path.join(packDir, pack);
      writeFileSync(file, 'damaged');
      return file;
    }
  } catch {
    // Objects may still be loose.
  }
  const loose = looseObject(path.join(gitDir, 'objects'));
  if (!loose) throw new Error('archived git directory has no object to damage');
  chmodSync(loose, 0o644);
  writeFileSync(loose, 'damaged');
  return loose;
}

function looseObject(directory: string): string | null {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'pack' || entry.name === 'info') continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = looseObject(full);
      if (nested) return nested;
    } else if (entry.isFile()) {
      return full;
    }
  }
  return null;
}

function exists(file: string): boolean {
  try {
    readFileSync(file);
    return true;
  } catch {
    return false;
  }
}
