import { createRouter, createWebHistory } from 'vue-router';
import DashboardView from './views/DashboardView.vue';
import RepositoriesView from './views/RepositoriesView.vue';
import ImportView from './views/ImportView.vue';
import JobsView from './views/JobsView.vue';
import JobDetailView from './views/JobDetailView.vue';
import StorageLayout from './views/storage/StorageLayout.vue';
import StorageOverviewTab from './views/storage/StorageOverviewTab.vue';
import StoragePoolsTab from './views/storage/StoragePoolsTab.vue';
import PoolDetailView from './views/storage/PoolDetailView.vue';
import StorageOperationsTab from './views/storage/StorageOperationsTab.vue';
import StorageMaintenanceTab from './views/storage/StorageMaintenanceTab.vue';
import SettingsView from './views/settings/SettingsView.vue';
import InventoryView from './views/InventoryView.vue';
import PreservationView from './views/PreservationView.vue';
import SnapshotsTab from './views/repository/SnapshotsTab.vue';
import SearchView from './views/SearchView.vue';
import NotFoundView from './views/NotFoundView.vue';
import RepositoryLayout from './views/repository/RepositoryLayout.vue';
import OverviewTab from './views/repository/OverviewTab.vue';
import FilesTab from './views/repository/FilesTab.vue';
import CommitsTab from './views/repository/CommitsTab.vue';
import RefsTab from './views/repository/RefsTab.vue';
import DiscussionPane from './views/repository/DiscussionPane.vue';
import LfsTab from './views/repository/LfsTab.vue';
import ReleasesTab from './views/repository/ReleasesTab.vue';
import ComponentsTab from './views/repository/ComponentsTab.vue';
import EventsTab from './views/repository/EventsTab.vue';
import HealthTab from './views/repository/HealthTab.vue';
import SearchIndexTab from './views/repository/SearchIndexTab.vue';
import LoginView from './views/LoginView.vue';
import { api } from './api/client';

function paramId(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] ?? '');
  return typeof value === 'string' ? value : '';
}

const router = createRouter({
  history: createWebHistory(),
  scrollBehavior(to, from, saved) {
    if (saved) return saved;
    if (to.hash) return { el: to.hash, top: 12 };
    if (to.path !== from.path) return { top: 0 };
    return {};
  },
  routes: [
    { path: '/', redirect: '/dashboard' },
    { path: '/dashboard', name: 'dashboard', component: DashboardView, meta: { title: 'Dashboard' } },
    {
      path: '/repositories',
      name: 'repositories',
      component: RepositoriesView,
      meta: { title: 'Repositories' },
    },
    {
      path: '/repositories/:id',
      component: RepositoryLayout,
      children: [
        {
          path: '',
          redirect: (to) => `/repositories/${paramId(to.params.id)}/overview`,
        },
        { path: 'overview', name: 'repo-overview', component: OverviewTab, meta: { title: 'Overview' } },
        { path: 'files', component: FilesTab, meta: { title: 'Files' } },
        { path: 'commits', component: CommitsTab, meta: { title: 'Commits' } },
        { path: 'refs', component: RefsTab, meta: { title: 'Refs' } },
        {
          path: 'issues',
          component: DiscussionPane,
          props: { kind: 'issues' },
          meta: { title: 'Issues' },
        },
        {
          path: 'pulls',
          component: DiscussionPane,
          props: { kind: 'pulls' },
          meta: { title: 'Pulls' },
        },
        { path: 'releases', component: ReleasesTab, meta: { title: 'Releases' } },
        { path: 'lfs', component: LfsTab, meta: { title: 'LFS' } },
        {
          path: 'discussions',
          component: DiscussionPane,
          props: { kind: 'discussions' },
          meta: { title: 'Discussions' },
        },
        { path: 'components', component: ComponentsTab, meta: { title: 'Components' } },
        { path: 'events', component: EventsTab, meta: { title: 'Events' } },
        { path: 'health', component: HealthTab, meta: { title: 'Health' } },
        { path: 'search-index', component: SearchIndexTab, meta: { title: 'Search index' } },
        { path: 'snapshots', component: SnapshotsTab, meta: { title: 'Snapshots' } },
      ],
    },
    { path: '/login', name: 'login', component: LoginView, meta: { title: 'Sign in', public: true } },
    { path: '/search', name: 'search', component: SearchView, meta: { title: 'Search' } },
    { path: '/import', name: 'import', component: ImportView, meta: { title: 'Import' } },
    { path: '/jobs', name: 'jobs', component: JobsView, meta: { title: 'Jobs' } },
    { path: '/jobs/:id', name: 'job', component: JobDetailView, meta: { title: 'Job' } },
    {
      path: '/storage',
      component: StorageLayout,
      meta: { title: 'Storage' },
      children: [
        { path: '', redirect: '/storage/overview' },
        { path: 'overview', name: 'storage-overview', component: StorageOverviewTab, meta: { title: 'Storage' } },
        { path: 'pools', name: 'storage-pools', component: StoragePoolsTab, meta: { title: 'Storage' } },
        { path: 'pools/:poolId', name: 'storage-pool', component: PoolDetailView, meta: { title: 'Pool' } },
        { path: 'operations', name: 'storage-operations', component: StorageOperationsTab, meta: { title: 'Storage' } },
        { path: 'maintenance', name: 'storage-maintenance', component: StorageMaintenanceTab, meta: { title: 'Storage' } },
      ],
    },
    { path: '/settings', name: 'settings', component: SettingsView, meta: { title: 'Settings' } },
    { path: '/inventory', name: 'inventory', component: InventoryView, meta: { title: 'Inventory' } },
    { path: '/preservation', name: 'preservation', component: PreservationView, meta: { title: 'Preservation' } },
    { path: '/:pathMatch(.*)*', name: 'not-found', component: NotFoundView, meta: { title: 'Not found' } },
  ],
});

router.beforeEach(async (to) => {
  if (to.meta.public === true) return true;
  try {
    const session = await api.getAuthSession();
    if (session.mode !== 'trusted' && !session.authenticated) {
      return { path: '/login', query: { redirect: to.fullPath } };
    }
  } catch {
    return true;
  }
  return true;
});

router.afterEach((to) => {
  const title = typeof to.meta.title === 'string' ? to.meta.title : '';
  document.title = title ? `${title} · Fonds` : 'Fonds';
});

export default router;
