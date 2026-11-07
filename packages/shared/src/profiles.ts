import { COMPONENT_KEYS, type ComponentKey } from './components';

export interface ProfileLimits {
  maxRepositoryBytes: number | null;
  maxAssetBytes: number | null;
  maxComponentBytes: number | null;
}

export interface ArchivalProfileConfig {
  components: Record<ComponentKey, boolean>;
  limits: ProfileLimits;
  exclusions: string[];
}

export interface ProfileOverrides {
  components?: Partial<Record<ComponentKey, boolean>>;
  limits?: Partial<ProfileLimits>;
  exclusions?: string[];
}

export function emptyComponents(enabled: boolean): Record<ComponentKey, boolean> {
  const components = {} as Record<ComponentKey, boolean>;
  for (const key of COMPONENT_KEYS) components[key] = enabled;
  return components;
}

export function minimalProfile(): ArchivalProfileConfig {
  const components = emptyComponents(false);
  components.git = true;
  components.metadata = true;
  return { components, limits: unlimited(), exclusions: [] };
}

export function standardProfile(): ArchivalProfileConfig {
  const components = emptyComponents(false);
  components.git = true;
  components.metadata = true;
  components.docs = true;
  components.releases = true;
  components.releaseAssets = true;
  return { components, limits: unlimited(), exclusions: [] };
}

export function completeProfile(): ArchivalProfileConfig {
  return { components: emptyComponents(true), limits: unlimited(), exclusions: [] };
}

export function unlimited(): ProfileLimits {
  return { maxRepositoryBytes: null, maxAssetBytes: null, maxComponentBytes: null };
}

export function resolveProfile(
  base: ArchivalProfileConfig,
  overrides: ProfileOverrides | null | undefined,
): ArchivalProfileConfig {
  const components = { ...base.components };
  if (overrides?.components) {
    for (const key of COMPONENT_KEYS) {
      const value = overrides.components[key];
      if (typeof value === 'boolean') components[key] = value;
    }
  }
  return {
    components,
    limits: {
      maxRepositoryBytes:
        overrides?.limits && 'maxRepositoryBytes' in overrides.limits
          ? (overrides.limits.maxRepositoryBytes ?? null)
          : base.limits.maxRepositoryBytes,
      maxAssetBytes:
        overrides?.limits && 'maxAssetBytes' in overrides.limits
          ? (overrides.limits.maxAssetBytes ?? null)
          : base.limits.maxAssetBytes,
      maxComponentBytes:
        overrides?.limits && 'maxComponentBytes' in overrides.limits
          ? (overrides.limits.maxComponentBytes ?? null)
          : base.limits.maxComponentBytes,
    },
    exclusions: overrides?.exclusions ? [...overrides.exclusions] : [...base.exclusions],
  };
}

export function isProfileConfig(value: unknown): value is ArchivalProfileConfig {
  if (!isPlain(value)) return false;
  if (!isPlain(value.components) || !isPlain(value.limits)) return false;
  if (!Array.isArray(value.exclusions)) return false;
  for (const key of COMPONENT_KEYS) {
    if (typeof value.components[key] !== 'boolean') return false;
  }
  if (!isLimit(value.limits.maxRepositoryBytes)) return false;
  if (!isLimit(value.limits.maxAssetBytes)) return false;
  if (!isLimit(value.limits.maxComponentBytes)) return false;
  return value.exclusions.every((entry) => typeof entry === 'string');
}

function isLimit(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
}

function isPlain(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
