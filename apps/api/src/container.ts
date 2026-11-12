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
import { AuditService } from './services/audit';
import { AuthService } from './services/auth';
import { GitAccessService } from './services/git-access';
import { GitSshService } from './services/git-ssh';
import { SearchService } from './services/search';
import { WorkingRepositoryService } from './services/working-repos';
import { NotificationService } from './services/notifications';
import { BackupService } from './services/backups';
import { SnapshotService } from './services/snapshots';
import { SupplyChainService } from './services/supply-chain';
import { DependencyGraphService } from './services/dependency-graph';
import { RecoveryService } from './services/recovery';

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
  audit: AuditService;
  auth: AuthService;
  search: SearchService;
  gitAccess: GitAccessService;
  gitSsh: GitSshService;
  working: WorkingRepositoryService;
  notifications: NotificationService;
  backups: BackupService;
  snapshots: SnapshotService;
  supplyChain: SupplyChainService;
  dependencies: DependencyGraphService;
  recovery: RecoveryService;
}

export function createContainer(config: AppConfig, probe?: SpaceProbe): Container {
  process.env.FONDS_ASKPASS = config.askpassPath;
  const sqlite = openDatabase(config.catalogPath);
  seedDatabase(sqlite, config.dataDir);
  const settings = new SettingsService(sqlite);
  const storage = new StorageService(sqlite, settings, probe, config.dataDir);
  const jobs = new JobsService(sqlite);
  const catalog = new CatalogService(sqlite, settings, storage, jobs);
  const http = new NodeHttpClient();
  const runner = new ArchiveRunner(catalog, jobs, settings, storage, http);
  const integrity = new IntegrityService(sqlite, catalog, storage);
  const exporter = new ExportService(sqlite, catalog, storage, config.dataDir);
  const maintenance = new MaintenanceService(sqlite, config.dataDir);
  const audit = new AuditService(sqlite);
  const auth = new AuthService(sqlite, settings, audit);
  const working = new WorkingRepositoryService(sqlite, config.dataDir);
  const gitAccess = new GitAccessService(catalog, storage, working);
  const search = new SearchService(sqlite, catalog, storage, settings, path.join(config.dataDir, 'app', 'search-index.sqlite'));
  const gitSsh = new GitSshService(config.dataDir, gitAccess, auth, settings);
  const notifications = new NotificationService(sqlite, settings);
  const backups = new BackupService(sqlite, config.dataDir, catalog, storage, settings, jobs, notifications);
  const snapshots = new SnapshotService(sqlite, config.dataDir, catalog, storage, settings);
  const supplyChain = new SupplyChainService(sqlite, catalog, settings);
  const dependencies = new DependencyGraphService(sqlite, catalog, storage, settings, jobs);
  const recovery = new RecoveryService(sqlite, config.dataDir, catalog, storage, backups);
  const worker = new WorkerService(
    jobs,
    runner,
    catalog,
    settings,
    storage,
    integrity,
    exporter,
    search,
    notifications,
    backups,
    snapshots,
    dependencies,
    config.workerEnabled,
  );
  return {
    config,
    sqlite,
    settings,
    storage,
    jobs,
    catalog,
    integrity,
    exporter,
    runner,
    worker,
    maintenance,
    audit,
    auth,
    search,
    gitAccess,
    gitSsh,
    working,
    notifications,
    backups,
    snapshots,
    supplyChain,
    dependencies,
    recovery,
  };
}
