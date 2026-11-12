import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const E2E_SEED_DISPLAY_NAME = 'E2E Seed Repository';

export function createSeedGitOrigin(): { originPath: string; fileUrl: string } {
  const originPath = mkdtempSync(path.join(tmpdir(), 'fonds-e2e-origin-'));
  commit(originPath, 'README.md', '# E2E fixture\n', 'init');
  mkdirSync(path.join(originPath, 'docs'), { recursive: true });
  writeFileSync(path.join(originPath, 'docs', 'note.txt'), 'extra\n');
  execFileSync('git', ['add', 'docs/note.txt'], { cwd: originPath, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'docs'], { cwd: originPath, stdio: 'ignore' });
  const fileUrl = pathToFileURL(originPath).href;
  return { originPath, fileUrl };
}

function commit(repo: string, file: string, contents: string, message: string): void {
  if (!existsSync(path.join(repo, '.git'))) {
    execFileSync('git', ['init', '-b', 'main'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'e2e@example.com'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'E2E'], { cwd: repo });
  }
  writeFileSync(path.join(repo, file), contents);
  execFileSync('git', ['add', file], { cwd: repo });
  execFileSync('git', ['commit', '-m', message], { cwd: repo, stdio: 'ignore' });
}
