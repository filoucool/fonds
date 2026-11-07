import { existsSync } from 'node:fs';
import path from 'node:path';
import { APP_VERSION } from '@repo-archive/shared';

export interface AppConfig {
  host: string;
  port: number;
  dataDir: string;
  catalogPath: string;
  workerEnabled: boolean;
  webDist: string | null;
  version: string;
  askpassPath: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): AppConfig {
  const dataDir = path.resolve(env.DATA_DIR ?? path.join(cwd, 'data'));
  const port = Number(env.PORT ?? '8080');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  const webCandidates = [
    env.WEB_DIST,
    path.join(cwd, 'apps/web/dist'),
    path.resolve(__dirname, '../../web/dist'),
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);
  const askpassCandidates = [
    env.ARCHIVER_ASKPASS,
    path.join(cwd, 'scripts/git-askpass.sh'),
    path.resolve(__dirname, '../../../scripts/git-askpass.sh'),
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);
  return {
    host: env.HOST ?? '127.0.0.1',
    port,
    dataDir,
    catalogPath: path.join(dataDir, 'app', 'catalog.sqlite'),
    workerEnabled: env.WORKER_ENABLED !== 'false',
    webDist: webCandidates.find((candidate) => existsSync(path.join(candidate, 'index.html'))) ?? null,
    version: APP_VERSION,
    askpassPath: askpassCandidates.find((candidate) => existsSync(candidate)) ?? askpassCandidates[0] ?? 'archiver-askpass',
  };
}
