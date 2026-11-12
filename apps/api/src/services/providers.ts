import { COMPONENT_KEYS, isRecord, type ComponentKey, type ProviderKind } from '@fonds/shared';
import type { NetworkPolicy } from '@fonds/shared/policy';
import { RateLimitError } from '../errors';
import { type ArchiveHttp, nextLink } from './http-client';

export interface RepoCoordinates {
  provider: ProviderKind;
  host: string;
  canonicalUrl: string;
  fetchUrl: string;
  projectPath: string;
  name: string;
}

export interface ProviderMetadata {
  providerRepoId: string | null;
  displayName: string;
  description: string;
  defaultBranch: string | null;
  license: string | null;
  sizeBytes: number | null;
  htmlUrl: string | null;
  raw: unknown;
}

export interface ProviderPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface IssueRecord {
  key: string;
  number: number | null;
  title: string;
  body: string;
  state: string;
  author: string;
  url: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  raw: unknown;
}

export interface ReleaseAssetRecord {
  key: string;
  name: string;
  sizeBytes: number | null;
  downloadUrl: string | null;
}

export interface ReleaseRecord {
  key: string;
  tag: string;
  title: string;
  body: string;
  state: string;
  author: string;
  createdAt: string | null;
  url: string | null;
  raw: unknown;
  assets: ReleaseAssetRecord[];
}

export interface ProviderContext {
  http: ArchiveHttp;
  credential: { username: string; token: string } | null;
  signal?: AbortSignal;
  policy: NetworkPolicy;
  timeoutMs: number;
}

export interface GitProvider {
  kind: ProviderKind;
  capabilities(): ReadonlySet<ComponentKey>;
  metadata(coords: RepoCoordinates, ctx: ProviderContext): Promise<ProviderMetadata>;
  releases?(coords: RepoCoordinates, ctx: ProviderContext, cursor: string | null): Promise<ProviderPage<ReleaseRecord>>;
  issues?(coords: RepoCoordinates, ctx: ProviderContext, cursor: string | null): Promise<ProviderPage<IssueRecord>>;
  issueComments?(coords: RepoCoordinates, ctx: ProviderContext, issueNumber: number, cursor: string | null): Promise<ProviderPage<IssueRecord>>;
  pullRequests?(coords: RepoCoordinates, ctx: ProviderContext, cursor: string | null): Promise<ProviderPage<IssueRecord>>;
  pullComments?(coords: RepoCoordinates, ctx: ProviderContext, number: number, cursor: string | null): Promise<ProviderPage<IssueRecord>>;
  discussions?(coords: RepoCoordinates, ctx: ProviderContext, cursor: string | null): Promise<ProviderPage<IssueRecord>>;
  wikiFetchUrl?(coords: RepoCoordinates): string | null;
  lfsEndpoint?(coords: RepoCoordinates): string | null;
}

const GENERIC = new Set<ComponentKey>(['git', 'metadata', 'docs', 'lfs', 'submodules']);
const GITHUB = new Set<ComponentKey>(COMPONENT_KEYS);
const GITLAB = new Set<ComponentKey>(COMPONENT_KEYS.filter((key) => key !== 'discussions'));

export class GenericProvider implements GitProvider {
  readonly kind = 'git' as const;
  capabilities(): ReadonlySet<ComponentKey> {
    return GENERIC;
  }
  metadata(coords: RepoCoordinates): Promise<ProviderMetadata> {
    return Promise.resolve({
      providerRepoId: null,
      displayName: coords.name,
      description: '',
      defaultBranch: null,
      license: null,
      sizeBytes: null,
      htmlUrl: coords.canonicalUrl,
      raw: { source: 'git', url: coords.canonicalUrl },
    });
  }
  wikiFetchUrl(): string | null {
    return null;
  }
  lfsEndpoint(coords: RepoCoordinates): string | null {
    if (coords.fetchUrl.startsWith('/') || coords.fetchUrl.startsWith('file:')) return null;
    const base = coords.fetchUrl.replace(/\.git$/, '');
    return `${base}.git/info/lfs`;
  }
}

export class GithubProvider implements GitProvider {
  readonly kind = 'github' as const;
  capabilities(): ReadonlySet<ComponentKey> {
    return GITHUB;
  }
  async metadata(coords: RepoCoordinates, ctx: ProviderContext): Promise<ProviderMetadata> {
    const body = await this.json(ctx, `https://api.github.com/repos/${coords.projectPath}`);
    if (!isRecord(body)) throw new Error('GitHub metadata was not an object');
    const license = isRecord(body.license) && typeof body.license.spdx_id === 'string' ? body.license.spdx_id : null;
    return {
      providerRepoId: body.id === undefined ? null : String(body.id),
      displayName: typeof body.name === 'string' ? body.name : coords.name,
      description: typeof body.description === 'string' ? body.description : '',
      defaultBranch: typeof body.default_branch === 'string' ? body.default_branch : null,
      license,
      sizeBytes: typeof body.size === 'number' ? body.size * 1024 : null,
      htmlUrl: typeof body.html_url === 'string' ? body.html_url : null,
      raw: body,
    };
  }
  releases(coords: RepoCoordinates, ctx: ProviderContext, cursor: string | null): Promise<ProviderPage<ReleaseRecord>> {
    const url = cursor ?? `https://api.github.com/repos/${coords.projectPath}/releases?per_page=100`;
    return this.page(ctx, url, (value) => (isRecord(value) ? githubRelease(value) : null));
  }
  issues(coords: RepoCoordinates, ctx: ProviderContext, cursor: string | null): Promise<ProviderPage<IssueRecord>> {
    const url = cursor ?? `https://api.github.com/repos/${coords.projectPath}/issues?state=all&per_page=100`;
    return this.page(ctx, url, (value) => (isRecord(value) && !isRecord(value.pull_request) ? githubIssue(value) : null));
  }
  issueComments(coords: RepoCoordinates, ctx: ProviderContext, issueNumber: number, cursor: string | null): Promise<ProviderPage<IssueRecord>> {
    const url = cursor ?? `https://api.github.com/repos/${coords.projectPath}/issues/${issueNumber}/comments?per_page=100`;
    return this.page(ctx, url, (value) => (isRecord(value) ? githubIssue(value) : null));
  }
  pullRequests(coords: RepoCoordinates, ctx: ProviderContext, cursor: string | null): Promise<ProviderPage<IssueRecord>> {
    const url = cursor ?? `https://api.github.com/repos/${coords.projectPath}/pulls?state=all&per_page=100`;
    return this.page(ctx, url, (value) => (isRecord(value) ? githubIssue(value) : null));
  }
  pullComments(coords: RepoCoordinates, ctx: ProviderContext, number: number, cursor: string | null): Promise<ProviderPage<IssueRecord>> {
    const url = cursor ?? `https://api.github.com/repos/${coords.projectPath}/pulls/${number}/comments?per_page=100`;
    return this.page(ctx, url, (value) => (isRecord(value) ? githubIssue(value) : null));
  }
  async discussions(coords: RepoCoordinates, ctx: ProviderContext, cursor: string | null): Promise<ProviderPage<IssueRecord>> {
    if (!ctx.credential) return { items: [], nextCursor: null };
    const [owner, name] = coords.projectPath.split('/');
    const result = await ctx.http.request({
      url: 'https://api.github.com/graphql',
      method: 'POST',
      headers: authHeaders(ctx, true),
      body: JSON.stringify({
        query: `query($owner:String!,$name:String!,$cursor:String){repository(owner:$owner,name:$name){discussions(first:50,after:$cursor){pageInfo{hasNextPage endCursor} nodes{id number title body url createdAt updatedAt author{login}}}}}`,
        variables: { owner, name, cursor },
      }),
      signal: ctx.signal,
      timeoutMs: ctx.timeoutMs,
      policy: ctx.policy,
    });
    if (!isRecord(result.body) || !isRecord(result.body.data) || !isRecord(result.body.data.repository)) {
      return { items: [], nextCursor: null };
    }
    const discussions = result.body.data.repository.discussions;
    if (!isRecord(discussions) || !Array.isArray(discussions.nodes)) return { items: [], nextCursor: null };
    const items = discussions.nodes.filter(isRecord).map(githubIssue).filter((item): item is IssueRecord => item !== null);
    const pageInfo = isRecord(discussions.pageInfo) ? discussions.pageInfo : {};
    const next = pageInfo.hasNextPage === true && typeof pageInfo.endCursor === 'string' ? pageInfo.endCursor : null;
    return { items, nextCursor: next };
  }
  wikiFetchUrl(coords: RepoCoordinates): string | null {
    return `https://${coords.host}/${coords.projectPath}.wiki.git`;
  }
  lfsEndpoint(coords: RepoCoordinates): string | null {
    return `https://${coords.host}/${coords.projectPath}.git/info/lfs`;
  }

  private async json(ctx: ProviderContext, url: string): Promise<unknown> {
    const response = await ctx.http.request({
      url,
      headers: authHeaders(ctx, false),
      signal: ctx.signal,
      timeoutMs: ctx.timeoutMs,
      policy: ctx.policy,
    });
    if (response.status === 404) throw new Error('repository not found');
    if (response.status >= 400) throw new Error(`GitHub request failed with ${response.status}`);
    return response.body;
  }

  private async page<T>(ctx: ProviderContext, url: string, map: (value: unknown) => T | null): Promise<ProviderPage<T>> {
    const response = await ctx.http.request({
      url,
      headers: authHeaders(ctx, false),
      signal: ctx.signal,
      timeoutMs: ctx.timeoutMs,
      policy: ctx.policy,
    });
    if (response.status === 404) return { items: [], nextCursor: null };
    if (response.status >= 400) throw new Error(`GitHub request failed with ${response.status}`);
    const items = Array.isArray(response.body) ? response.body.map(map).filter((item): item is T => item !== null) : [];
    return { items, nextCursor: nextLink(response.headers.get('link')) };
  }
}

export class GitlabProvider implements GitProvider {
  readonly kind = 'gitlab' as const;
  capabilities(): ReadonlySet<ComponentKey> {
    return GITLAB;
  }
  async metadata(coords: RepoCoordinates, ctx: ProviderContext): Promise<ProviderMetadata> {
    const project = encodeURIComponent(coords.projectPath);
    const body = await this.json(ctx, `https://${coords.host}/api/v4/projects/${project}`);
    if (!isRecord(body)) throw new Error('GitLab metadata was not an object');
    return {
      providerRepoId: body.id === undefined ? null : String(body.id),
      displayName: typeof body.name === 'string' ? body.name : coords.name,
      description: typeof body.description === 'string' ? body.description : '',
      defaultBranch: typeof body.default_branch === 'string' ? body.default_branch : null,
      license: null,
      sizeBytes: null,
      htmlUrl: typeof body.web_url === 'string' ? body.web_url : null,
      raw: body,
    };
  }
  async releases(coords: RepoCoordinates, ctx: ProviderContext, cursor: string | null): Promise<ProviderPage<ReleaseRecord>> {
    const project = encodeURIComponent(coords.projectPath);
    const url = cursor ?? `https://${coords.host}/api/v4/projects/${project}/releases?per_page=100`;
    return this.page(ctx, url, (value) => (isRecord(value) ? gitlabRelease(value) : null));
  }
  issues(coords: RepoCoordinates, ctx: ProviderContext, cursor: string | null): Promise<ProviderPage<IssueRecord>> {
    const project = encodeURIComponent(coords.projectPath);
    const url = cursor ?? `https://${coords.host}/api/v4/projects/${project}/issues?scope=all&per_page=100`;
    return this.page(ctx, url, (value) => (isRecord(value) ? gitlabIssue(value) : null));
  }
  issueComments(coords: RepoCoordinates, ctx: ProviderContext, issueNumber: number, cursor: string | null): Promise<ProviderPage<IssueRecord>> {
    const project = encodeURIComponent(coords.projectPath);
    const url = cursor ?? `https://${coords.host}/api/v4/projects/${project}/issues/${issueNumber}/notes?per_page=100`;
    return this.page(ctx, url, (value) => (isRecord(value) ? gitlabIssue(value) : null));
  }
  pullRequests(coords: RepoCoordinates, ctx: ProviderContext, cursor: string | null): Promise<ProviderPage<IssueRecord>> {
    const project = encodeURIComponent(coords.projectPath);
    const url = cursor ?? `https://${coords.host}/api/v4/projects/${project}/merge_requests?scope=all&per_page=100`;
    return this.page(ctx, url, (value) => (isRecord(value) ? gitlabIssue(value) : null));
  }
  pullComments(coords: RepoCoordinates, ctx: ProviderContext, number: number, cursor: string | null): Promise<ProviderPage<IssueRecord>> {
    const project = encodeURIComponent(coords.projectPath);
    const url = cursor ?? `https://${coords.host}/api/v4/projects/${project}/merge_requests/${number}/notes?per_page=100`;
    return this.page(ctx, url, (value) => (isRecord(value) ? gitlabIssue(value) : null));
  }
  wikiFetchUrl(coords: RepoCoordinates): string | null {
    return `https://${coords.host}/${coords.projectPath}.wiki.git`;
  }
  lfsEndpoint(coords: RepoCoordinates): string | null {
    return `https://${coords.host}/${coords.projectPath}.git/info/lfs`;
  }

  private async json(ctx: ProviderContext, url: string): Promise<unknown> {
    const response = await ctx.http.request({
      url,
      headers: gitlabHeaders(ctx),
      signal: ctx.signal,
      timeoutMs: ctx.timeoutMs,
      policy: ctx.policy,
    });
    if (response.status === 404) throw new Error('repository not found');
    if (response.status >= 400) throw new Error(`GitLab request failed with ${response.status}`);
    return response.body;
  }

  private async page<T>(ctx: ProviderContext, url: string, map: (value: unknown) => T | null): Promise<ProviderPage<T>> {
    const response = await ctx.http.request({
      url,
      headers: gitlabHeaders(ctx),
      signal: ctx.signal,
      timeoutMs: ctx.timeoutMs,
      policy: ctx.policy,
    });
    if (response.status === 404) return { items: [], nextCursor: null };
    if (response.status >= 400) throw new Error(`GitLab request failed with ${response.status}`);
    const items = Array.isArray(response.body) ? response.body.map(map).filter((item): item is T => item !== null) : [];
    const nextPage = response.headers.get('x-next-page');
    if (!nextPage) return { items, nextCursor: null };
    const next = new URL(url);
    next.searchParams.set('page', nextPage);
    return { items, nextCursor: next.toString() };
  }
}

export function providerFor(kind: ProviderKind): GitProvider {
  if (kind === 'github') return new GithubProvider();
  if (kind === 'gitlab') return new GitlabProvider();
  return new GenericProvider();
}

export function authUsername(kind: ProviderKind): string {
  if (kind === 'github') return 'x-access-token';
  if (kind === 'gitlab') return 'oauth2';
  return 'git';
}

function authHeaders(ctx: ProviderContext, graphql: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    accept: graphql ? 'application/json' : 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
  };
  if (ctx.credential) headers.authorization = `Bearer ${ctx.credential.token}`;
  return headers;
}

function gitlabHeaders(ctx: ProviderContext): Record<string, string> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (ctx.credential) headers.authorization = `Bearer ${ctx.credential.token}`;
  return headers;
}

function githubIssue(value: Record<string, unknown>): IssueRecord | null {
  const key = value.id ?? value.number;
  if (key === undefined) return null;
  return {
    key: String(key),
    number: typeof value.number === 'number' ? value.number : null,
    title: typeof value.title === 'string' ? value.title : '',
    body: typeof value.body === 'string' ? value.body : '',
    state: typeof value.state === 'string' ? value.state : '',
    author: loginOf(value.user) || loginOf(value.author),
    url: typeof value.html_url === 'string' ? value.html_url : null,
    createdAt: typeof value.created_at === 'string' ? value.created_at : typeof value.createdAt === 'string' ? value.createdAt : null,
    updatedAt: typeof value.updated_at === 'string' ? value.updated_at : typeof value.updatedAt === 'string' ? value.updatedAt : null,
    raw: value,
  };
}

function githubRelease(value: Record<string, unknown>): ReleaseRecord | null {
  if (typeof value.tag_name !== 'string') return null;
  const assets = Array.isArray(value.assets) ? value.assets.filter(isRecord).map(githubAsset).filter((asset): asset is ReleaseAssetRecord => asset !== null) : [];
  return {
    key: String(value.id ?? value.tag_name),
    tag: value.tag_name,
    title: typeof value.name === 'string' ? value.name : value.tag_name,
    body: typeof value.body === 'string' ? value.body : '',
    state: value.draft === true ? 'draft' : value.prerelease === true ? 'prerelease' : 'published',
    author: loginOf(value.author),
    createdAt: typeof value.published_at === 'string' ? value.published_at : null,
    url: typeof value.html_url === 'string' ? value.html_url : null,
    raw: value,
    assets,
  };
}

function githubAsset(value: Record<string, unknown>): ReleaseAssetRecord | null {
  if (typeof value.name !== 'string') return null;
  return {
    key: String(value.id ?? value.name),
    name: value.name,
    sizeBytes: typeof value.size === 'number' ? value.size : null,
    downloadUrl: typeof value.browser_download_url === 'string' ? value.browser_download_url : null,
  };
}

function gitlabIssue(value: Record<string, unknown>): IssueRecord | null {
  const key = value.id ?? value.iid;
  if (key === undefined) return null;
  return {
    key: String(key),
    number: typeof value.iid === 'number' ? value.iid : null,
    title: typeof value.title === 'string' ? value.title : typeof value.body === 'string' ? value.body.slice(0, 80) : '',
    body: typeof value.description === 'string' ? value.description : typeof value.body === 'string' ? value.body : '',
    state: typeof value.state === 'string' ? value.state : '',
    author: loginOf(value.author),
    url: typeof value.web_url === 'string' ? value.web_url : null,
    createdAt: typeof value.created_at === 'string' ? value.created_at : null,
    updatedAt: typeof value.updated_at === 'string' ? value.updated_at : null,
    raw: value,
  };
}

function gitlabRelease(value: Record<string, unknown>): ReleaseRecord | null {
  if (typeof value.tag_name !== 'string') return null;
  const assets = isRecord(value.assets) && Array.isArray(value.assets.links)
    ? value.assets.links.filter(isRecord).map((link) => ({
        key: String(link.id ?? link.name),
        name: typeof link.name === 'string' ? link.name : 'asset',
        sizeBytes: null,
        downloadUrl: typeof link.url === 'string' ? link.url : null,
      }))
    : [];
  return {
    key: value.tag_name,
    tag: value.tag_name,
    title: typeof value.name === 'string' ? value.name : value.tag_name,
    body: typeof value.description === 'string' ? value.description : '',
    state: 'published',
    author: loginOf(value.author),
    createdAt: typeof value.released_at === 'string' ? value.released_at : null,
    url: typeof value._links === 'object' && isRecord(value._links) && typeof value._links.self === 'string' ? value._links.self : null,
    raw: value,
    assets,
  };
}

function loginOf(value: unknown): string {
  if (!isRecord(value)) return '';
  if (typeof value.login === 'string') return value.login;
  if (typeof value.username === 'string') return value.username;
  return '';
}

void RateLimitError;
