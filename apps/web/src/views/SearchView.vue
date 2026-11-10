<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import PageHeader from '../components/PageHeader.vue';
import { api, errorMessage } from '../api/client';

const route = useRoute();
const q = ref('');
const capabilities = ref('metadata,filenames,source_text');
const provider = ref('');
const status = ref('');
const loading = ref(false);
const error = ref<string | null>(null);
const items = ref<{ repositoryId: string; displayName: string; kind: string; path: string | null; snippet: string | null }[]>([]);
const usageBytes = ref(0);

function readRouteQuery() {
  const query = route.query;
  if (typeof query.q === 'string') q.value = query.q;
  if (typeof query.capabilities === 'string') capabilities.value = query.capabilities;
  if (typeof query.provider === 'string') provider.value = query.provider;
  if (typeof query.status === 'string') status.value = query.status;
}

async function runSearch() {
  loading.value = true;
  error.value = null;
  try {
    const filters: Record<string, string | undefined> = {};
    if (provider.value.trim()) filters.provider = provider.value.trim();
    if (status.value.trim()) filters.status = status.value.trim();
    const response = await api.globalSearch(q.value, capabilities.value, filters);
    items.value = response.items;
    usageBytes.value = response.usageBytes;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  readRouteQuery();
  if (q.value.trim() || provider.value.trim() || status.value.trim()) {
    void runSearch();
  }
});

watch(
  () => route.query,
  () => {
    readRouteQuery();
  },
);
</script>

<template>
  <PageHeader title="Search" lede="Metadata search is always on. Filename and source indexing are opt-in per repository." />
  <form class="filters" @submit.prevent="runSearch">
    <label>
      Query
      <input v-model="q" type="search" placeholder="Repository name, path, or source text" />
    </label>
    <label>
      Capabilities
      <input v-model="capabilities" type="text" placeholder="metadata,filenames,source_text" />
    </label>
    <label>
      Provider
      <input v-model="provider" type="text" placeholder="github, gitlab, …" />
    </label>
    <label>
      Sync status
      <input v-model="status" type="text" placeholder="healthy, stale, …" />
    </label>
    <button type="submit" class="primary" :disabled="loading">Search</button>
  </form>
  <p v-if="error" class="error">{{ error }}</p>
  <p v-else class="muted">Index on disk: {{ usageBytes }} bytes</p>
  <ul v-if="items.length" class="list">
    <li v-for="(item, index) in items" :key="`${item.repositoryId}-${index}`">
      <RouterLink :to="`/repositories/${item.repositoryId}/overview`">{{ item.displayName }}</RouterLink>
      <span class="muted"> · {{ item.kind }}</span>
      <span v-if="item.path" class="mono"> · {{ item.path }}</span>
      <p v-if="item.snippet" class="muted snippet">{{ item.snippet }}</p>
    </li>
  </ul>
</template>
