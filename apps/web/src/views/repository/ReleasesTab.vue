<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../../api/client';
import type { ReleaseItem } from '../../api/types';
import EmptyState from '../../components/EmptyState.vue';
import ErrorState from '../../components/ErrorState.vue';
import LoadingState from '../../components/LoadingState.vue';
import StatusLabel from '../../components/StatusLabel.vue';
import { useResource } from '../../composables/useResource';
import { formatBytes, formatDate } from '../../lib/format';
import { routeId } from '../../lib/route';

const route = useRoute();
const id = computed(() => routeId(route.params.id));
const { data, error, loading, load } = useResource<ReleaseItem[]>(() => api.listReleases(id.value));

watch(id, () => {
  void load();
}, { immediate: true });

function assetHref(assetId: string): string {
  return api.assetDownloadUrl(id.value, assetId);
}
</script>

<template>
  <div class="stack">
    <LoadingState v-if="loading && !data" message="Loading releases…" />
    <ErrorState v-else-if="error && !data" :message="error" @retry="load(false)" />
    <EmptyState
      v-else-if="data && !data.length"
      title="No releases archived"
      detail="Release records appear here when the releases component has run."
    />
    <template v-else-if="data">
      <article v-for="release in data" :key="release.id" class="panel stack">
        <header class="cluster">
          <h2 style="margin: 0">{{ release.tag }}</h2>
          <StatusLabel :value="release.state" />
          <StatusLabel v-if="release.upstreamMissing" value="deleted" label="removed upstream" />
        </header>
        <p v-if="release.title">{{ release.title }}</p>
        <p class="muted">{{ release.author || 'Unknown author' }} · {{ formatDate(release.createdAt) }}</p>
        <p v-if="release.url"><a :href="release.url" target="_blank" rel="noreferrer">Upstream</a></p>
        <div v-if="release.body" class="prose">{{ release.body }}</div>
        <h3>Assets</h3>
        <p v-if="!release.assets.length" class="muted">No assets.</p>
        <div v-else class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                <th>Name</th>
                <th class="right">Size</th>
                <th>SHA-256</th>
                <th>State</th>
                <th>Error</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="asset in release.assets" :key="asset.id">
                <td>{{ asset.name }}</td>
                <td class="mono right">{{ formatBytes(asset.byteSize) }}</td>
                <td class="mono break" :title="asset.sha256 || ''">{{ asset.sha256 || '—' }}</td>
                <td><StatusLabel :value="asset.state" /></td>
                <td>{{ asset.error || '—' }}</td>
                <td><a :href="assetHref(asset.id)">Download</a></td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>
    </template>
  </div>
</template>
