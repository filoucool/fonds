import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { APP_VERSION, type SelfPreservationReport } from '@fonds/shared';
import { HttpError } from '../errors';
import { id, nowIso } from '../rows';
import type { CatalogService } from './catalog';
import type { SettingsService } from './settings';

export class SupplyChainService {
  constructor(
    private readonly sqlite: Database.Database,
    private readonly catalog: CatalogService,
    private readonly settings: SettingsService,
  ) {}

  inventoryPath(): string | null {
    const candidates = [
      path.resolve(process.cwd(), 'docs/dependency-inventory.json'),
      path.resolve(process.cwd(), '../../docs/dependency-inventory.json'),
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }
    return null;
  }

  loadInventory(): { generatedAt: string; packages: { name: string; version: string; license: string | null; repository: string | null }[]; images: unknown[]; contentSha256?: string } {
    const file = this.inventoryPath();
    if (!file) {
      return { generatedAt: nowIso(), packages: [], images: [] };
    }
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!isInventory(parsed)) throw new HttpError(500, 'dependency inventory is invalid');
    return parsed;
  }

  buildSbom(): { format: 'cyclonedx-lite'; document: Record<string, unknown> } {
    const inventory = this.loadInventory();
    const components = inventory.packages.map((pkg) => ({
      type: 'library',
      name: pkg.name,
      version: pkg.version,
      licenses: pkg.license ? [{ license: { id: pkg.license } }] : [],
      externalReferences: pkg.repository ? [{ type: 'vcs', url: pkg.repository }] : [],
      purl: `pkg:npm/${pkg.name}@${pkg.version}`,
    }));
    return {
      format: 'cyclonedx-lite',
      document: {
        bomFormat: 'CycloneDX',
        specVersion: '1.5',
        version: 1,
        metadata: { timestamp: nowIso(), component: { name: 'fonds', version: APP_VERSION } },
        components,
        dependencies: [],
      },
    };
  }

  selfPreservationReport(): SelfPreservationReport {
    const inventory = this.loadInventory();
    const settings = this.settings.get().phase3.selfPreservation;
    const enrolled: SelfPreservationReport['enrolled'] = [];
    const missing: SelfPreservationReport['missing'] = [];
    for (const pkg of inventory.packages) {
      if (!pkg.repository) {
        missing.push({ name: `${pkg.name}@${pkg.version}`, reason: 'no upstream repository in inventory' });
        continue;
      }
      const repo = this.sqlite.prepare(`SELECT id FROM repositories WHERE canonical_url = ? OR fetch_url = ? LIMIT 1`).get(pkg.repository, pkg.repository) as { id?: string } | undefined;
      enrolled.push({
        name: pkg.name,
        version: pkg.version,
        repositoryId: repo?.id ?? null,
        url: pkg.repository,
      });
    }
    if (settings.enrollResolvedSources) this.ensureCollection(enrolled);
    return {
      generatedAt: nowIso(),
      applicationVersion: APP_VERSION,
      inventorySha256: inventory.contentSha256 ?? hashInventory(inventory),
      enrolled,
      missing,
      restorationNotes: [
        'Archived source repositories restore with normal import flows; lockfiles and images may still be required for full rebuild.',
        'Container image digests in the inventory are evidence only until archived separately.',
      ],
    };
  }

  storeReport(report: SelfPreservationReport): string {
    const reportId = id();
    this.sqlite
      .prepare(`INSERT INTO supply_chain_reports (id, format, report_json, created_at) VALUES (?, 'self-preservation', ?, ?)`)
      .run(reportId, JSON.stringify(report), nowIso());
    return reportId;
  }

  enrollSystemDependencies(): { collectionId: string; created: number } {
    const report = this.selfPreservationReport();
    const { collectionId, created } = this.ensureCollection(report.enrolled);
    this.storeReport(report);
    return { collectionId, created };
  }

  private ensureCollection(enrolled: SelfPreservationReport['enrolled']): { collectionId: string; created: number } {
    const settings = this.settings.get().phase3.selfPreservation;
    const name = settings.collectionName;
    const existing = this.catalog.collections().find((item) => item.name === name);
    const collection = existing ?? this.catalog.createCollection(name, 'Archived upstream sources for application dependencies.');
    const repoIds = enrolled.map((entry) => entry.repositoryId).filter((value): value is string => typeof value === 'string');
    if (repoIds.length > 0) this.catalog.setCollectionMembers(collection.id, [...new Set(repoIds)]);
    return { collectionId: collection.id, created: repoIds.length };
  }
}

function hashInventory(inventory: { packages: unknown[]; images: unknown[]; generatedAt: string }): string {
  return createHash('sha256').update(JSON.stringify(inventory)).digest('hex');
}

function isInventory(value: unknown): value is { generatedAt: string; packages: { name: string; version: string; license: string | null; repository: string | null }[]; images: unknown[]; contentSha256?: string } {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as { packages?: unknown; generatedAt?: unknown };
  return Array.isArray(record.packages) && typeof record.generatedAt === 'string';
}
