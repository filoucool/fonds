import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import {
  BACKUP_PROFILES,
  BACKUP_TARGET_TYPES,
  isRecord,
  type BackupProfile,
  type BackupTargetConfig,
  type RecoveryKind,
  type SnapshotCause,
} from '@fonds/shared';
import { HttpError } from '../errors';
import { BackupService } from '../services/backups';
import { DependencyGraphService } from '../services/dependency-graph';
import { RecoveryService } from '../services/recovery';
import { SettingsService } from '../services/settings';
import { SnapshotService } from '../services/snapshots';
import { SupplyChainService } from '../services/supply-chain';
import { WorkerService } from '../services/worker';
import { JobsService } from '../services/jobs';
import { CatalogService } from '../services/catalog';

@Controller('api/phase3')
export class Phase3Controller {
  constructor(
    @Inject(BackupService) private readonly backups: BackupService,
    @Inject(SnapshotService) private readonly snapshots: SnapshotService,
    @Inject(SupplyChainService) private readonly supplyChain: SupplyChainService,
    @Inject(DependencyGraphService) private readonly dependencies: DependencyGraphService,
    @Inject(RecoveryService) private readonly recovery: RecoveryService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(WorkerService) private readonly worker: WorkerService,
    @Inject(JobsService) private readonly jobs: JobsService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
  ) {}

  @Get('settings')
  phase3Settings() {
    return this.settings.get().phase3;
  }

  @Post('settings')
  patchPhase3Settings(@Body() body: unknown) {
    const input = record(body);
    const current = this.settings.get();
    const phase3 = { ...current.phase3, ...(isRecord(input) ? sanitizePhase3Patch(input, current.phase3) : {}) };
    return this.settings.update({ phase3 }).phase3;
  }

  @Get('backups')
  listBackups() {
    return { items: this.backups.list() };
  }

  @Get('backups/:id')
  getBackup(@Param('id') id: string) {
    return this.backups.get(id);
  }

  @Post('backups/run')
  @HttpCode(202)
  runBackup(@Body() body: unknown) {
    const input = record(body);
    const target = parseTarget(input.target);
    const profile = optionalBackupProfile(input.profile);
    const started = this.backups.enqueue(target, profile ?? undefined);
    this.worker.wake();
    return started;
  }

  @Get('backups/retention/preview')
  backupRetentionPreview() {
    return this.backups.retentionPreview();
  }

  @Post('backups/retention/apply')
  applyBackupRetention(@Body() body: unknown) {
    const dryRun = record(body).dryRun !== false;
    return this.backups.applyRetention(dryRun);
  }

  @Get('repositories/:id/snapshots')
  listSnapshots(@Param('id') id: string) {
    return { items: this.snapshots.list(id) };
  }

  @Post('repositories/:id/snapshots')
  @HttpCode(201)
  createSnapshot(@Param('id') id: string, @Body() body: unknown) {
    const input = record(body);
    const cause: SnapshotCause = input.cause === 'scheduled' ? 'scheduled' : 'manual';
    const pinned = input.pinned === true;
    if (cause === 'manual') {
      return this.snapshots.create(id, cause, pinned);
    }
    const jobId = this.catalog.enqueueTyped(id, 'snapshot', { cause, pinned });
    this.worker.wake();
    return { jobId };
  }

  @Get('snapshots/:id')
  getSnapshot(@Param('id') id: string) {
    return this.snapshots.getManifest(id);
  }

  @Get('snapshots/:left/diff/:right')
  diffSnapshots(@Param('left') left: string, @Param('right') right: string) {
    return this.snapshots.diff(left, right);
  }

  @Post('snapshots/:id/pin')
  pinSnapshot(@Param('id') id: string, @Body() body: unknown) {
    this.snapshots.setPinned(id, record(body).pinned === true);
    return { pinned: record(body).pinned === true };
  }

  @Get('repositories/:id/snapshots/retention/preview')
  snapshotRetentionPreview(@Param('id') id: string) {
    return this.snapshots.retentionPreview(id);
  }

  @Post('repositories/:id/snapshots/retention/prune')
  pruneSnapshots(@Param('id') id: string, @Body() body: unknown) {
    const input = record(body);
    return this.snapshots.prune(id, input.dryRun !== false, input.confirmProtected === true);
  }

  @Get('supply-chain/sbom')
  sbom() {
    return this.supplyChain.buildSbom();
  }

  @Get('supply-chain/report')
  selfPreservationReport() {
    return this.supplyChain.selfPreservationReport();
  }

  @Post('supply-chain/enroll')
  enrollSystemDependencies() {
    return this.supplyChain.enrollSystemDependencies();
  }

  @Get('repositories/:id/dependencies')
  dependencyGraph(@Param('id') id: string) {
    return this.dependencies.exportJson(id);
  }

  @Post('repositories/:id/dependencies/discover')
  discoverDependencies(@Param('id') id: string, @Body() body: unknown) {
    const depthRaw = record(body).depth;
    const depth = typeof depthRaw === 'number' && Number.isInteger(depthRaw) ? depthRaw : 1;
    const preview = this.dependencies.discover(id, depth);
    const discoveryId = this.dependencies.persistDiscovery(id, preview);
    return { discoveryId, preview };
  }

  @Post('dependencies/discoveries/:id/approve')
  approveDiscovery(@Param('id') id: string) {
    const result = this.dependencies.approve(id);
    this.worker.wake();
    return result;
  }

  @Get('recovery/runs')
  recoveryRuns() {
    return { items: this.recovery.list() };
  }

  @Post('recovery/start')
  @HttpCode(202)
  startRecovery(@Body() body: unknown) {
    const input = record(body);
    const kind = parseRecoveryKind(input.kind);
    return this.recovery.start({
      kind,
      sourceBackupId: optionalString(input.sourceBackupId),
      sandbox: input.sandbox === true,
      operatorNote: optionalString(input.operatorNote),
      repositoryId: optionalString(input.repositoryId),
      relativeAssetPath: optionalString(input.relativeAssetPath),
      poolId: optionalString(input.poolId),
    });
  }
}

function record(body: unknown): Record<string, unknown> {
  if (!isRecord(body)) throw new HttpError(400, 'expected an object body');
  return body;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function optionalBackupProfile(value: unknown): BackupProfile | null {
  if (typeof value !== 'string') return null;
  for (const profile of BACKUP_PROFILES) {
    if (profile === value) return profile;
  }
  throw new HttpError(400, 'backup profile is invalid');
}

function parseRecoveryKind(value: unknown): RecoveryKind {
  if (typeof value !== 'string') throw new HttpError(400, 'kind is required');
  if (
    value === 'single-asset' ||
    value === 'single-archive' ||
    value === 'catalog' ||
    value === 'storage-pool' ||
    value === 'full-installation'
  ) {
    return value;
  }
  throw new HttpError(400, 'recovery kind is invalid');
}

function parseTarget(value: unknown): BackupTargetConfig {
  if (!isRecord(value) || typeof value.type !== 'string') throw new HttpError(400, 'backup target is required');
  if (!BACKUP_TARGET_TYPES.includes(value.type as BackupTargetConfig['type'])) throw new HttpError(400, 'backup target type is invalid');
  if (value.type === 'local') {
    if (typeof value.path !== 'string') throw new HttpError(400, 'local backup path is required');
    return { type: 'local', path: value.path };
  }
  if (value.type === 'sftp') {
    if (typeof value.host !== 'string' || typeof value.username !== 'string' || typeof value.remotePath !== 'string') {
      throw new HttpError(400, 'sftp target is incomplete');
    }
    return {
      type: 'sftp',
      host: value.host,
      port: typeof value.port === 'number' ? value.port : 22,
      username: value.username,
      remotePath: value.remotePath,
      password: typeof value.password === 'string' ? value.password : undefined,
      privateKey: typeof value.privateKey === 'string' ? value.privateKey : undefined,
    };
  }
  if (
    typeof value.endpoint !== 'string' ||
    typeof value.bucket !== 'string' ||
    typeof value.accessKeyId !== 'string' ||
    typeof value.secretAccessKey !== 'string'
  ) {
    throw new HttpError(400, 's3 target is incomplete');
  }
  return {
    type: 's3',
    endpoint: value.endpoint,
    bucket: value.bucket,
    prefix: typeof value.prefix === 'string' ? value.prefix : '',
    region: typeof value.region === 'string' ? value.region : 'us-east-1',
    accessKeyId: value.accessKeyId,
    secretAccessKey: value.secretAccessKey,
    forcePathStyle: value.forcePathStyle === true,
  };
}

function sanitizePhase3Patch(patch: Record<string, unknown>, current: import('@fonds/shared').Phase3Settings): Partial<import('@fonds/shared').Phase3Settings> {
  const next: Partial<import('@fonds/shared').Phase3Settings> = {};
  if (isRecord(patch.backups)) {
    next.backups = {
      ...current.backups,
      ...(typeof patch.backups.enabled === 'boolean' ? { enabled: patch.backups.enabled } : {}),
      ...(typeof patch.backups.verifyAfterUpload === 'boolean' ? { verifyAfterUpload: patch.backups.verifyAfterUpload } : {}),
      profile: optionalBackupProfile(patch.backups.profile) ?? current.backups.profile,
      collectionIds: Array.isArray(patch.backups.collectionIds)
        ? patch.backups.collectionIds.filter((id): id is string => typeof id === 'string')
        : current.backups.collectionIds,
      targets: Array.isArray(patch.backups.targets) ? patch.backups.targets.map((target) => parseTarget(target)) : current.backups.targets,
      retention: isRecord(patch.backups.retention)
        ? {
            keepLast: typeof patch.backups.retention.keepLast === 'number' ? patch.backups.retention.keepLast : current.backups.retention.keepLast,
            maxAgeDays: typeof patch.backups.retention.maxAgeDays === 'number' ? patch.backups.retention.maxAgeDays : current.backups.retention.maxAgeDays,
            maxBytes: typeof patch.backups.retention.maxBytes === 'number' ? patch.backups.retention.maxBytes : current.backups.retention.maxBytes,
          }
        : current.backups.retention,
      schedule: patch.backups.schedule === null ? null : isScheduleValue(patch.backups.schedule) ? patch.backups.schedule : current.backups.schedule,
    };
  }
  if (isRecord(patch.snapshots)) {
    next.snapshots = {
      ...current.snapshots,
      onChange: typeof patch.snapshots.onChange === 'boolean' ? patch.snapshots.onChange : current.snapshots.onChange,
      manual: typeof patch.snapshots.manual === 'boolean' ? patch.snapshots.manual : current.snapshots.manual,
      schedule: patch.snapshots.schedule === null ? null : isScheduleValue(patch.snapshots.schedule) ? patch.snapshots.schedule : current.snapshots.schedule,
      retention: isRecord(patch.snapshots.retention)
        ? {
            keepLast: typeof patch.snapshots.retention.keepLast === 'number' ? patch.snapshots.retention.keepLast : current.snapshots.retention.keepLast,
            maxAgeDays: typeof patch.snapshots.retention.maxAgeDays === 'number' ? patch.snapshots.retention.maxAgeDays : current.snapshots.retention.maxAgeDays,
            protectPinned:
              typeof patch.snapshots.retention.protectPinned === 'boolean'
                ? patch.snapshots.retention.protectPinned
                : current.snapshots.retention.protectPinned,
          }
        : current.snapshots.retention,
    };
  }
  if (isRecord(patch.dependencies)) {
    next.dependencies = {
      ...current.dependencies,
      autoDiscover: typeof patch.dependencies.autoDiscover === 'boolean' ? patch.dependencies.autoDiscover : current.dependencies.autoDiscover,
      requireApproval: typeof patch.dependencies.requireApproval === 'boolean' ? patch.dependencies.requireApproval : current.dependencies.requireApproval,
      maxDepth: typeof patch.dependencies.maxDepth === 'number' ? patch.dependencies.maxDepth : current.dependencies.maxDepth,
      maxNewRepositories:
        typeof patch.dependencies.maxNewRepositories === 'number' ? patch.dependencies.maxNewRepositories : current.dependencies.maxNewRepositories,
      maxTotalBytes: typeof patch.dependencies.maxTotalBytes === 'number' ? patch.dependencies.maxTotalBytes : current.dependencies.maxTotalBytes,
      skipPackageTypes: current.dependencies.skipPackageTypes,
    };
  }
  if (isRecord(patch.selfPreservation)) {
    next.selfPreservation = {
      ...current.selfPreservation,
      enabled: typeof patch.selfPreservation.enabled === 'boolean' ? patch.selfPreservation.enabled : current.selfPreservation.enabled,
      enrollResolvedSources:
        typeof patch.selfPreservation.enrollResolvedSources === 'boolean'
          ? patch.selfPreservation.enrollResolvedSources
          : current.selfPreservation.enrollResolvedSources,
      collectionName:
        typeof patch.selfPreservation.collectionName === 'string' ? patch.selfPreservation.collectionName : current.selfPreservation.collectionName,
    };
  }
  return next;
}

function isScheduleValue(value: unknown): value is import('@fonds/shared').Schedule {
  return typeof value === 'object' && value !== null && 'kind' in value;
}
