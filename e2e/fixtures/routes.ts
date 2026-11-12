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
  'Appearance',
  'Archival profiles',
  'Sync profiles',
  'Credentials',
  { label: 'Access, Git & search', pattern: /Access, Git/i },
  { label: 'Git access credentials', pattern: /Git access credentials/i },
  'Network',
  'Queue',
  'Placement',
  'Categories',
  'Tags',
  'Collections',
] as const;
