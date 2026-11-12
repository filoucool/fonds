/** Top-level SPA routes (mirrors apps/web/src/router.ts). */

export const TOP_LEVEL_ROUTES = [
  { path: '/dashboard', heading: 'Dashboard' },
  { path: '/repositories', heading: 'Repositories' },
  { path: '/search', heading: 'Search' },
  { path: '/import', heading: 'Import' },
  { path: '/jobs', heading: 'Jobs' },
  { path: '/storage', heading: 'Storage' },
  { path: '/settings', heading: 'Settings' },
  { path: '/inventory', heading: 'Inventory' },
  { path: '/preservation', heading: 'Preservation' },
] as const;

export const REPO_TABS = [
  'overview',
  'files',
  'commits',
  'refs',
  'issues',
  'pulls',
  'releases',
  'lfs',
  'discussions',
  'components',
  'events',
  'health',
  'search-index',
  'snapshots',
] as const;

/** Valid UUID shape; unlikely to exist in a fresh E2E data dir. */
export const MISSING_REPO_ID = '00000000-0000-4000-8000-000000000099';

export const SETTINGS_SECTIONS = [
  { hash: 'appearance', heading: 'Appearance' },
  { hash: 'dashboard', heading: 'Dashboard' },
  { hash: 'profiles', heading: 'Archival profiles' },
  { hash: 'sync', heading: 'Sync profiles' },
  { hash: 'credentials', heading: 'Credentials' },
  { hash: 'access', heading: 'Access, Git & search', pattern: /Access, Git/i },
  { hash: 'git-access', heading: 'Git access credentials', pattern: /Git access credentials/i },
  { hash: 'network', heading: 'Network' },
  { hash: 'queue', heading: 'Queue' },
  { hash: 'placement', heading: 'Placement' },
  { hash: 'categories', heading: 'Categories' },
  { hash: 'tags', heading: 'Tags' },
  { hash: 'collections', heading: 'Collections' },
] as const;
