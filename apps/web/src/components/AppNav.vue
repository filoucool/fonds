<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api, describeHealth } from '../api/client';
import { formatClock } from '../lib/format';
import { useInterval } from '../composables/useInterval';
import StatusLabel from './StatusLabel.vue';

const route = useRoute();
const now = ref(new Date());
const health = ref<'unknown' | 'up' | 'down'>('unknown');
const healthText = ref('checking');

const items = [
  { to: '/dashboard', label: 'Dashboard', match: (path: string) => path === '/dashboard' },
  { to: '/repositories', label: 'Repositories', match: (path: string) => path.startsWith('/repositories') },
  { to: '/search', label: 'Search', match: (path: string) => path === '/search' },
  { to: '/import', label: 'Import', match: (path: string) => path === '/import' },
  { to: '/jobs', label: 'Jobs', match: (path: string) => path === '/jobs' || path.startsWith('/jobs/') },
  { to: '/storage', label: 'Storage', match: (path: string) => path === '/storage' },
  { to: '/preservation', label: 'Preservation', match: (path: string) => path === '/preservation' },
  {
    to: '/settings',
    label: 'Settings',
    match: (path: string) => path === '/settings' || path === '/inventory',
  },
];

const clock = computed(() => formatClock(now.value));
const healthValue = computed(() => (health.value === 'down' ? 'unavailable' : health.value === 'up' ? 'healthy' : 'unknown'));

async function ping() {
  try {
    const parsed = describeHealth(await api.getHealth());
    health.value = parsed.ok ? 'up' : 'down';
    healthText.value = parsed.text;
  } catch {
    health.value = 'down';
    healthText.value = 'unreachable';
  }
}

onMounted(() => {
  void ping();
});
useInterval(() => {
  now.value = new Date();
}, 1000);
useInterval(() => {
  void ping();
}, 15000);
</script>

<template>
  <aside class="nav">
    <RouterLink to="/dashboard" class="brand">Fonds</RouterLink>
    <p class="brand-sub">repository archive</p>
    <nav class="nav-links" aria-label="Primary">
      <RouterLink
        v-for="item in items"
        :key="item.to"
        :to="item.to"
        class="item"
        :class="{ active: item.match(route.path) }"
        :aria-current="item.match(route.path) ? 'page' : undefined"
      >
        {{ item.label }}
      </RouterLink>
    </nav>
    <div class="nav-foot">
      <span class="mono">{{ clock }}</span>
      <StatusLabel :value="healthValue" :label="`API ${healthText}`" />
    </div>
  </aside>
</template>
