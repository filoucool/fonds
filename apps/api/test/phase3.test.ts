import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { finalizeBackupManifest, parseBackupManifest } from '@repo-archive/archive-format';
import { loadConfig } from '../src/config';
import { createContainer, type Container } from '../src/container';
import { makeGitDirWritable } from '../src/services/archive-readonly';

const roots: string[] = [];
const containers: Container[] = [];

afterEach(() => {
  for (const container of containers.splice(0)) {
    container.sqlite.close();
  }
  for (const root of roots.splice(0)) {
    try {
      makeGitDirWritable(root);
    } catch {
      // ignore
    }
    rmSync(root, { recursive: true, force: true });
  }
});

describe('phase3 backups snapshots and dependencies', () => {
  it('runs a local complete backup with a verifiable manifest', async () => {
    const container = open();
    container.settings.update({ allowFileUrls: true });
    const origin = path.join(container.config.dataDir, 'origin');
    mkdirSync(origin);
    commit(origin, 'README.md', 'phase3\n', 'init');
    const created = await container.catalog.create({ url: origin, profileId: 'profile-minimal' });
    await container.runner.run(container.jobs.get(created.jobId), new AbortController().signal);

    const targetPath = path.join(container.config.dataDir, 'offsite');
    const { backupId } = container.backups.enqueue({ type: 'local', path: targetPath }, 'complete');
    await container.backups.run(backupId, { type: 'local', path: targetPath });
    const run = container.backups.get(backupId);
    expect(run.state === 'verified' || run.state === 'completed').toBe(true);
    expect(run.manifestPath).toBeTruthy();
    const manifest = parseBackupManifest(readFileSync(path.join(targetPath, `backup-${backupId}`, 'backup-manifest.json'), 'utf8'));
    expect(manifest.archiveIds).toContain(created.repository.id);
    expect(existsSync(path.join(targetPath, `backup-${backupId}`, '.backup-complete'))).toBe(true);
  });

  it('creates manual and change snapshots with ref capture', async () => {
    const container = open();
    container.settings.update({ allowFileUrls: true, phase3: { ...container.settings.get().phase3, snapshots: { ...container.settings.get().phase3.snapshots, manual: true, onChange: true } } });
    const origin = path.join(container.config.dataDir, 'origin');
    mkdirSync(origin);
    const first = commit(origin, 'README.md', 'one\n', 'init');
    const created = await container.catalog.create({ url: origin, profileId: 'profile-minimal' });
    await container.runner.run(container.jobs.get(created.jobId), new AbortController().signal);
    const manual = container.snapshots.create(created.repository.id, 'manual', true);
    expect(manual.pinned).toBe(true);
    commit(origin, 'README.md', 'two\n', 'rewrite');
    const syncJob = container.catalog.enqueueSync(created.repository.id);
    const previous = container.catalog.contentHash(created.repository.id);
    await container.runner.run(container.jobs.get(syncJob), new AbortController().signal);
    const nextHash = container.catalog.contentHash(created.repository.id) ?? '';
    container.snapshots.maybeOnChange(created.repository.id, previous, nextHash);
    const listed = container.snapshots.list(created.repository.id);
    expect(listed.length).toBeGreaterThanOrEqual(2);
    const manifest = container.snapshots.getManifest(manual.id);
    expect(manifest.refs.some((ref) => ref.oid === first)).toBe(true);
  });

  it('discovers submodule and package dependencies with limits', async () => {
    const container = open();
    const repoRoot = path.join(container.config.dataDir, 'fixture');
    mkdirSync(repoRoot);
    commit(repoRoot, 'README.md', 'deps\n', 'init');
    writeFileSync(path.join(repoRoot, '.gitmodules'), '[submodule "ext"]\n\tpath = ext\n\turl = https://example.com/ext.git\n');
    writeFileSync(
      path.join(repoRoot, 'package.json'),
      JSON.stringify({ name: 'fixture', version: '1.0.0', dependencies: { leftpad: '1.0.0' }, repository: 'https://github.com/example/leftpad.git' }),
    );
    container.settings.update({ allowFileUrls: true });
    const created = await container.catalog.create({ url: repoRoot, profileId: 'profile-minimal' });
    await container.runner.run(container.jobs.get(created.jobId), new AbortController().signal);
    const archiveRoot = path.join(container.config.dataDir, 'pool-1', created.repository.relativePath);
    writeFileSync(path.join(archiveRoot, '.gitmodules'), '[submodule "ext"]\n\tpath = ext\n\turl = https://example.com/ext.git\n');
    writeFileSync(
      path.join(archiveRoot, 'package.json'),
      JSON.stringify({ name: 'fixture', version: '1.0.0', dependencies: { leftpad: '1.0.0' }, repository: 'https://github.com/example/leftpad.git' }),
    );
    const preview = container.dependencies.discover(created.repository.id, 1);
    expect(preview.nodes.some((node) => node.kind === 'git-submodule')).toBe(true);
    expect(preview.nodes.some((node) => node.kind === 'npm-package')).toBe(true);
    const discoveryId = container.dependencies.persistDiscovery(created.repository.id, preview);
    expect(discoveryId.length).toBeGreaterThan(10);
  });

  it('builds a self-preservation inventory report', () => {
    const container = open();
    const report = container.supplyChain.selfPreservationReport();
    expect(report.applicationVersion).toBeTruthy();
    expect(Array.isArray(report.enrolled)).toBe(true);
    expect(Array.isArray(report.missing)).toBe(true);
    const sbom = container.supplyChain.buildSbom();
    expect(sbom.format).toBe('cyclonedx-lite');
  });

  it('round-trips backup manifest digest validation', () => {
    const manifest = finalizeBackupManifest({
      backupId: '00000000-0000-4000-8000-000000000001',
      createdAt: new Date().toISOString(),
      boundaryAt: new Date().toISOString(),
      profile: 'catalog-only',
      catalogPath: 'catalog.sqlite',
      catalogSha256: 'abc',
      archiveIds: [],
      poolRoots: [],
      searchIndexIncluded: false,
      destination: { type: 'local', redacted: { path: '/tmp' } },
    });
    expect(() => parseBackupManifest(JSON.stringify(manifest))).not.toThrow();
  });
});

function open(): Container {
  const root = mkdtempSync(path.join(tmpdir(), 'archiver-phase3-'));
  roots.push(root);
  const config = loadConfig({
    DATA_DIR: root,
    HOST: '127.0.0.1',
    PORT: '8080',
    WORKER_ENABLED: 'false',
    PATH: process.env.PATH,
  });
  const container = createContainer(config);
  containers.push(container);
  return container;
}

function commit(repo: string, file: string, contents: string, message: string): string {
  if (!existsSync(path.join(repo, '.git'))) {
    execFileSync('git', ['init', '-b', 'main'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo });
  }
  writeFileSync(path.join(repo, file), contents);
  execFileSync('git', ['add', file], { cwd: repo });
  execFileSync('git', ['commit', '-m', message], { cwd: repo, stdio: 'ignore' });
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
}
