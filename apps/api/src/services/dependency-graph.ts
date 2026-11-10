import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { type DependencyExpansionPreview, type DependencyKind, type DependencyNodeView, type DependencyResolution } from '@repo-archive/shared';
import { HttpError } from '../errors';
import { asRow, asRows, id, nowIso, text } from '../rows';
import type { CatalogService } from './catalog';
import type { JobsService } from './jobs';
import type { SettingsService } from './settings';
import type { StorageService } from './storage';

export class DependencyGraphService {
  constructor(
    private readonly sqlite: Database.Database,
    private readonly catalog: CatalogService,
    private readonly storage: StorageService,
    private readonly settings: SettingsService,
    private readonly jobs: JobsService,
  ) {}

  listNodes(repositoryId: string): DependencyNodeView[] {
    const rows = asRows(
      this.sqlite
        .prepare(
          `SELECT dependency_nodes.* FROM dependency_nodes
           JOIN dependency_edges ON dependency_edges.to_node_id = dependency_nodes.id
           WHERE dependency_edges.from_repository_id = ?
           ORDER BY dependency_nodes.identity_key ASC`,
        )
        .all(repositoryId),
    );
    return rows.map((row) => mapNode(row));
  }

  exportJson(repositoryId: string): { nodes: DependencyNodeView[]; edges: { id: string; fromRepositoryId: string; toNodeId: string; kind: DependencyKind; originPath: string }[] } {
    const nodes = this.listNodes(repositoryId);
    const edges = asRows(
      this.sqlite.prepare(`SELECT * FROM dependency_edges WHERE from_repository_id = ? ORDER BY origin_path ASC`).all(repositoryId),
    ).map((row) => ({
      id: text(row, 'id'),
      fromRepositoryId: text(row, 'from_repository_id'),
      toNodeId: text(row, 'to_node_id'),
      kind: text(row, 'kind') as DependencyKind,
      originPath: text(row, 'origin_path'),
    }));
    return { nodes, edges };
  }

  discover(repositoryId: string, depth = 1): DependencyExpansionPreview {
    const limits = this.settings.get().phase3.dependencies;
    const repo = this.catalog.require(repositoryId);
    const located = this.storage.pathsFor(repo.storagePoolId, repo.id);
    const discovered = parseRepository(located.paths.root, depth);
    const nodes: DependencyNodeView[] = [];
    const unresolved: DependencyExpansionPreview['unresolved'] = [];
    const cycles: string[] = [];
    const seen = new Set<string>();
    for (const item of discovered) {
      if (seen.has(item.identityKey)) {
        cycles.push(item.identityKey);
        continue;
      }
      seen.add(item.identityKey);
      const resolution = item.url ? 'resolved' : 'unresolved';
      if (resolution === 'unresolved') {
        unresolved.push({ originPath: item.originPath, reference: item.reference, reason: item.reason ?? 'no trustworthy source url' });
      }
      nodes.push({
        id: item.identityKey,
        identityKey: item.identityKey,
        kind: item.kind,
        url: item.url,
        version: item.version,
        resolution,
        repositoryId: null,
        discoveredAt: nowIso(),
      });
    }
    const limitReasons: string[] = [];
    if (nodes.length > limits.maxNewRepositories) limitReasons.push('maxNewRepositories exceeded');
    if (depth > limits.maxDepth) limitReasons.push('maxDepth exceeded');
    const exceedsLimits = limitReasons.length > 0;
    return {
      newRepositories: nodes.filter((node) => node.resolution === 'resolved').length,
      estimatedBytes: nodes.length * 50_000_000,
      depth,
      nodes,
      unresolved,
      cycles,
      exceedsLimits,
      limitReasons,
    };
  }

  persistDiscovery(repositoryId: string, preview: DependencyExpansionPreview): string {
    const discoveryId = id();
    const now = nowIso();
    this.sqlite
      .prepare(
        `INSERT INTO dependency_discoveries (id, root_repository_id, state, approved, limits_json, preview_json, created_at)
         VALUES (?, ?, 'preview', 0, ?, ?, ?)`,
      )
      .run(discoveryId, repositoryId, JSON.stringify(this.settings.get().phase3.dependencies), JSON.stringify(preview), now);
    const upsertNode = this.sqlite.prepare(
      `INSERT INTO dependency_nodes (id, identity_key, kind, url, version, resolution, detail_json, discovered_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, '{}', ?, ?)
       ON CONFLICT(identity_key) DO UPDATE SET updated_at = excluded.updated_at`,
    );
    const insertEdge = this.sqlite.prepare(
      `INSERT INTO dependency_edges (id, from_repository_id, to_node_id, kind, origin_path, discovered_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(from_repository_id, to_node_id, origin_path) DO NOTHING`,
    );
    for (const node of preview.nodes) {
      upsertNode.run(node.id, node.identityKey, node.kind, node.url, node.version, node.resolution, now, now);
      insertEdge.run(id(), repositoryId, node.id, node.kind, node.identityKey, now);
    }
    return discoveryId;
  }

  approve(discoveryId: string): { jobId: string } {
    const row = asRow(this.sqlite.prepare(`SELECT * FROM dependency_discoveries WHERE id = ?`).get(discoveryId));
    if (!row) throw new HttpError(404, 'discovery not found');
    this.sqlite.prepare(`UPDATE dependency_discoveries SET approved = 1, state = 'approved' WHERE id = ?`).run(discoveryId);
    const jobId = this.jobs.enqueue({ type: 'dependency_archive', payload: { discoveryId }, repositoryId: text(row, 'root_repository_id') });
    this.sqlite.prepare(`UPDATE dependency_discoveries SET state = 'queued' WHERE id = ?`).run(discoveryId);
    return { jobId };
  }

  async archiveApproved(discoveryId: string): Promise<{ imported: number; skipped: number }> {
    const row = asRow(this.sqlite.prepare(`SELECT * FROM dependency_discoveries WHERE id = ?`).get(discoveryId));
    if (!row) throw new Error('discovery is missing');
    const preview = JSON.parse(text(row, 'preview_json')) as DependencyExpansionPreview;
    const limits = this.settings.get().phase3.dependencies;
    let imported = 0;
    let skipped = 0;
    for (const node of preview.nodes) {
      if (node.resolution !== 'resolved' || !node.url) {
        skipped += 1;
        continue;
      }
      if (imported >= limits.maxNewRepositories) break;
      try {
        await this.catalog.create({ url: node.url, displayName: node.identityKey, profileId: 'profile-minimal' });
        imported += 1;
      } catch {
        skipped += 1;
      }
    }
    this.sqlite.prepare(`UPDATE dependency_discoveries SET state = 'completed', finished_at = ? WHERE id = ?`).run(nowIso(), discoveryId);
    return { imported, skipped };
  }
}

interface ParsedDependency {
  identityKey: string;
  kind: DependencyKind;
  url: string | null;
  version: string | null;
  reference: string;
  originPath: string;
  reason?: string;
}

function parseRepository(root: string, depth: number): ParsedDependency[] {
  const items: ParsedDependency[] = [];
  if (depth < 1) return items;
  items.push(...parseGitmodules(root));
  items.push(...parsePackageJson(root));
  items.push(...parseGoMod(root));
  items.push(...parseCargoToml(root));
  return items;
}

function parseGitmodules(root: string): ParsedDependency[] {
  const file = path.join(root, '.gitmodules');
  if (!existsSync(file)) return [];
  const text = readFileSync(file, 'utf8');
  const items: ParsedDependency[] = [];
  const blocks = text.split('\n[');
  for (const block of blocks) {
    const urlMatch = block.match(/url\s*=\s*(.+)/);
    const pathMatch = block.match(/path\s*=\s*(.+)/);
    const url = urlMatch?.[1]?.trim() ?? null;
    const submodulePath = pathMatch?.[1]?.trim() ?? 'submodule';
    if (!url) continue;
    items.push({
      identityKey: `git:${normalizeGitUrl(url)}`,
      kind: 'git-submodule',
      url: normalizeGitUrl(url),
      version: null,
      reference: url,
      originPath: submodulePath,
    });
  }
  return items;
}

function parsePackageJson(root: string): ParsedDependency[] {
  const file = path.join(root, 'metadata', 'package.json');
  const candidates = [file, path.join(root, 'package.json')];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      const manifest = JSON.parse(readFileSync(candidate, 'utf8')) as { dependencies?: Record<string, string>; repository?: { url?: string } | string };
      const deps = manifest.dependencies ?? {};
      const items: ParsedDependency[] = [];
      for (const [name, version] of Object.entries(deps)) {
        const repoUrl = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url ?? null;
        items.push({
          identityKey: `npm:${name}@${version}`,
          kind: 'npm-package',
          url: repoUrl ? normalizeGitUrl(repoUrl) : null,
          version,
          reference: name,
          originPath: 'package.json',
          reason: repoUrl ? undefined : 'package manifest has no repository url',
        });
      }
      return items;
    } catch {
      return [];
    }
  }
  return [];
}

function parseGoMod(root: string): ParsedDependency[] {
  const file = path.join(root, 'go.mod');
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, 'utf8').split('\n');
  const items: ParsedDependency[] = [];
  for (const line of lines) {
    const match = line.trim().match(/^(\S+)\s+v(\S+)/);
    if (!match) continue;
    const module = match[1];
    const version = match[2];
    if (!module || module === 'module') continue;
    items.push({
      identityKey: `go:${module}@${version}`,
      kind: 'go-module',
      url: module.includes('.') ? `https://${module}` : null,
      version,
      reference: module,
      originPath: 'go.mod',
      reason: module.includes('.') ? undefined : 'local module path',
    });
  }
  return items;
}

function parseCargoToml(root: string): ParsedDependency[] {
  const file = path.join(root, 'Cargo.toml');
  if (!existsSync(file)) return [];
  const text = readFileSync(file, 'utf8');
  const items: ParsedDependency[] = [];
  const section = text.split('[dependencies]')[1]?.split('[')[0] ?? '';
  for (const line of section.split('\n')) {
    const match = line.match(/^([A-Za-z0-9_-]+)\s*=\s*"([^"]+)"/);
    if (!match) continue;
    items.push({
      identityKey: `cargo:${match[1]}@${match[2]}`,
      kind: 'cargo-crate',
      url: `https://crates.io/crates/${match[1]}`,
      version: match[2],
      reference: match[1],
      originPath: 'Cargo.toml',
    });
  }
  return items;
}

function normalizeGitUrl(url: string): string {
  return url.replace(/^git\+/, '').replace(/\.git$/, '').replace(/^git@([^:]+):/, 'https://$1/');
}

function mapNode(row: Record<string, unknown>): DependencyNodeView {
  return {
    id: text(row, 'id'),
    identityKey: text(row, 'identity_key'),
    kind: text(row, 'kind') as DependencyKind,
    url: typeof row.url === 'string' ? row.url : null,
    version: typeof row.version === 'string' ? row.version : null,
    resolution: text(row, 'resolution') as DependencyResolution,
    repositoryId: typeof row.repository_id === 'string' ? row.repository_id : null,
    discoveredAt: text(row, 'discovered_at'),
  };
}
