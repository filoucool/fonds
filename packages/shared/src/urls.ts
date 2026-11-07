import type { ProviderKind } from './components';

export interface HostConfig {
  githubHosts: string[];
  gitlabHosts: string[];
}

export interface ParsedRepositoryUrl {
  provider: ProviderKind;
  canonicalUrl: string;
  fetchUrl: string;
  identityKey: string;
  host: string;
  owner: string | null;
  name: string;
  projectPath: string;
  discardedCredentials: boolean;
}

export class UrlRejectedError extends Error {
  readonly category = 'validation';

  constructor(message: string) {
    super(message);
    this.name = 'UrlRejectedError';
  }
}

const DEFAULT_HOSTS: HostConfig = {
  githubHosts: ['github.com'],
  gitlabHosts: ['gitlab.com'],
};

export function parseRepositoryUrl(input: string, hosts: HostConfig = DEFAULT_HOSTS): ParsedRepositoryUrl {
  const trimmed = input.trim();
  if (trimmed.length === 0) throw new UrlRejectedError('repository URL is empty');
  if (/[\u0000-\u001f\u007f]/.test(trimmed) || trimmed.includes(' ')) {
    throw new UrlRejectedError('repository URL contains whitespace or control characters');
  }
  if (trimmed.startsWith('-')) throw new UrlRejectedError('repository URL must not start with a dash');

  const scp = parseScp(trimmed);
  if (scp) return finalize(scp.user, scp.host, null, scp.path, 'ssh', false, hosts, scp.fetchUrl);

  if (trimmed.startsWith('/') || trimmed.startsWith('file:')) {
    return parseFile(trimmed);
  }

  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new UrlRejectedError('repository URL is not valid');
  }
  const protocol = url.protocol.replace(':', '');
  if (!['http', 'https', 'ssh', 'git'].includes(protocol)) {
    throw new UrlRejectedError(`protocol ${protocol} is not allowed`);
  }
  const discardedCredentials = url.username !== '' || url.password !== '';
  url.username = '';
  url.password = '';
  url.hash = '';
  url.search = '';
  const host = normalizeHost(url.hostname);
  if (!host || host === '.' || /^\d+$/.test(host)) throw new UrlRejectedError('repository host is not allowed');
  const port = url.port === '' ? null : url.port;
  const path = cleanPath(url.pathname);
  return finalize('', host, port, path, protocol, discardedCredentials, hosts, null);
}

function parseFile(input: string): ParsedRepositoryUrl {
  const pathname = input.startsWith('file:') ? filePathname(input) : pathFromLocal(input);
  if (!pathname.startsWith('/')) throw new UrlRejectedError('file archives require an absolute path');
  if (pathname.split('/').includes('..')) throw new UrlRejectedError('file path must not contain ..');
  const name = pathname.split('/').filter(Boolean).at(-1) ?? 'repository';
  const stripped = name.endsWith('.git') ? name.slice(0, -4) : name;
  return {
    provider: 'git',
    canonicalUrl: `file://${pathname}`,
    fetchUrl: pathname,
    identityKey: `file:${pathname}`,
    host: 'localhost',
    owner: null,
    name: stripped,
    projectPath: stripped,
    discardedCredentials: false,
  };
}

function filePathname(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new UrlRejectedError('file URL is not valid');
  }
  if (url.protocol !== 'file:') throw new UrlRejectedError('file URL is not valid');
  if (url.hostname !== '' && url.hostname !== 'localhost') {
    throw new UrlRejectedError('file URL host is not allowed');
  }
  return decodeURIComponent(url.pathname);
}

function pathFromLocal(input: string): string {
  if (input.includes('\\')) throw new UrlRejectedError('file path must use slashes');
  return input;
}

function parseScp(input: string): { user: string; host: string; path: string; fetchUrl: string } | null {
  if (input.includes('://')) return null;
  const match = /^([\w.+-]+)@([\w.-]+):(.+)$/.exec(input);
  if (!match) return null;
  const user = match[1];
  const host = match[2];
  const path = match[3];
  if (!user || !host || !path || path.startsWith('/')) return null;
  return { user, host: normalizeHost(host), path: cleanPath(`/${path}`), fetchUrl: input };
}

function finalize(
  user: string,
  host: string,
  port: string | null,
  projectPath: string,
  protocol: string,
  discardedCredentials: boolean,
  hosts: HostConfig,
  scpFetch: string | null,
): ParsedRepositoryUrl {
  const mappedHost = host === 'www.github.com' ? 'github.com' : host;
  const segments = projectPath.split('/').filter(Boolean);
  if (segments.length === 0) throw new UrlRejectedError('repository path is empty');
  if (segments.some((segment) => segment === '.' || segment === '..' || segment.startsWith('-'))) {
    throw new UrlRejectedError('repository path is not allowed');
  }
  const provider = providerFor(mappedHost, hosts);
  const normalizedSegments =
    provider === 'git' ? segments.map(stripGit) : segments.map((segment) => stripGit(segment).toLowerCase());
  if (provider === 'github' && normalizedSegments.length !== 2) {
    throw new UrlRejectedError('GitHub repository URLs must be owner/name');
  }
  if (provider === 'gitlab' && normalizedSegments.length < 2) {
    throw new UrlRejectedError('GitLab repository URLs must include a namespace and project');
  }
  const name = normalizedSegments.at(-1);
  if (!name) throw new UrlRejectedError('repository name is empty');
  const owner = normalizedSegments.length > 1 ? normalizedSegments.slice(0, -1).join('/') : null;
  const path = normalizedSegments.join('/');
  const hostKey = port && !isDefaultPort(protocol, port) ? `${mappedHost}:${port}` : mappedHost;
  const canonicalUrl = `https://${hostKey}/${path}`;
  let fetchUrl = canonicalUrl;
  if (scpFetch) {
    const scpPath = provider === 'git' ? projectPath.replace(/^\//, '') : `${path}.git`;
    fetchUrl = `${user || 'git'}@${mappedHost}:${scpPath}`;
  } else if (protocol === 'ssh') {
    fetchUrl = `ssh://git@${hostKey}/${path}.git`;
  } else if (protocol === 'git') {
    fetchUrl = `git://${hostKey}/${path}`;
  } else if (protocol === 'http') {
    fetchUrl = `http://${hostKey}/${path}`;
  }
  return {
    provider,
    canonicalUrl,
    fetchUrl,
    identityKey: `${hostKey}/${path}`,
    host: hostKey,
    owner,
    name,
    projectPath: path,
    discardedCredentials,
  };
}

function providerFor(host: string, hosts: HostConfig): ProviderKind {
  if (hosts.githubHosts.map((item) => item.toLowerCase()).includes(host)) return 'github';
  if (hosts.gitlabHosts.map((item) => item.toLowerCase()).includes(host)) return 'gitlab';
  return 'git';
}

function cleanPath(pathname: string): string {
  const decoded = safeDecode(pathname);
  if (decoded.includes('\\') || decoded.includes('\0')) throw new UrlRejectedError('repository path is not allowed');
  return decoded.replace(/\/+$/, '');
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new UrlRejectedError('repository URL encoding is invalid');
  }
}

function stripGit(segment: string): string {
  return segment.toLowerCase().endsWith('.git') ? segment.slice(0, -4) : segment;
}

function normalizeHost(host: string): string {
  return host.trim().replace(/\.$/, '').toLowerCase();
}

function isDefaultPort(protocol: string, port: string): boolean {
  return (
    (protocol === 'https' && port === '443') ||
    (protocol === 'http' && port === '80') ||
    (protocol === 'ssh' && port === '22') ||
    (protocol === 'git' && port === '9418')
  );
}

export function assertFetchUrlShape(fetchUrl: string, allowFileProtocol: boolean): void {
  if (fetchUrl.startsWith('-') || /[\u0000-\u001f\u007f]/.test(fetchUrl)) {
    throw new UrlRejectedError('fetch URL is not safe to pass to git');
  }
  if (fetchUrl.startsWith('/') || fetchUrl.startsWith('file:')) {
    if (!allowFileProtocol) throw new UrlRejectedError('file and local paths are disabled');
    if (fetchUrl.split('/').includes('..')) throw new UrlRejectedError('fetch path must not contain ..');
    return;
  }
  const parsed = parseRepositoryUrl(fetchUrl);
  if (parsed.fetchUrl.length === 0) throw new UrlRejectedError('fetch URL is empty');
}
