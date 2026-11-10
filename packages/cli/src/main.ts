#!/usr/bin/env node
import { mkdir, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseManifest } from '@repo-archive/archive-format';
import { parseJson } from '@repo-archive/shared';
import { verifyArchiveTree } from './verify-archive.js';

const args = process.argv.slice(2);

async function main(): Promise<void> {
  if (args.length === 0 || args[0] === '--help' || args[0] === 'help') {
    printHelp();
    return;
  }
  if (args[0] === 'rescue') {
    await runRescue(args.slice(1));
    return;
  }
  await runApiCommand(args);
}

async function runApiCommand(argv: string[]): Promise<void> {
  const base = process.env.ARCHIVER_URL ?? 'http://127.0.0.1:8080';
  const token = process.env.ARCHIVER_TOKEN;
  const [command, ...rest] = argv;
  const headers: Record<string, string> = { accept: 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (command === 'list') {
    const response = await fetch(`${base}/api/v1/repositories?limit=100`, { headers });
    const body: unknown = await response.json();
    console.log(JSON.stringify(body, null, rest.includes('--format') && rest[rest.indexOf('--format') + 1] === 'json' ? 2 : 0));
    return;
  }
  if (command === 'inspect' && rest[0]) {
    const response = await fetch(`${base}/api/v1/repositories/${encodeURIComponent(rest[0])}`, { headers });
    console.log(JSON.stringify(await response.json(), null, 2));
    return;
  }
  if (command === 'job' && rest[0]) {
    const response = await fetch(`${base}/api/v1/jobs/${encodeURIComponent(rest[0])}`, { headers });
    console.log(JSON.stringify(await response.json(), null, 2));
    return;
  }
  if (command === 'storage') {
    const sub = rest[0];
    if (sub !== 'pools' && sub !== undefined) throw new Error('usage: repo-archive storage pools');
    const response = await fetch(`${base}/api/v1/storage/pools`, { headers });
    console.log(JSON.stringify(await response.json(), null, 2));
    return;
  }
  if (command === 'export' && rest[0]) {
    const format = rest.includes('--format') ? rest[rest.indexOf('--format') + 1] : 'bundle';
    const response = await fetch(`${base}/api/v1/repositories/${encodeURIComponent(rest[0])}/export`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ format: typeof format === 'string' ? format : 'bundle' }),
    });
    console.log(JSON.stringify(await response.json(), null, 2));
    return;
  }
  if (command === 'sync' && rest[0]) {
    const response = await fetch(`${base}/api/v1/repositories/${rest[0]}/sync`, { method: 'POST', headers });
    console.log(JSON.stringify(await response.json(), null, 2));
    return;
  }
  if (command === 'verify' && rest[0]) {
    const response = await fetch(`${base}/api/v1/repositories/${rest[0]}/verify`, { method: 'POST', headers });
    console.log(JSON.stringify(await response.json(), null, 2));
    return;
  }
  if (command === 'import' && rest[0]) {
    const response = await fetch(`${base}/api/v1/repositories/import`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ url: rest[0] }),
    });
    console.log(JSON.stringify(await response.json(), null, 2));
    return;
  }
  throw new Error(`unknown command: ${command ?? ''}`);
}

async function runRescue(argv: string[]): Promise<void> {
  const [sub, ...rest] = argv;
  if (sub === 'verify' && rest[0]) {
    const root = path.resolve(rest[0]);
    const gitDir = path.join(root, 'repository.git');
    const result = await verifyArchiveTree(root, gitDir);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
    return;
  }
  if (sub === 'rebuild-catalog' && rest[0]) {
    const archivesRoot = path.resolve(rest[0]);
    const dbPath = path.resolve(rest[1] ?? './catalog.sqlite');
    const repositories = await scanArchives(archivesRoot);
    await writeCatalog(dbPath, repositories);
    console.log(JSON.stringify({ repositories: repositories.length, database: dbPath }, null, 2));
    return;
  }
  throw new Error(`unknown rescue command: ${sub ?? ''}`);
}

interface ArchiveRow {
  id: string;
  manifestPath: string;
  displayName: string;
}

async function scanArchives(root: string): Promise<ArchiveRow[]> {
  const rows: ArchiveRow[] = [];
  const shardDirs = await readdir(root, { withFileTypes: true });
  for (const shard of shardDirs) {
    if (!shard.isDirectory() || !/^[0-9a-f]{2}$/i.test(shard.name)) continue;
    const shardPath = path.join(root, shard.name);
    const ids = await readdir(shardPath, { withFileTypes: true });
    for (const entry of ids) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(shardPath, entry.name, 'archive.json');
      try {
        const info = await stat(manifestPath);
        if (!info.isFile()) continue;
        const manifest = parseManifest(parseJson(await readFile(manifestPath, 'utf8')));
        rows.push({ id: entry.name, manifestPath, displayName: manifest.displayName || entry.name });
      } catch {
        continue;
      }
    }
  }
  return rows;
}

async function writeCatalog(dbPath: string, repositories: ArchiveRow[]): Promise<void> {
  const Database = (await import('better-sqlite3')).default;
  await mkdir(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE IF NOT EXISTS rescued_repositories (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, manifest_path TEXT NOT NULL)`);
  const insert = db.prepare(`INSERT INTO rescued_repositories (id, display_name, manifest_path) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, manifest_path = excluded.manifest_path`);
  const apply = db.transaction(() => {
    for (const row of repositories) insert.run(row.id, row.displayName, row.manifestPath);
  });
  apply();
  db.close();
}

function printHelp(): void {
  console.log(`repo-archive — Archiver CLI

Usage:
  repo-archive list [--format json]
  repo-archive inspect <repository-id>
  repo-archive import <url>
  repo-archive sync <repository-id>
  repo-archive verify <repository-id>
  repo-archive job <job-id>
  repo-archive export <repository-id> [--format bundle|directory|package]
  repo-archive storage pools
  repo-archive rescue verify <archive-directory>
  repo-archive rescue rebuild-catalog <archives-root> [catalog.sqlite]

Environment:
  ARCHIVER_URL     API base URL (default http://127.0.0.1:8080)
  ARCHIVER_TOKEN   Bearer token with api scope
`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'command failed');
  process.exitCode = 1;
});
