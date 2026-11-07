import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile, resolveInside, sanitizeFileName } from '@repo-archive/archive-format';
import {
  COMPONENT_KEYS,
  matchesAnyExclusion,
  redact,
  type ComponentKey,
  type ComponentState,
} from '@repo-archive/shared';
import { GitCommandError, listLocalRefs, syncBareRepository, type RefNamespace } from '@repo-archive/git-exec';
import { JobInterrupted, RateLimitError, StorageThresholdError } from '../errors';
import { nowIso } from '../rows';
import { listTree, readBlob } from './browse';
import type { CatalogService, RepoRecord } from './catalog';
import type { JobRecord, JobsService } from './jobs';
import { authUsername, providerFor, type GitProvider, type IssueRecord, type ProviderContext, type ReleaseRecord } from './providers';
import type { SettingsService } from './settings';
import type { StorageService } from './storage';
import type { ArchiveHttp } from './http-client';

const ORDER: ComponentKey[] = [
  'metadata',
  'git',
  'pullRefs',
  'docs',
  'submodules',
  'lfs',
  'wiki',
  'releases',
  'releaseAssets',
  'issues',
  'issueComments',
  'pullRequests',
  'pullRequestComments',
  'discussions',
];

export class ArchiveRunner {
  constructor(
    private readonly catalog: CatalogService,
    private readonly jobs: JobsService,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
    private readonly http: ArchiveHttp,
  ) {}

  async run(job: JobRecord, signal: AbortSignal): Promise<'completed' | 'partial' | 'failed'> {
    if (!job.repositoryId) throw new Error('sync job is missing a repository');
    const repo = this.catalog.require(job.repositoryId);
    const profile = this.catalog.effectiveProfile(repo.id);
    const provider = providerFor(repo.provider);
    const settings = this.settings.get();
    const located = this.storage.pathsFor(repo.storagePoolId, repo.id);
    await mkdir(located.paths.root, { recursive: true });
    let sequence = 0;
    for (const component of ORDER) {
      this.jobs.ensureStep(job.id, component, sequence);
      sequence += 1;
    }
    const secrets = [this.catalog.credentialFor(repo.provider)?.token ?? ''].filter((value) => value.length > 0);
    let failures = 0;
    let successes = 0;
    for (const component of ORDER) {
      this.assertActive(job.id, signal);
      const enabled = profile.config.components[component];
      const supported = provider.capabilities().has(component) || component === 'docs' || component === 'submodules' || component === 'lfs';
      if (!enabled) {
        this.catalog.setComponent(repo.id, component, { state: 'skipped', error: null, detail: { reason: 'disabled' } });
        this.jobs.updateStep(job.id, component, { state: 'skipped', finishedAt: nowIso() });
        continue;
      }
      if (!supported && component !== 'git' && component !== 'metadata') {
        this.catalog.setComponent(repo.id, component, { state: 'unsupported', error: null, detail: { reason: 'provider' } });
        this.jobs.updateStep(job.id, component, { state: 'unsupported', finishedAt: nowIso() });
        continue;
      }
      const step = this.jobs.get(job.id).steps.find((item) => item.component === component);
      if (step && (step.state === 'complete' || step.state === 'skipped' || step.state === 'unsupported')) {
        successes += 1;
        continue;
      }
      this.storage.assertSpace(repo.storagePoolId);
      this.jobs.updateStep(job.id, component, { state: 'running', startedAt: step?.startedAt ?? nowIso() });
      this.catalog.setComponent(repo.id, component, { state: 'running' });
      try {
        const outcome = await this.runComponent(component, repo, provider, signal, located.paths);
        const state = outcome ?? 'complete';
        this.catalog.setComponent(repo.id, component, {
          state,
          error: state === 'partial' ? 'incomplete' : null,
          success: state === 'complete',
          detail: state === 'complete' ? undefined : { outcome: state },
        });
        this.jobs.updateStep(job.id, component, { state, finishedAt: nowIso(), error: state === 'partial' ? 'incomplete' : null });
        if (state === 'partial') failures += 1;
        else successes += 1;
      } catch (error) {
        if (error instanceof JobInterrupted || error instanceof StorageThresholdError || error instanceof RateLimitError) throw error;
        const message = redact(error instanceof Error ? error.message : 'component failed', secrets);
        const contact = component === 'git' || component === 'metadata' ? classifyContact(error) : null;
        if (contact && repo.lastSuccessAt) {
          this.catalog.setUpstream(repo.id, contact);
          this.catalog.setComponent(repo.id, component, { state: 'complete', error: message });
          this.jobs.updateStep(job.id, component, { state: 'complete', finishedAt: nowIso(), error: message });
          this.catalog.event(repo.id, 'upstream.unavailable', message, { component });
        } else {
          this.catalog.setComponent(repo.id, component, { state: 'failed', error: message });
          this.jobs.updateStep(job.id, component, { state: 'failed', finishedAt: nowIso(), error: message });
          if (contact) this.catalog.setUpstream(repo.id, contact);
          failures += 1;
        }
      }
    }
    const fresh = this.catalog.require(repo.id);
    const current = await listLocalRefs(
      { gitDir: located.paths.gitDir, allowFileProtocol: settings.allowFileUrls, timeoutMs: settings.gitTimeoutMs },
      ['refs/heads', 'refs/tags', 'refs/notes', 'refs/pull', 'refs/merge-requests'],
    ).catch(() => []);
    await this.catalog.saveManifest(fresh, {
      current,
      archived: [],
    });
    await this.catalog.directorySize(repo.id);
    this.catalog.recompute(repo.id);
    this.catalog.markSynced(repo.id, failures === 0);
    if (failures > 0 && successes > 0) return 'partial';
    if (failures > 0) return 'failed';
    return 'completed';
  }

  private async runComponent(
    component: ComponentKey,
    repo: RepoRecord,
    provider: GitProvider,
    signal: AbortSignal,
    paths: ReturnType<typeof import('@repo-archive/archive-format').archivePaths>,
  ): Promise<ComponentState | void> {
    const settings = this.settings.get();
    const profile = this.catalog.effectiveProfile(repo.id).config;
    const credential = this.catalog.credentialFor(repo.provider);
    const ctx: ProviderContext = {
      http: this.http,
      credential: credential ? { username: credential.username, token: credential.token } : null,
      signal,
      policy: this.settings.networkPolicy(),
      timeoutMs: settings.requestTimeoutMs,
    };
    const coords = {
      provider: repo.provider,
      host: new URL(repo.canonicalUrl.startsWith('file:') ? 'https://localhost' : repo.canonicalUrl).host,
      canonicalUrl: repo.canonicalUrl,
      fetchUrl: repo.fetchUrl,
      projectPath: projectPath(repo),
      name: repo.displayName,
    };
    if (component === 'metadata') {
      const metadata = await provider.metadata(coords, ctx);
      if (metadata.sizeBytes !== null && profile.limits.maxRepositoryBytes !== null && metadata.sizeBytes > profile.limits.maxRepositoryBytes) {
        this.catalog.setComponent(repo.id, 'git', { state: 'skipped', error: 'repository size exceeds the profile limit', detail: { sizeBytes: metadata.sizeBytes } });
      }
      this.catalog.applyMetadata(repo.id, metadata);
      await atomicWriteFile(path.join(paths.metadata, 'provider.json'), `${JSON.stringify(metadata.raw, null, 2)}\n`);
      if (repo.provider !== 'git') this.catalog.setUpstream(repo.id, 'reachable');
      return;
    }
    if (component === 'git' || component === 'pullRefs') {
      const gitState = this.catalog.components(repo.id).find((item) => item.component === 'git');
      if (component === 'git' && gitState?.state === 'skipped' && gitState.error?.includes('size')) return 'skipped';
      if (component === 'pullRefs' && !profile.components.git) return 'skipped';
      if (component === 'pullRefs' && repo.provider === 'git') return 'unsupported';
      const namespaces: RefNamespace[] = [];
      if (component === 'git') namespaces.push('heads', 'tags', 'notes');
      if (component === 'pullRefs' && repo.provider === 'github') namespaces.push('pull');
      if (component === 'pullRefs' && repo.provider === 'gitlab') namespaces.push('merge-requests');
      if (namespaces.length === 0) return;
      const before = await listLocalRefs({ gitDir: paths.gitDir, allowFileProtocol: settings.allowFileUrls }, namespaces.map((item) => `refs/${item}`)).catch(() => []);
      const result = await syncBareRepository({
        gitDir: component === 'git' ? paths.gitDir : paths.gitDir,
        remoteUrl: repo.fetchUrl,
        namespaces,
        timeoutMs: settings.gitTimeoutMs,
        signal,
        allowFileProtocol: settings.allowFileUrls,
        auth: credential ? { username: authUsername(repo.provider), token: credential.token } : undefined,
        recordedAt: nowIso(),
      });
      this.catalog.setUpstream(repo.id, 'reachable');
      await this.catalog.saveManifest(this.catalog.require(repo.id), {
        current: result.current,
        archived: result.protectedRefs.map((ref) => ({
          name: ref.name,
          oid: ref.oid,
          reason: ref.reason,
          recordedAt: nowIso(),
          sourceRef: ref.sourceRef,
        })),
      });
      await atomicWriteFile(
        path.join(paths.syncRecords, `${nowIso().replace(/[:.]/g, '-')}.json`),
        `${JSON.stringify({ before, after: result.current, protected: result.protectedRefs, warnings: result.warnings }, null, 2)}\n`,
      );
      return;
    }
    if (component === 'docs') return this.exportDocs(repo, paths, profile.limits.maxAssetBytes, profile.exclusions);
    if (component === 'submodules') return this.archiveSubmodules(repo, paths, settings.allowFileUrls, settings.gitTimeoutMs, signal, profile.components.submodules);
    if (component === 'lfs') return this.archiveLfs(repo, provider, coords, ctx, paths, profile.limits.maxAssetBytes);
    if (component === 'wiki') return this.archiveWiki(repo, provider, coords, paths, settings, signal, credential);
    if (component === 'releases') return this.archiveReleases(repo, provider, coords, ctx, paths, false, profile.limits.maxAssetBytes, profile.exclusions);
    if (component === 'releaseAssets') return this.archiveReleases(repo, provider, coords, ctx, paths, true, profile.limits.maxAssetBytes, profile.exclusions);
    if (component === 'issues') return this.archivePages(repo, 'issue', (cursor) => provider.issues?.(coords, ctx, cursor) ?? Promise.resolve({ items: [], nextCursor: null }), paths);
    if (component === 'pullRequests') return this.archivePages(repo, 'pull', (cursor) => provider.pullRequests?.(coords, ctx, cursor) ?? Promise.resolve({ items: [], nextCursor: null }), paths);
    if (component === 'discussions') {
      if (!provider.discussions || !credential) return 'unsupported';
      return this.archivePages(repo, 'discussion', (cursor) => provider.discussions?.(coords, ctx, cursor) ?? Promise.resolve({ items: [], nextCursor: null }), paths);
    }
    if (component === 'issueComments' || component === 'pullRequestComments') {
      const parentKind = component === 'issueComments' ? 'issue' : 'pull';
      const parents = this.catalog.recordKeys(repo.id, parentKind);
      let index = 0;
      for (const parent of parents) {
        this.assertActive(repo.id, signal);
        if (parent.number === null) continue;
        const load = component === 'issueComments' ? provider.issueComments : provider.pullComments;
        if (!load) return 'unsupported';
        await this.archivePages(repo, component === 'issueComments' ? 'issue_comment' : 'pull_comment', (cursor) => load.call(provider, coords, ctx, parent.number ?? 0, cursor), paths, `${parent.key}:${index}`);
        index += 1;
      }
    }
  }

  private async archivePages(
    repo: RepoRecord,
    kind: string,
    load: (cursor: string | null) => Promise<{ items: IssueRecord[]; nextCursor: string | null }>,
    paths: { metadata: string },
    generationKey = kind,
  ): Promise<ComponentState | void> {
    const generation = Date.now();
    let cursor: string | null = null;
    let pages = 0;
    const maxPages = this.settings.get().maxProviderPages;
    const rawDir = path.join(paths.metadata, 'raw', kind);
    do {
      const page = await load(cursor);
      pages += 1;
      await atomicWriteFile(path.join(rawDir, `page-${pages}.json`), `${JSON.stringify(page.items.map((item) => item.raw), null, 2)}\n`);
      for (const item of page.items) {
        this.catalog.upsertRecord({
          repositoryId: repo.id,
          kind,
          providerKey: `${generationKey}:${item.key}`,
          number: item.number,
          title: item.title,
          state: item.state,
          author: item.author,
          body: item.body,
          url: item.url,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          generation,
          rawRelativePath: `metadata/raw/${kind}/page-${pages}.json`,
        });
        if (item.number !== null) {
          const markdown = `# ${item.title}\n\n${item.body}\n`;
          await atomicWriteFile(path.join(paths.metadata, kind, `${item.number}.md`), markdown);
        }
      }
      cursor = page.nextCursor;
      if (pages >= maxPages && cursor) return 'partial';
    } while (cursor);
    this.catalog.markMissing(repo.id, kind, generation);
  }

  private async archiveReleases(
    repo: RepoRecord,
    provider: GitProvider,
    coords: Parameters<GitProvider['metadata']>[0],
    ctx: ProviderContext,
    paths: { releases: string; metadata: string },
    assetsOnly: boolean,
    maxAssetBytes: number | null,
    exclusions: string[],
  ): Promise<ComponentState | void> {
    if (!provider.releases) return 'unsupported';
    let cursor: string | null = null;
    const generation = Date.now();
    do {
      const page = await provider.releases(coords, ctx, cursor);
      for (const release of page.items) {
        if (!assetsOnly) {
          this.catalog.upsertRecord({
            repositoryId: repo.id,
            kind: 'release',
            providerKey: release.key,
            title: release.tag,
            state: release.state,
            author: release.author,
            body: release.body,
            url: release.url,
            createdAt: release.createdAt,
            generation,
          });
          await atomicWriteFile(path.join(paths.metadata, 'releases', `${sanitizeFileName(release.tag)}.md`), `# ${release.title}\n\n${release.body}\n`);
        } else {
          await this.downloadAssets(repo, release, ctx, paths.releases, maxAssetBytes, exclusions);
        }
      }
      cursor = page.nextCursor;
    } while (cursor);
    if (!assetsOnly) this.catalog.markMissing(repo.id, 'release', generation);
  }

  private async downloadAssets(repo: RepoRecord, release: ReleaseRecord, ctx: ProviderContext, releasesRoot: string, maxAssetBytes: number | null, exclusions: string[]): Promise<void> {
    for (const asset of release.assets) {
      const relative = `releases/${sanitizeFileName(release.tag)}/${sanitizeFileName(asset.name)}`;
      if (matchesAnyExclusion(exclusions, relative) || (asset.sizeBytes !== null && maxAssetBytes !== null && asset.sizeBytes > maxAssetBytes)) {
        this.catalog.upsertAsset({ repositoryId: repo.id, releaseKey: release.key, name: asset.name, upstreamUrl: asset.downloadUrl, relativePath: null, byteSize: asset.sizeBytes, sha256: null, state: 'skipped', error: 'size_limit or exclusion' });
        continue;
      }
      if (!asset.downloadUrl) {
        this.catalog.upsertAsset({ repositoryId: repo.id, releaseKey: release.key, name: asset.name, upstreamUrl: null, relativePath: null, byteSize: asset.sizeBytes, sha256: null, state: 'failed', error: 'missing download url' });
        continue;
      }
      const destination = resolveInside(path.dirname(releasesRoot), relative);
      const headers = ctx.credential ? { authorization: `Bearer ${ctx.credential.token}` } : undefined;
      const downloaded = await this.http.download({
        url: asset.downloadUrl,
        destination,
        headers,
        maxBytes: maxAssetBytes,
        signal: ctx.signal,
        timeoutMs: ctx.timeoutMs,
        policy: ctx.policy,
      });
      this.catalog.upsertAsset({
        repositoryId: repo.id,
        releaseKey: release.key,
        name: asset.name,
        upstreamUrl: asset.downloadUrl,
        relativePath: relative,
        byteSize: downloaded.bytes,
        sha256: downloaded.sha256,
        state: 'complete',
        error: null,
      });
    }
  }

  private async exportDocs(repo: RepoRecord, paths: { docs: string; gitDir: string }, maxAssetBytes: number | null, exclusions: string[]): Promise<void> {
    const fresh = this.catalog.require(repo.id);
    const ref = fresh.defaultBranch ? `refs/heads/${fresh.defaultBranch}` : 'HEAD';
    const entries = await listTree(paths.gitDir, ref === 'HEAD' ? 'refs/heads/main' : ref, '').catch(() => []);
    const interesting = entries.filter((entry) => entry.kind === 'blob' && (entry.name.toLowerCase().startsWith('readme') || entry.name.toLowerCase().startsWith('license') || entry.name.toLowerCase().startsWith('changelog') || entry.path.startsWith('docs/')));
    for (const entry of interesting) {
      if (matchesAnyExclusion(exclusions, entry.path)) continue;
      if (entry.sizeBytes !== null && maxAssetBytes !== null && entry.sizeBytes > maxAssetBytes) continue;
      const blob = await readBlob(paths.gitDir, ref === 'HEAD' ? 'refs/heads/main' : ref, entry.path).catch(() => null);
      if (!blob?.content) continue;
      await atomicWriteFile(resolveInside(paths.docs, entry.path), blob.content);
    }
  }

  private async archiveSubmodules(
    repo: RepoRecord,
    paths: { gitDir: string; submodules: string; metadata: string },
    allowFile: boolean,
    timeoutMs: number,
    signal: AbortSignal,
    enabled: boolean,
  ): Promise<void> {
    const fresh = this.catalog.require(repo.id);
    const ref = fresh.defaultBranch ? `refs/heads/${fresh.defaultBranch}` : 'refs/heads/main';
    const blob = await readBlob(paths.gitDir, ref, '.gitmodules').catch(() => null);
    const modules = blob?.content ? parseGitmodules(blob.content) : [];
    await atomicWriteFile(path.join(paths.metadata, 'submodules.json'), `${JSON.stringify(modules, null, 2)}\n`);
    if (!enabled) return;
    let index = 0;
    for (const module of modules) {
      const destination = path.join(paths.submodules, `${index}-${sanitizeFileName(module.path)}.git`);
      await syncBareRepository({
        gitDir: destination,
        remoteUrl: module.url,
        namespaces: ['heads', 'tags'],
        timeoutMs,
        signal,
        allowFileProtocol: allowFile,
        recordedAt: nowIso(),
      });
      index += 1;
    }
  }

  private async archiveLfs(
    repo: RepoRecord,
    provider: GitProvider,
    coords: Parameters<GitProvider['metadata']>[0],
    ctx: ProviderContext,
    paths: { gitDir: string; lfs: string },
    maxAssetBytes: number | null,
  ): Promise<void> {
    const endpoint = provider.lfsEndpoint?.(coords);
    const fresh = this.catalog.require(repo.id);
    const ref = fresh.defaultBranch ? `refs/heads/${fresh.defaultBranch}` : 'refs/heads/main';
    const entries = await listTree(paths.gitDir, ref, '').catch(() => []);
    const pointers: { oid: string; size: number; path: string }[] = [];
    for (const entry of entries) {
      if (entry.kind !== 'blob' || entry.sizeBytes === null || entry.sizeBytes > 200) continue;
      const blob = await readBlob(paths.gitDir, ref, entry.path).catch(() => null);
      const pointer = blob?.content ? parseLfsPointer(blob.content) : null;
      if (pointer) pointers.push({ ...pointer, path: entry.path });
    }
    if (!endpoint || pointers.length === 0) return;
    const response = await this.http.request({
      url: `${endpoint}/objects/batch`,
      method: 'POST',
      headers: {
        accept: 'application/vnd.git-lfs+json',
        'content-type': 'application/vnd.git-lfs+json',
        ...(ctx.credential ? { authorization: `Bearer ${ctx.credential.token}` } : {}),
      },
      body: JSON.stringify({ operation: 'download', transfers: ['basic'], objects: pointers.map((pointer) => ({ oid: pointer.oid, size: pointer.size })) }),
      signal: ctx.signal,
      timeoutMs: ctx.timeoutMs,
      policy: ctx.policy,
    });
    if (!isRecordBody(response.body) || !Array.isArray(response.body.objects)) return;
    for (const object of response.body.objects) {
      if (!isRecordBody(object) || typeof object.oid !== 'string') continue;
      const action = isRecordBody(object.actions) && isRecordBody(object.actions.download) ? object.actions.download : null;
      const href = action && typeof action.href === 'string' ? action.href : null;
      if (!href) continue;
      const destination = path.join(paths.lfs, 'objects', object.oid.slice(0, 2), object.oid);
      await this.http.download({ url: href, destination, maxBytes: maxAssetBytes, signal: ctx.signal, timeoutMs: ctx.timeoutMs, policy: ctx.policy });
    }
  }

  private async archiveWiki(
    repo: RepoRecord,
    provider: GitProvider,
    coords: Parameters<GitProvider['metadata']>[0],
    paths: { wikiGit: string },
    settings: { allowFileUrls: boolean; gitTimeoutMs: number },
    signal: AbortSignal,
    credential: { username: string; token: string } | null,
  ): Promise<ComponentState | void> {
    const url = provider.wikiFetchUrl?.(coords);
    if (!url) return 'unsupported';
    try {
      await syncBareRepository({
        gitDir: paths.wikiGit,
        remoteUrl: url,
        namespaces: ['heads', 'tags'],
        timeoutMs: settings.gitTimeoutMs,
        signal,
        allowFileProtocol: settings.allowFileUrls,
        auth: credential ? { username: authUsername(repo.provider), token: credential.token } : undefined,
        recordedAt: nowIso(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : '';
      if (message.includes('not found') || message.includes('does not exist')) return;
      throw error;
    }
  }

  private assertActive(jobId: string, signal: AbortSignal): void {
    if (signal.aborted) throw new JobInterrupted('cancelled');
    const job = this.jobs.find(jobId);
    if (!job) throw new JobInterrupted('cancelled');
    if (job.state === 'paused') throw new JobInterrupted('paused');
    if (job.state === 'cancelled') throw new JobInterrupted('cancelled');
  }
}

function classifyContact(error: unknown): 'not_found' | 'auth_required' | 'unavailable' | null {
  if (!(error instanceof GitCommandError) && !(error instanceof Error)) return 'unavailable';
  const message = error.message.toLowerCase();
  if (message.includes('authentication') || message.includes('401') || message.includes('could not read username')) return 'auth_required';
  if (message.includes('not found') || message.includes('does not exist') || message.includes('repository not found')) return 'not_found';
  if (message.includes('timed out') || message.includes('could not resolve') || message.includes('unable to access')) return 'unavailable';
  return null;
}

function projectPath(repo: RepoRecord): string {
  try {
    const url = new URL(repo.canonicalUrl);
    return url.pathname.replace(/^\/+/, '').replace(/\.git$/, '');
  } catch {
    return repo.displayName;
  }
}

function parseGitmodules(content: string): { path: string; url: string }[] {
  const modules: { path: string; url: string }[] = [];
  let current: { path?: string; url?: string } | null = null;
  for (const line of content.split(/\r?\n/)) {
    const header = /\[submodule\s+"(.+)"\]/.exec(line.trim());
    if (header) {
      if (current?.path && current.url) modules.push({ path: current.path, url: current.url });
      current = { path: header[1] };
      continue;
    }
    const pathMatch = /^\s*path\s*=\s*(.+)$/.exec(line);
    const urlMatch = /^\s*url\s*=\s*(.+)$/.exec(line);
    if (pathMatch && current) current.path = pathMatch[1]?.trim();
    if (urlMatch && current) current.url = urlMatch[1]?.trim();
  }
  if (current?.path && current.url) modules.push({ path: current.path, url: current.url });
  return modules;
}

function parseLfsPointer(content: string): { oid: string; size: number } | null {
  if (!content.startsWith('version https://git-lfs.github.com/spec/v1')) return null;
  const oid = /^oid sha256:([0-9a-f]{64})$/m.exec(content)?.[1];
  const size = Number(/^size (\d+)$/m.exec(content)?.[1]);
  if (!oid || !Number.isFinite(size)) return null;
  return { oid, size };
}

function isRecordBody(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

void writeFile;
void COMPONENT_KEYS;
