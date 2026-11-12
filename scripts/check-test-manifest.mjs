#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'docs/testing/manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const suiteTags = new Set();
for (const dir of ['e2e/tests', 'apps/api/test', 'packages']) {
  const abs = path.join(root, dir);
  if (!statSync(abs, { throwIfNoEntry: false })?.isDirectory()) continue;
  walk(abs, (file) => {
    if (!file.endsWith('.ts') && !file.endsWith('.mts')) return;
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/@suite\s+([a-z0-9._-]+)/gi)) {
      suiteTags.add(match[1]);
    }
  });
}

let done = 0;
let planned = 0;
let partial = 0;
const missingTags = [];
const e2eIds = new Set(manifest.suites.filter((row) => row.layer === 'e2e').map((row) => row.id));
const orphanTags = [...suiteTags].filter((id) => e2eIds.has(id));

for (const suite of manifest.suites) {
  if (suite.status === 'done') done += 1;
  else if (suite.status === 'partial') partial += 1;
  else planned += 1;

  if ((suite.status === 'done' || suite.status === 'partial') && suite.layer === 'e2e') {
    const idx = orphanTags.indexOf(suite.id);
    if (idx >= 0) orphanTags.splice(idx, 1);
    if (!suiteTags.has(suite.id)) {
      missingTags.push(suite.id);
    }
  }
}

const total = manifest.suites.length;
const pct = total ? Math.round((done / total) * 100) : 0;

console.log(`Test manifest: ${done} done, ${partial} partial, ${planned} planned (${total} total, ${pct}% done)`);

if (missingTags.length) {
  console.log('\nMarked done/partial but no @suite tag found in tests:');
  for (const id of missingTags) console.log(`  - ${id}`);
}

if (orphanTags.length) {
  console.log('\n@suite tags in code not listed in manifest.json:');
  for (const id of orphanTags.sort()) console.log(`  - ${id}`);
}

if (missingTags.length) process.exitCode = 1;

function walk(directory, onFile) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      walk(full, onFile);
    } else if (entry.isFile()) {
      onFile(full);
    }
  }
}
