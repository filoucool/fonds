import { chmodSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { openDatabase, seedDatabase } from './db';
import type { AppConfig } from './config';
import { CatalogService } from './services/catalog';
import { ExportService } from './services/exporter';
import { NodeHttpClient } from './services/http-client';
import { IntegrityService } from './services/integrity';
import { JobsService } from './services/jobs';
import { ArchiveRunner } from './services/runner';
import { SettingsService } from './services/settings';
import { StorageService, type SpaceProbe } from './services/storage';
import { WorkerService } from './services/worker';

export class MaintenanceService {
  constructor(
    private readonly sqlite: Database.Database,
    private readonly dataDir: string,
  ) {}

  async backup(): Promise<{ path: string; bytes: number }> {
    const destination = path.join(this.dataDir, 'app', 'backups', `catalog-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
    await this.sqlite.backup(destination);
    chmodSync(destination, 0o600);
    const info = await stat(destination);
    return { path: destination, bytes: info.size };
  }
}

export interface Container {
  config: AppConfig;
  sqlite: Database.Database;
  settings: SettingsService;
  storage: StorageService;
  jobs: JobsService;
  catalog: CatalogService;
  integrity: IntegrityService;
  exporter: ExportService;
  runner: ArchiveRunner;
  worker: WorkerService;
  maintenance: MaintenanceService;
}

export function createContainer(config: AppConfig, probe?: SpaceProbe): Container {
  process.env.ARCHIVER_ASKPASS = config.askpassPath;
  const sqlite = openDatabase(config.catalogPath);
  seedDatabase(sqlite, config.dataDir);
  const settings = new SettingsService(sqlite);
  const storage = new StorageService(sqlite, settings, probe);
  const jobs = new JobsService(sqlite);
  const catalog = new CatalogService(sqlite, settings, storage, jobs);
  const http = new NodeHttpClient();
  const runner = new ArchiveRunner(catalog, jobs, settings, storage, http);
  const integrity = new IntegrityService(sqlite, catalog, storage);
  const exporter = new ExportService(sqlite, catalog, storage, config.dataDir);
  const maintenance = new MaintenanceService(sqlite, config.dataDir);
  const worker = new WorkerService(jobs, runner, catalog, settings, storage, integrity, exporter, config.workerEnabled);
  return { config, sqlite, settings, storage, jobs, catalog, integrity, exporter, runner, worker, maintenance };
}
