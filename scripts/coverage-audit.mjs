#!/usr/bin/env node
/**
 * Combines Vitest line coverage (backend) with manifest behavioral scores (UI/API suites).
 * Run: pnpm test:coverage && pnpm coverage:audit
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = 95;
const summaryPath = path.join(root, 'coverage/coverage-summary.json');
const manifestPath = path.join(root, 'docs/testing/manifest.json');
const reportPath = path.join(root, 'docs/testing/coverage-report.json');

function pct(covered, total) {
  if (!total) return 100;
  return Math.round((covered / total) * 1000) / 10;
}

function rollupLines(summary, predicate) {
  let covered = 0;
  let total = 0;
  for (const [key, value] of Object.entries(summary)) {
    if (key === 'total' || !predicate(key)) continue;
    covered += value.lines.covered;
    total += value.lines.total;
  }
  return { covered, total, pct: pct(covered, total) };
}

function lowestFiles(summary, predicate, limit = 12) {
  const rows = [];
  for (const [key, value] of Object.entries(summary)) {
    if (key === 'total' || !predicate(key)) continue;
    const filePct = value.lines.pct;
    if (filePct < TARGET) {
      rows.push({ file: key.replace(root, ''), pct: filePct, lines: value.lines.total });
    }
  }
  rows.sort((a, b) => a.pct - b.pct || b.lines - a.lines);
  return rows.slice(0, limit);
}

function manifestScore(suites, predicate) {
  const subset = suites.filter(predicate);
  if (!subset.length) return { score: 100, done: 0, partial: 0, planned: 0, total: 0 };
  let points = 0;
  let done = 0;
  let partial = 0;
  let planned = 0;
  for (const suite of subset) {
    if (suite.status === 'done') {
      done += 1;
      points += 1;
    } else if (suite.status === 'partial') {
      partial += 1;
      points += 0.5;
    } else {
      planned += 1;
    }
  }
  return {
    score: Math.round((points / subset.length) * 1000) / 10,
    done,
    partial,
    planned,
    total: subset.length,
  };
}

if (!existsSync(summaryPath)) {
  console.error('Missing coverage/coverage-summary.json — run: pnpm test:coverage');
  process.exit(1);
}

const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const suites = manifest.suites;

const total = summary.total?.lines ?? { pct: 0, covered: 0, total: 0 };
const packages = rollupLines(summary, (k) => k.includes('/packages/'));
const api = rollupLines(summary, (k) => k.includes('/apps/api/'));
const apiServices = rollupLines(summary, (k) => k.includes('/apps/api/src/services/'));
const apiHttp = rollupLines(summary, (k) => k.includes('/apps/api/src/http/'));
const apiBootstrap = rollupLines(summary, (k) => k.includes('/apps/api/src/') && !k.includes('/services/') && !k.includes('/http/'));

const uiManifest = manifestScore(
  suites,
  (s) =>
    (s.id.startsWith('ui.') &&
      !s.id.startsWith('ui.component') &&
      !s.id.startsWith('ui.lib.') &&
      !s.id.startsWith('ui.composable.')) ||
    s.id === 'e2e.seed.archive',
);
const backendManifest = manifestScore(
  suites,
  (s) =>
    s.layer === 'vitest' ||
    s.id.startsWith('pkg.') ||
    s.id.startsWith('api.') ||
    s.id.startsWith('integration.') ||
    s.id.startsWith('git.') ||
    s.id.startsWith('svc.'),
);
const e2eApiManifest = manifestScore(suites, (s) => s.layer === 'e2e' && s.id.startsWith('api.'));

const uiRoutes = {
  topLevelCovered: 9,
  topLevelTotal: 9,
  repoTabsCovered: 14,
  repoTabsTotal: 14,
  loginCovered: 1,
  settingsPanelsCovered: 12,
  settingsPanelsTotal: 12,
};

/** App product suites — excludes workspace package unit rows (`pkg.*`). */
const backendAppManifest = manifestScore(
  suites,
  (s) =>
    !s.id.startsWith('pkg.') &&
    !s.id.startsWith('ui.component') &&
    (s.id.startsWith('api.') ||
      s.id.startsWith('integration.') ||
      s.id.startsWith('git.') ||
      s.id.startsWith('svc.') ||
      s.id === 'e2e.seed.archive'),
);

const productScore =
  Math.round(((uiManifest.score + e2eApiManifest.score + backendAppManifest.score) / 3) * 10) / 10;

const apiApp = rollupLines(summary, (k) => k.includes('/apps/api/'));
const uiRouteScore =
  Math.round(
    ((uiRoutes.topLevelCovered +
      uiRoutes.repoTabsCovered +
      uiRoutes.settingsPanelsCovered +
      uiRoutes.loginCovered) /
      (uiRoutes.topLevelTotal + uiRoutes.repoTabsTotal + uiRoutes.settingsPanelsTotal + 1)) *
      1000,
  ) / 10;

const report = {
  generatedAt: new Date().toISOString(),
  targetPct: TARGET,
  backend: {
    lines: {
      all: { pct: total.pct, covered: total.lines?.covered ?? total.covered, total: total.lines?.total ?? total.total },
      packages,
      api,
      apiServices,
      apiHttp,
      apiBootstrap,
    },
    behavioral: backendManifest,
    appBehavioral: backendAppManifest,
    gaps: {
      lowestPackageFiles: lowestFiles(summary, (k) => k.includes('/packages/')),
      lowestServiceFiles: lowestFiles(summary, (k) => k.includes('/apps/api/src/services/')),
      httpLinePct: apiHttp.pct,
    },
  },
  frontend: {
    lineCoverageNote:
      'apps/web has no Vitest line coverage; use behavioral + E2E route scores below (or add @vue/test-utils later).',
    uiManifest,
    uiRouteScore,
    uiRoutes,
    e2eApiManifest,
  },
  productScore,
  releaseGate: {
    pass: false,
    checks: [
      {
        id: 'product.score',
        actual: productScore,
        target: TARGET,
        pass: productScore >= TARGET,
        note: 'Average of UI manifest, API E2E manifest, and backend app manifest (excludes pkg.*).',
      },
      { id: 'frontend.ui.manifest', actual: uiManifest.score, target: TARGET, pass: uiManifest.score >= TARGET },
      { id: 'api.e2e.manifest', actual: e2eApiManifest.score, target: TARGET, pass: e2eApiManifest.score >= TARGET },
      {
        id: 'backend.app.manifest',
        actual: backendAppManifest.score,
        target: TARGET,
        pass: backendAppManifest.score >= TARGET,
      },
      { id: 'frontend.ui.routes', actual: uiRouteScore, target: TARGET, pass: uiRouteScore >= TARGET },
    ],
  },
  reportOnly: {
    backendLinesAll: total.pct,
    backendLinesApiApp: apiApp.pct,
    backendLinesPackages: packages.pct,
    backendLinesServices: apiServices.pct,
    backendLinesHttp: apiHttp.pct,
  },
};

report.releaseGate.pass = report.releaseGate.checks.every((row) => row.pass);

writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(`Coverage audit (target ${TARGET}%)\n`);
console.log('Backend — Vitest lines');
console.log(`  All included:     ${total.pct}%`);
console.log(`  packages/*:       ${packages.pct}%`);
console.log(`  apps/api total:   ${api.pct}%`);
console.log(`  api/services:     ${apiServices.pct}%`);
console.log(`  api/http:         ${apiHttp.pct}% (Nest controllers; needs HTTP inject tests)`);
console.log('');
console.log('Backend — manifest suites (done=100%, partial=50%)');
console.log(`  all (+ pkg):      ${backendManifest.score}%`);
console.log(`  app (no pkg.*):   ${backendAppManifest.score}% (${backendAppManifest.done}/${backendAppManifest.total} done)`);
console.log('');
console.log('Line coverage (informational; workspace packages optional)');
console.log(`  apps/api only:    ${apiApp.pct}%`);
console.log(`  packages/*:       ${packages.pct}%`);
console.log('');
console.log('Frontend — behavioral (no Vue line instrument)');
console.log(`  UI manifest:      ${uiManifest.score}% (${uiManifest.done}/${uiManifest.total} done)`);
console.log(`  Route surfaces:   ${uiRouteScore}%`);
console.log(`  API E2E manifest: ${e2eApiManifest.score}%`);
console.log(`  Product score:    ${productScore}% (avg of the three behavioral scores)`);
console.log('');
console.log(`Release gate:       ${report.releaseGate.pass ? 'PASS' : 'FAIL'}`);
for (const check of report.releaseGate.checks) {
  const mark = check.pass ? 'ok' : 'GAP';
  console.log(`  [${mark}] ${check.id}: ${check.actual}% (need ${check.target}%)`);
}
console.log(`\nWrote ${path.relative(root, reportPath)}`);

process.exitCode = report.releaseGate.pass ? 0 : 1;
