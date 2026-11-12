import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Container } from '../../src/container';

export interface SeededRepo {
  repositoryId: string;
  jobId: string;
  originPath: string;
}

export async function seedLocalRepository(container: Container): Promise<SeededRepo> {
  container.settings.update({ allowFileUrls: true });
  const origin = mkdtempSync(path.join(tmpdir(), 'archiver-seed-'));
  commit(origin, 'README.md', '# seed\n', 'init');
  const created = await container.catalog.create({ url: origin, profileId: 'profile-minimal' });
  const job = container.jobs.get(created.jobId);
  await container.runner.run(job, new AbortController().signal);
  return { repositoryId: created.repository.id, jobId: created.jobId, originPath: origin };
}

function commit(repo: string, file: string, contents: string, message: string): void {
  if (!existsSync(path.join(repo, '.git'))) {
    execFileSync('git', ['init', '-b', 'main'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo });
  }
  writeFileSync(path.join(repo, file), contents);
  execFileSync('git', ['add', file], { cwd: repo });
  execFileSync('git', ['commit', '-m', message], { cwd: repo, stdio: 'ignore' });
}
