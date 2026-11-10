import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { createContainer } from '../src/container';
import { makeGitDirWritable } from '../src/services/archive-readonly';
import { NodeHttpClient } from '../src/services/http-client';

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

describe('export and migration', () => {
  it('exports a bundle that git can verify and migrates only after verification', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'archiver-export-'));
    roots.push(root);
    const container = createContainer(
      loadConfig({ DATA_DIR: root, HOST: '127.0.0.1', PORT: '8080', WORKER_ENABLED: 'false', PATH: process.env.PATH }),
    );
    container.settings.update({ allowFileUrls: true });
    const origin = path.join(root, 'origin');
    mkdirSync(origin);
    writeFileSync(path.join(origin, 'README.md'), 'export me\n');
    execFileSync('git', ['init', '-b', 'main'], { cwd: origin, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: origin });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: origin });
    execFileSync('git', ['add', 'README.md'], { cwd: origin });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: origin, stdio: 'ignore' });
    const created = await container.catalog.create({ url: origin, profileId: 'profile-minimal' });
    await container.runner.run(container.jobs.get(created.jobId), new AbortController().signal);
    const exported = container.exporter.create(created.repository.id, 'bundle');
    await container.exporter.run(exported.id);
    const download = container.exporter.download(exported.id);
    expect(download.file).toBeTruthy();
    execFileSync('git', ['bundle', 'verify', download.file ?? ''], { stdio: 'pipe' });

    const destination = container.storage.create({
      name: 'cold',
      rootPath: path.join(root, 'pool-2'),
      freeSpaceThresholdBytes: 1,
      acceptNew: true,
      placementWeight: 1,
    });
    mkdirSync(destination.rootPath, { recursive: true });
    const repo = container.catalog.require(created.repository.id);
    await container.storage.migrate(repo.id, destination.id, repo.storagePoolId, repo.relativePath);
    const moved = path.join(destination.rootPath, repo.relativePath, 'repository.git');
    expect(execFileSync('git', ['--git-dir', moved, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()).toHaveLength(40);
    expect(() => execFileSync('git', ['--git-dir', path.join(root, 'pool-1', repo.relativePath, 'repository.git'), 'rev-parse', 'HEAD'], { stdio: 'ignore' })).toThrow();
    container.sqlite.close();
  });
});

describe('http client', () => {
  it('refuses a redirect onto a metadata address and strips authorization across hosts', async () => {
    const secret = 'super-secret-token-value';
    const seen: string[] = [];
    const target = createServer((request, response) => {
      seen.push(request.headers.authorization ?? '');
      response.end('ok');
    });
    await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', () => resolve()));
    const targetAddress = target.address();
    if (!targetAddress || typeof targetAddress === 'string') throw new Error('no port');
    const hopper = createServer((_request, response) => {
      response.writeHead(302, { location: `http://169.254.169.254/latest`, authorization: 'nope' });
      response.end();
    });
    await new Promise<void>((resolve) => hopper.listen(0, '127.0.0.1', () => resolve()));
    const hopperAddress = hopper.address();
    if (!hopperAddress || typeof hopperAddress === 'string') throw new Error('no port');
    const client = new NodeHttpClient();
    const policy = { allowPrivateNetworks: false, privateNetworkExceptions: ['127.0.0.1'], allowFileUrls: false };
    await expect(
      client.request({
        url: `http://127.0.0.1:${hopperAddress.port}/start`,
        headers: { authorization: `Bearer ${secret}` },
        policy,
        timeoutMs: 2_000,
      }),
    ).rejects.toThrow(/blocked|metadata|EPERM|ECONNREFUSED|ENETUNREACH|connect/i);
    target.close();
    hopper.close();
    expect(seen.join('')).not.toContain(secret);
  });

  it('connects when Node requests every resolved address', async () => {
    const server = createServer((_request, response) => {
      response.end('ok');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no port');
    const client = new NodeHttpClient();
    const response = await client.request({
      url: `http://localhost:${address.port}/ok`,
      policy: {
        allowPrivateNetworks: false,
        privateNetworkExceptions: ['localhost', '127.0.0.1'],
        allowFileUrls: false,
      },
      timeoutMs: 5_000,
    });
    server.close();
    expect(response.status).toBe(200);
    expect(response.text).toBe('ok');
  });
});
