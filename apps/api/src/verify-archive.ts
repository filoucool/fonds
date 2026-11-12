import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseManifest, verifyChecksums } from '@fonds/archive-format';
import { isRecord, parseJson, type ComponentKey } from '@fonds/shared';
import { GitCommandError, isOid, runGit } from '@fonds/git-exec';

export interface VerificationCheck {
  id: string;
  component: ComponentKey | 'checksums' | 'manifest';
  ok: boolean;
  detail: string;
}

export interface Verification {
  ok: boolean;
  checks: VerificationCheck[];
}

export async function verifyArchiveTree(root: string, gitDir: string): Promise<Verification> {
  const checks: VerificationCheck[] = [];
  let manifestOk = false;
  try {
    const manifest = parseManifest(parseJson(await readFile(path.join(root, 'archive.json'), 'utf8')));
    manifestOk = true;
    checks.push({ id: 'manifest', component: 'manifest', ok: true, detail: `schema ${manifest.schemaVersion}, generation ${manifest.generation}` });
    for (const ref of [...manifest.refs.current, ...manifest.refs.archived]) {
      if (!isOid(ref.oid)) {
        checks.push({ id: `ref-${ref.name}`, component: 'git', ok: false, detail: `${ref.name} has an invalid object id` });
        continue;
      }
      try {
        await runGit(['cat-file', '-e', `${ref.oid}^{object}`], { gitDir, allowFileProtocol: true, timeoutMs: 60_000 });
      } catch (error) {
        checks.push({
          id: `ref-${ref.name}`,
          component: 'git',
          ok: false,
          detail: `${ref.name} is not reachable (${error instanceof Error ? error.message : 'missing object'})`,
        });
      }
    }
  } catch (error) {
    checks.push({ id: 'manifest', component: 'manifest', ok: false, detail: error instanceof Error ? error.message : 'manifest unreadable' });
  }
  try {
    await runGit(['fsck', '--no-dangling'], { gitDir, allowFileProtocol: true, timeoutMs: 120_000 });
    checks.push({ id: 'git-fsck', component: 'git', ok: true, detail: 'git fsck passed' });
  } catch (error) {
    const detail = error instanceof GitCommandError ? error.stderr.trim() || error.message : 'git fsck failed';
    checks.push({ id: 'git-fsck', component: 'git', ok: false, detail: detail.slice(0, 2000) });
  }
  if (manifestOk) {
    try {
      const checksums = await verifyChecksums(root);
      checks.push({
        id: 'checksums',
        component: 'checksums',
        ok: checksums.ok,
        detail: checksums.ok ? 'sha256 inventory matched' : checksums.failures.slice(0, 20).join('; '),
      });
    } catch (error) {
      checks.push({ id: 'checksums', component: 'checksums', ok: false, detail: error instanceof Error ? error.message : 'checksum verification failed' });
    }
  }
  return { ok: checks.every((check) => check.ok), checks };
}

export function componentOfDetail(value: unknown): string {
  if (!isRecord(value)) return 'unknown';
  return typeof value.component === 'string' ? value.component : 'unknown';
}
