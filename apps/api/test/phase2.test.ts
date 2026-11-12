import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/services/crypto';
import { GitAccessService } from '../src/services/git-access';
import { makeGitDirReadOnly, makeGitDirWritable } from '../src/services/archive-readonly';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

describe('phase2 security primitives', () => {
  it('hashes and verifies passwords', () => {
    const hash = hashPassword('long-enough-password');
    expect(verifyPassword('long-enough-password', hash)).toBe(true);
    expect(verifyPassword('wrong', hash)).toBe(false);
  });

  it('toggles archive git directory permissions for sync vs serve', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'fonds-ro-'));
    const gitDir = path.join(root, 'repository.git');
    mkdirSync(gitDir, { recursive: true });
    const file = path.join(gitDir, 'FETCH_HEAD');
    writeFileSync(file, 'ref: refs/heads/main\n');
    makeGitDirReadOnly(gitDir);
    expect(() => writeFileSync(file, 'changed\n')).toThrow();
    makeGitDirWritable(gitDir);
    writeFileSync(file, 'changed\n');
    rmSync(root, { recursive: true, force: true });
  });

  it('rejects archive ids outside the uuid pattern', () => {
    const git = new GitAccessService({ require: () => { throw new Error('unused'); } } as never, {} as never, {} as never);
    expect(() => git.resolveArchive('../etc/passwd')).toThrow();
  });
});
