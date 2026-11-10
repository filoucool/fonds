import { chmodSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

function walkGitDir(gitDir: string, fileMode: number, dirMode: number): void {
  const root = path.resolve(gitDir);
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) continue;
    let names: string[] = [];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      const full = path.join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      try {
        chmodSync(full, st.isDirectory() ? dirMode : fileMode);
      } catch {
        // Network mounts may reject chmod.
      }
      if (st.isDirectory()) stack.push(full);
    }
  }
  try {
    chmodSync(root, dirMode);
  } catch {
    // Ignore.
  }
}

/** Restore owner write before sync so git can update FETCH_HEAD and refs. */
export function makeGitDirWritable(gitDir: string): void {
  walkGitDir(gitDir, 0o644, 0o755);
}

/** Best-effort read-only on the bare repository (objects remain readable for git serve). */
export function makeGitDirReadOnly(gitDir: string): void {
  walkGitDir(gitDir, 0o444, 0o555);
}
