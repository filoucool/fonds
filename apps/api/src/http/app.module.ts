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
import { SpaController } from './spa.controller';
import { APP_CONFIG } from './tokens';

export { APP_CONFIG };

@Module({})
export class AppModule {
  static register(container: Container): DynamicModule {
    return {
      module: AppModule,
      controllers: [ApiController, SpaController],
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
      ],
    };
  }
}

export function configFromEnv(): AppConfig {
  return loadConfig();
}
