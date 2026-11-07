import { hostname } from 'node:os';
import { JobInterrupted, RateLimitError, StorageThresholdError } from '../errors';
import { nowIso } from '../rows';
import type { CatalogService } from './catalog';
import type { ExportService } from './exporter';
import type { IntegrityService } from './integrity';
import type { JobRecord, JobsService } from './jobs';
import type { ArchiveRunner } from './runner';
import type { SettingsService } from './settings';
import type { StorageService } from './storage';

export class WorkerService {
  private stopped = false;
  private wakeUp: (() => void) | null = null;
  private running = new Set<Promise<void>>();
  private inFlight = 0;
  private readonly owner = `${hostname()}-${process.pid}`;
  private lastBalance = 0;

  constructor(
    private readonly jobs: JobsService,
    private readonly runner: ArchiveRunner,
    private readonly catalog: CatalogService,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
    private readonly integrity: IntegrityService,
    private readonly exporter: ExportService,
    private readonly enabled: boolean,
  ) {}

  start(): void {
    if (!this.enabled) return;
    void this.loop();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.wake();
    await Promise.allSettled([...this.running]);
  }

  wake(): void {
    this.wakeUp?.();
  }

  async tick(): Promise<number> {
    this.jobs.reap();
    if (this.storage.list().some((pool) => pool.freeBytes > pool.freeSpaceThresholdBytes)) this.jobs.resumeStoragePauses();
    for (const repositoryId of this.catalog.dueRepositories()) this.catalog.enqueueSync(repositoryId);
    this.balance();
    const max = this.settings.get().maxConcurrentJobs;
    while (this.inFlight < max) {
      const job = this.jobs.claim(this.owner);
      if (!job) break;
      this.inFlight += 1;
      const promise = this.execute(job).finally(() => {
        this.inFlight -= 1;
        this.wake();
      });
      this.running.add(promise);
      promise.finally(() => this.running.delete(promise));
    }
    if (this.inFlight > 0 || this.jobs.hasReadyWork()) return 1000;
    return this.jobs.msUntilNextWake();
  }

  private balance(): void {
    if (!this.settings.get().balancingEnabled) return;
    if (Date.now() - this.lastBalance < 60 * 60 * 1000) return;
    this.lastBalance = Date.now();
    for (const move of this.storage.planBalance()) {
      this.catalog.enqueueTyped(move.repositoryId, 'migrate', { destinationPoolId: move.toPoolId });
    }
  }

  private async execute(job: JobRecord): Promise<void> {
    const heartbeat = setInterval(() => {
      const alive = this.jobs.heartbeat(job.id, this.owner);
      if (!alive) controller.abort();
    }, 10_000);
    const controller = new AbortController();
    try {
      if (job.type === 'verify' && job.repositoryId) {
        await this.integrity.verify(job.repositoryId);
        this.jobs.finish(job.id, 'completed', null, null);
        return;
      }
      if (job.type === 'export') {
        const exportId = typeof job.payload.exportId === 'string' ? job.payload.exportId : '';
        await this.exporter.run(exportId);
        this.jobs.finish(job.id, 'completed', null, null);
        return;
      }
      if (job.type === 'migrate' && job.repositoryId) {
        const repo = this.catalog.require(job.repositoryId);
        const destination = typeof job.payload.destinationPoolId === 'string' ? job.payload.destinationPoolId : '';
        await this.storage.migrate(repo.id, destination, repo.storagePoolId, repo.relativePath);
        this.catalog.event(repo.id, 'storage.migrated', 'Migrated archive after destination verification', { destination });
        this.jobs.finish(job.id, 'completed', null, null);
        return;
      }
      if (job.type === 'import') {
        const sourcePath = typeof job.payload.sourcePath === 'string' ? job.payload.sourcePath : '';
        await this.catalog.importLocal(sourcePath);
        this.jobs.finish(job.id, 'completed', null, null);
        return;
      }
      if (job.type === 'rebuild') {
        await this.catalog.rebuild();
        this.jobs.finish(job.id, 'completed', null, null);
        return;
      }
      const outcome = await this.runner.run(job, controller.signal);
      this.jobs.finish(job.id, outcome === 'failed' ? 'failed' : outcome === 'partial' ? 'partial' : 'completed', outcome === 'completed' ? null : outcome, null);
    } catch (error) {
      const current = this.jobs.find(job.id);
      if (error instanceof JobInterrupted || current?.state === 'paused' || current?.state === 'cancelled') return;
      if (error instanceof StorageThresholdError) {
        this.jobs.pauseForStorage(job.id);
        return;
      }
      if (error instanceof RateLimitError) {
        this.jobs.defer(job.id, error.retryAt, error.message);
        return;
      }
      const message = error instanceof Error ? error.message : 'job failed';
      if (job.attempt >= job.maxAttempts) this.jobs.finish(job.id, 'failed', 'internal', message);
      else {
        const delay = Math.min(30_000 * 2 ** Math.max(job.attempt - 1, 0), 10 * 60_000);
        this.jobs.requeue(job.id, new Date(Date.now() + delay).toISOString(), message);
      }
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      let delay = 15_000;
      try {
        delay = await this.tick();
      } catch (error) {
        console.error(error instanceof Error ? error.message : 'worker tick failed');
        delay = 5_000;
      }
      await this.sleep(delay);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.wakeUp = null;
        resolve();
      }, ms);
      this.wakeUp = () => {
        clearTimeout(timer);
        this.wakeUp = null;
        resolve();
      };
    });
  }
}

void nowIso;
