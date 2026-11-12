import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const packages = new Map();

function addPackage(directory) {
  const manifestPath = path.join(directory, 'package.json');
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return;
  }
  if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') return;
  const key = `${manifest.name}@${manifest.version}`;
  if (packages.has(key)) return;
  const repository = manifest.repository?.url ?? (typeof manifest.repository === 'string' ? manifest.repository : null);
  packages.set(key, {
    name: manifest.name,
    version: manifest.version,
    license: manifest.license ?? null,
    repository: typeof repository === 'string' ? repository.replace(/^git\+/, '').replace(/\.git$/, '') : null,
    private: manifest.private === true,
  });
}

function walkPnpm(directory) {
  let entries = [];
  try {
    entries = readdirSync(directory);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(directory, entry);
    if (!statSync(full).isDirectory()) continue;
    const nested = path.join(full, 'node_modules');
    if (!statSync(nested, { throwIfNoEntry: false })?.isDirectory()) continue;
    for (const name of readdirSync(nested)) {
      const packageDir = path.join(nested, name);
      if (name.startsWith('@')) {
        for (const scoped of readdirSync(packageDir)) addPackage(path.join(packageDir, scoped));
      } else addPackage(packageDir);
    }
  }
}

for (const workspace of ['package.json', 'apps/api/package.json', 'apps/web/package.json', 'packages/shared/package.json', 'packages/archive-format/package.json', 'packages/git-exec/package.json']) {
  addPackage(path.join(root, path.dirname(workspace)));
}
walkPnpm(path.join(root, 'node_modules', '.pnpm'));

const inventory = {
  generatedAt: new Date().toISOString(),
  applicationVersion: '0.1.0',
  node: process.version,
  packages: [...packages.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.version < b.version ? -1 : 1)),
  images: [
    {
      name: 'fonds',
      dockerfile: 'Dockerfile',
      digest: null,
      note: 'Run scripts/record-image-digest.sh after docker build to fill the image digest.',
    },
  ],
  upstreamProjects: [
    { name: 'git', purpose: 'Repository archival and verification', url: 'https://git-scm.com/' },
    { name: 'sqlite', purpose: 'Catalog, jobs, and leases', url: 'https://www.sqlite.org/' },
    { name: 'nodejs', purpose: 'Application runtime', url: 'https://nodejs.org/' },
  ],
};
inventory.contentSha256 = createHash('sha256').update(JSON.stringify({ ...inventory, contentSha256: undefined })).digest('hex');
const destination = path.join(root, 'docs', 'dependency-inventory.json');
writeFileSync(destination, `${JSON.stringify(inventory, null, 2)}\n`);
console.log(`wrote ${packages.size} packages to ${destination}`);
