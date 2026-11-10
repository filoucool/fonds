import { type DynamicModule, Module } from '@nestjs/common';
import type { Container } from '../container';
import { MaintenanceService } from '../container';
import { loadConfig, type AppConfig } from '../config';
import { CatalogService } from '../services/catalog';
import { ExportService } from '../services/exporter';
import { IntegrityService } from '../services/integrity';
import { JobsService } from '../services/jobs';
import { SettingsService } from '../services/settings';
import { StorageService } from '../services/storage';
import { WorkerService } from '../services/worker';
import { ApiController } from './controllers';
import { Phase2Controller } from './phase2.controller';
import { V1Controller } from './v1.controller';
import { Phase3Controller } from './phase3.controller';
import { SpaController } from './spa.controller';
import { AuditService } from '../services/audit';
import { AuthService } from '../services/auth';
import { GitAccessService } from '../services/git-access';
import { SearchService } from '../services/search';
import { WorkingRepositoryService } from '../services/working-repos';
import { BackupService } from '../services/backups';
import { SnapshotService } from '../services/snapshots';
import { SupplyChainService } from '../services/supply-chain';
import { DependencyGraphService } from '../services/dependency-graph';
import { RecoveryService } from '../services/recovery';
import { APP_CONFIG } from './tokens';

export { APP_CONFIG };

@Module({})
export class AppModule {
  static register(container: Container): DynamicModule {
    return {
      module: AppModule,
      controllers: [ApiController, Phase2Controller, Phase3Controller, V1Controller, SpaController],
      providers: [
        { provide: APP_CONFIG, useValue: container.config },
        { provide: CatalogService, useValue: container.catalog },
        { provide: JobsService, useValue: container.jobs },
        { provide: SettingsService, useValue: container.settings },
        { provide: StorageService, useValue: container.storage },
        { provide: IntegrityService, useValue: container.integrity },
        { provide: ExportService, useValue: container.exporter },
        { provide: WorkerService, useValue: container.worker },
        { provide: MaintenanceService, useValue: container.maintenance },
        { provide: AuditService, useValue: container.audit },
        { provide: AuthService, useValue: container.auth },
        { provide: SearchService, useValue: container.search },
        { provide: GitAccessService, useValue: container.gitAccess },
        { provide: WorkingRepositoryService, useValue: container.working },
        { provide: BackupService, useValue: container.backups },
        { provide: SnapshotService, useValue: container.snapshots },
        { provide: SupplyChainService, useValue: container.supplyChain },
        { provide: DependencyGraphService, useValue: container.dependencies },
        { provide: RecoveryService, useValue: container.recovery },
      ],
    };
  }
}

export function configFromEnv(): AppConfig {
  return loadConfig();
}
