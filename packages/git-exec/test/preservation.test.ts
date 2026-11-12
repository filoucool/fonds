import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runGit, syncBareRepository } from '../src/index';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('protected git history', () => {
  it('keeps commits after branch deletion, tag deletion, and force-push', async () => {
    const root = temp();
    const origin = path.join(root, 'origin');
    mkdirSync(origin);
    const first = commit(origin, 'README.md', 'first\n', 'init');
    commitFile(origin, 'feature.txt', 'feature\n', 'feature', 'feature');
    execFileSync('git', ['tag', 'v1'], { cwd: origin });
    const gitDir = path.join(root, 'repository.git');
    await sync(gitDir, origin);

    execFileSync('git', ['branch', '-D', 'feature'], { cwd: origin });
    execFileSync('git', ['tag', '-d', 'v1'], { cwd: origin });
    execFileSync('git', ['checkout', '--orphan', 'rewritten'], { cwd: origin });
    execFileSync('git', ['rm', '-rf', '.'], { cwd: origin });
    const rewritten = commit(origin, 'next.txt', 'next\n', 'rewritten');
    execFileSync('git', ['branch', '-D', 'main'], { cwd: origin });
    execFileSync('git', ['branch', '-m', 'main'], { cwd: origin });
    await sync(gitDir, origin);

    expect(objectType(gitDir, first)).toBe('commit');
    expect(objectType(gitDir, rewritten)).toBe('commit');
    execFileSync('git', ['--git-dir', gitDir, '-c', 'core.hooksPath=/dev/null', 'gc', '--prune=now'], { stdio: 'ignore' });
    expect(objectType(gitDir, first)).toBe('commit');
    const refs = execFileSync('git', ['--git-dir', gitDir, 'for-each-ref', '--format=%(refname)'], { encoding: 'utf8' });
    expect(refs).toContain('refs/archive/keep/');
    expect(refs).not.toContain('refs/heads/feature');
    expect(refs).toContain('refs/heads/main');
  });

  it('does not destroy the archive when the upstream disappears', async () => {
    const root = temp();
    const origin = path.join(root, 'origin');
    mkdirSync(origin);
    const first = commit(origin, 'README.md', 'first\n', 'init');
    const gitDir = path.join(root, 'repository.git');
    await sync(gitDir, origin);
    writeFileSync(path.join(gitDir, 'KEEP'), 'preserved\n');
    rmSync(origin, { recursive: true, force: true });
    await expect(sync(gitDir, origin)).rejects.toThrow();
    expect(objectType(gitDir, first)).toBe('commit');
    mkdirSync(origin);
    commit(origin, 'README.md', 'second\n', 'again');
    await sync(gitDir, origin);
    expect(readFileSync(path.join(gitDir, 'KEEP'), 'utf8')).toBe('preserved\n');
    expect(objectType(gitDir, first)).toBe('commit');
  });

  it('does not run repository hooks or shell aliases', async () => {
    const root = temp();
    const origin = path.join(root, 'origin');
    mkdirSync(origin);
    commit(origin, 'README.md', 'first\n', 'init');
    const gitDir = path.join(root, 'repository.git');
    await sync(gitDir, origin);
    const hookDir = path.join(gitDir, 'hooks');
    mkdirSync(hookDir, { recursive: true });
    const marker = path.join(root, 'hook-ran');
    writeFileSync(path.join(hookDir, 'reference-transaction'), `#!/bin/sh\necho ran > ${marker}\n`);
    chmodSync(path.join(hookDir, 'reference-transaction'), 0o755);
    execFileSync('git', ['--git-dir', gitDir, 'config', 'core.hooksPath', hookDir]);
    execFileSync('git', ['--git-dir', gitDir, 'config', 'alias.fetch', `!echo ALIAS > ${path.join(root, 'alias-ran')}`]);
    commit(origin, 'README.md', 'second\n', 'second');
    await sync(gitDir, origin);
    expect(exists(marker)).toBe(false);
    expect(exists(path.join(root, 'alias-ran'))).toBe(false);
  });

  it('leaves archived commits in place when a later fetch is cancelled', async () => {
    const root = temp();
    const origin = path.join(root, 'origin');
    mkdirSync(origin);
    const first = commit(origin, 'README.md', 'first\n', 'init');
    const gitDir = path.join(root, 'repository.git');
    await sync(gitDir, origin);
    const controller = new AbortController();
    controller.abort();
    await expect(
      syncBareRepository({
        gitDir,
        remoteUrl: origin,
        namespaces: ['heads', 'tags'],
        allowFileProtocol: true,
        recordedAt: new Date().toISOString(),
        timeoutMs: 20_000,
        signal: controller.signal,
      }),
    ).rejects.toThrow(/cancelled/);
    expect(objectType(gitDir, first)).toBe('commit');
  });

  it('checks the network policy again before git fetch', async () => {
    await expect(
      syncBareRepository({
        gitDir: path.join(temp(), 'repository.git'),
        remoteUrl: 'http://169.254.169.254/latest',
        namespaces: ['heads'],
        allowFileProtocol: false,
        recordedAt: new Date().toISOString(),
        timeoutMs: 5_000,
        networkPolicy: { allowPrivateNetworks: false, privateNetworkExceptions: [], allowFileUrls: false },
      }),
    ).rejects.toThrow(/blocked/);
    await expect(
      syncBareRepository({
        gitDir: path.join(temp(), 'repository.git'),
        remoteUrl: 'git@169.254.169.254:org/repo.git',
        namespaces: ['heads'],
        allowFileProtocol: false,
        recordedAt: new Date().toISOString(),
        timeoutMs: 5_000,
        networkPolicy: { allowPrivateNetworks: false, privateNetworkExceptions: [], allowFileUrls: false },
      }),
    ).rejects.toThrow(/blocked/);
  });
});

describe('git executor', () => {
  it('passes a remote URL as one argument and rejects unsafe URLs', async () => {
    const root = temp();
    const log = path.join(root, 'args.txt');
    const fake = path.join(root, 'fake-git');
    writeFileSync(fake, `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(log)}\n`);
    chmodSync(fake, 0o755);
    await runGit(['ls-remote', 'https://example.com/org/repo.git'], {
      gitBinary: fake,
      timeoutMs: 5_000,
    });
    const lines = readFileSync(log, 'utf8').split('\n');
    expect(lines).toContain('https://example.com/org/repo.git');
    await expect(runGit(['ls-remote', 'https://example.com/a\nb'], { gitBinary: fake, timeoutMs: 5_000 })).rejects.toThrow();
  });
});

function sync(gitDir: string, remote: string) {
  return syncBareRepository({
    gitDir,
    remoteUrl: remote,
    namespaces: ['heads', 'tags'],
    allowFileProtocol: true,
    recordedAt: new Date().toISOString(),
    timeoutMs: 20_000,
  });
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

function commitFile(repo: string, file: string, contents: string, message: string, branch: string): void {
  execFileSync('git', ['checkout', '-b', branch], { cwd: repo, stdio: 'ignore' });
  commit(repo, file, contents, message);
  execFileSync('git', ['checkout', 'main'], { cwd: repo, stdio: 'ignore' });
}

function objectType(gitDir: string, oid: string): string {
  return execFileSync('git', ['--git-dir', gitDir, 'cat-file', '-t', oid], { encoding: 'utf8' }).trim();
}

function temp(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'fonds-git-'));
  roots.push(root);
  return root;
}

function exists(file: string): boolean {
  return existsSync(file);
}
