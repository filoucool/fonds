<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import PageHeader from '../../components/PageHeader.vue';
import AppearancePanel from './AppearancePanel.vue';
import ArchivalProfilesPanel from './ArchivalProfilesPanel.vue';
import CategoriesPanel from './CategoriesPanel.vue';
import CollectionsPanel from './CollectionsPanel.vue';
import CredentialsPanel from './CredentialsPanel.vue';
import NetworkPanel from './NetworkPanel.vue';
import PlacementPanel from './PlacementPanel.vue';
import QueuePanel from './QueuePanel.vue';
import SyncProfilesPanel from './SyncProfilesPanel.vue';
import TagsPanel from './TagsPanel.vue';
import AccessPanel from './AccessPanel.vue';
import DashboardWidgetsPanel from './DashboardWidgetsPanel.vue';
import GitAccessCredentialsPanel from './GitAccessCredentialsPanel.vue';

const navGroups = [
  {
    label: 'Interface',
    items: [
      { id: 'appearance', label: 'Appearance' },
      { id: 'dashboard', label: 'Dashboard' },
    ],
  },
  {
    label: 'Archival',
    items: [
      { id: 'profiles', label: 'Archival profiles' },
      { id: 'sync', label: 'Sync profiles' },
      { id: 'placement', label: 'Placement' },
      { id: 'categories', label: 'Categories' },
      { id: 'tags', label: 'Tags' },
      { id: 'collections', label: 'Collections' },
    ],
  },
  {
    label: 'Access',
    items: [
      { id: 'credentials', label: 'Credentials' },
      { id: 'access', label: 'Access & search' },
      { id: 'git-access', label: 'Git credentials' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { id: 'network', label: 'Network' },
      { id: 'queue', label: 'Queue' },
    ],
  },
] as const;

const route = useRoute();
const hash = ref(route.hash || '#appearance');

watch(
  () => route.hash,
  (value) => {
    hash.value = value || '#appearance';
  },
);

const activeId = computed(() => hash.value.replace(/^#/, '') || 'appearance');

function onHashChange() {
  hash.value = window.location.hash || '#appearance';
}

function navActive(id: string): boolean {
  return activeId.value === id;
}

onMounted(() => {
  window.addEventListener('hashchange', onHashChange);
});

onUnmounted(() => {
  window.removeEventListener('hashchange', onHashChange);
});
</script>

<template>
  <PageHeader
    title="Settings"
    lede="Archive policy, access, and system behavior. Pick a section from the list."
  />

  <div class="settings-layout">
    <aside class="settings-sidebar">
      <nav class="settings-nav" aria-label="Settings sections">
        <div v-for="group in navGroups" :key="group.label" class="settings-nav-group">
          <p class="settings-nav-group-label">{{ group.label }}</p>
          <div class="settings-nav-group-items">
            <a
              v-for="item in group.items"
              :key="item.id"
              :href="`#${item.id}`"
              :class="{ active: navActive(item.id) }"
            >
              {{ item.label }}
            </a>
          </div>
        </div>
        <div class="settings-nav-group">
          <p class="settings-nav-group-label">Tools</p>
          <div class="settings-nav-group-items">
            <RouterLink to="/inventory">Inventory</RouterLink>
          </div>
        </div>
      </nav>
    </aside>

    <div class="settings-content">
      <AppearancePanel v-if="navActive('appearance')" />
      <DashboardWidgetsPanel v-else-if="navActive('dashboard')" />
      <ArchivalProfilesPanel v-else-if="navActive('profiles')" />
      <SyncProfilesPanel v-else-if="navActive('sync')" />
      <CredentialsPanel v-else-if="navActive('credentials')" />
      <AccessPanel v-else-if="navActive('access')" />
      <GitAccessCredentialsPanel v-else-if="navActive('git-access')" />
      <NetworkPanel v-else-if="navActive('network')" />
      <QueuePanel v-else-if="navActive('queue')" />
      <PlacementPanel v-else-if="navActive('placement')" />
      <CategoriesPanel v-else-if="navActive('categories')" />
      <TagsPanel v-else-if="navActive('tags')" />
      <CollectionsPanel v-else-if="navActive('collections')" />
      <AppearancePanel v-else />
    </div>
  </div>
</template>
