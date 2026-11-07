import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  ARCHIVE_SCHEMA_VERSION,
  COMPONENT_KEYS,
  isComponentKey,
  isRecord,
  parseJson,
  stableStringify,
  type ComponentKey,
  type ComponentState,
  type ProviderKind,
} from '@repo-archive/shared';
import { atomicWriteFile } from './atomic';

export interface ManifestComponent {
  state: ComponentState;
  sizeBytes: number;
  lastSuccessAt: string | null;
  error: string | null;
}

export interface ManifestRef {
  name: string;
  oid: string;
}

export interface ManifestArchivedRef extends ManifestRef {
  reason: string;
  recordedAt: string;
  sourceRef: string;
}

export interface ArchiveManifest {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  updatedAt: string;
  generation: number;
  contentHash: string;
  source: {
    canonicalUrl: string;
    identityKey: string;
    provider: ProviderKind;
    providerRepoId: string | null;
    aliases: string[];
    defaultBranch: string | null;
  };
  displayName: string;
  description: string;
  license: string | null;
  profile: {
    name: string;
    components: Record<ComponentKey, boolean>;
  };
  components: Record<ComponentKey, ManifestComponent>;
  refs: {
    current: ManifestRef[];
    archived: ManifestArchivedRef[];
  };
  storage: {
    relativeLayout: 'v1';
  };
}

export function manifestHash(manifest: ArchiveManifest): string {
  const { contentHash: _ignored, ...rest } = manifest;
  return createHash('sha256').update(stableStringify(rest)).digest('hex');
}

export function withContentHash(manifest: Omit<ArchiveManifest, 'contentHash'> & { contentHash?: string }): ArchiveManifest {
  const next: ArchiveManifest = { ...manifest, contentHash: '' };
  next.contentHash = manifestHash(next);
  return next;
}

export async function writeManifest(filePath: string, manifest: ArchiveManifest): Promise<ArchiveManifest> {
  const hashed = withContentHash(manifest);
  await atomicWriteFile(filePath, `${JSON.stringify(hashed, null, 2)}\n`);
  return hashed;
}

export async function readManifest(filePath: string): Promise<ArchiveManifest> {
  const text = await readFile(filePath, 'utf8');
  return parseManifest(parseJson(text));
}

export function parseManifest(value: unknown): ArchiveManifest {
  if (!isRecord(value)) throw new Error('archive manifest is not an object');
  if (value.schemaVersion !== ARCHIVE_SCHEMA_VERSION) {
    throw new Error(`unsupported archive schema version ${String(value.schemaVersion)}`);
  }
  const manifest = value as unknown as ArchiveManifest;
  if (typeof manifest.id !== 'string' || manifest.id.length < 8) throw new Error('manifest id is invalid');
  if (!isRecord(manifest.source) || typeof manifest.source.canonicalUrl !== 'string') {
    throw new Error('manifest source is invalid');
  }
  if (!isRecord(manifest.components) || !isRecord(manifest.refs)) throw new Error('manifest body is invalid');
  for (const key of COMPONENT_KEYS) {
    const component = manifest.components[key];
    if (!component || typeof component.state !== 'string') throw new Error(`manifest component ${key} is missing`);
  }
  if (manifestHash(manifest) !== manifest.contentHash) throw new Error('manifest content hash does not match');
  assertNoSecrets(JSON.stringify(manifest));
  return manifest;
}

export function emptyComponents(): Record<ComponentKey, ManifestComponent> {
  const components = {} as Record<ComponentKey, ManifestComponent>;
  for (const key of COMPONENT_KEYS) {
    components[key] = { state: 'pending', sizeBytes: 0, lastSuccessAt: null, error: null };
  }
  return components;
}

export function componentMap(value: unknown): Record<ComponentKey, boolean> {
  if (!isRecord(value)) throw new Error('profile components are invalid');
  const components = {} as Record<ComponentKey, boolean>;
  for (const key of COMPONENT_KEYS) {
    if (typeof value[key] !== 'boolean') throw new Error(`profile component ${key} is invalid`);
    if (!isComponentKey(key)) throw new Error('unknown component');
    components[key] = value[key];
  }
  return components;
}

function assertNoSecrets(text: string): void {
  if (/ghp_|github_pat_|glpat-|BEGIN [A-Z ]*PRIVATE KEY/.test(text)) {
    throw new Error('manifest contains secret-like material');
  }
}
