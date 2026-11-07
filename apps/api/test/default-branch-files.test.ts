import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { syncBareRepository } from '@repo-archive/git-exec';
import { defaultGitRef, listTree } from '../src/services/browse';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('default branch file listing', () => {
  it('uses the archived default branch instead of assuming main', async () => {
    expect(defaultGitRef('master', undefined)).toBe('refs/heads/master');
    expect(defaultGitRef('master', '  ')).toBe('refs/heads/master');
    expect(defaultGitRef('master', 'refs/heads/main')).toBe('refs/heads/main');
    expect(defaultGitRef(null, undefined)).toBe('HEAD');

    const root = mkdtempSync(path.join(tmpdir(), 'archiver-master-'));
    roots.push(root);
    const origin = path.join(root, 'origin');
    mkdirSync(origin);
    execFileSync('git', ['init', '-b', 'master'], { cwd: origin, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: origin });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: origin });
    writeFileSync(path.join(origin, 'README.md'), 'on master\n');
    execFileSync('git', ['add', 'README.md'], { cwd: origin });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: origin, stdio: 'ignore' });
    const gitDir = path.join(root, 'repository.git');
    await syncBareRepository({
      gitDir,
      remoteUrl: origin,
      namespaces: ['heads', 'tags'],
      allowFileProtocol: true,
      recordedAt: new Date().toISOString(),
      timeoutMs: 20_000,
    });

    const entries = await listTree(gitDir, defaultGitRef('master'), '');
    expect(entries.some((entry) => entry.name === 'README.md')).toBe(true);
    await expect(listTree(gitDir, 'refs/heads/main', '')).rejects.toThrow();
  });
});
