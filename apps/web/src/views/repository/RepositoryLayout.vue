<script setup lang="ts">
import { computed, provide, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api, errorMessage } from '../../api/client';
import type { RepositoryDetail } from '../../api/types';
import BannerNote from '../../components/BannerNote.vue';
import ErrorState from '../../components/ErrorState.vue';
import LoadingState from '../../components/LoadingState.vue';
import StatusLabel from '../../components/StatusLabel.vue';
import { formatBytes } from '../../lib/format';
import { routeId } from '../../lib/route';
import { repositoryContextKey } from './context';

const route = useRoute();
const repo = ref<RepositoryDetail | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const id = computed(() => routeId(route.params.id));
let token = 0;

const tabs = [
  ['overview', 'Overview'],
  ['files', 'Files'],
  ['commits', 'Commits'],
  ['refs', 'Refs'],
  ['issues', 'Issues'],
  ['pulls', 'Pulls'],
  ['releases', 'Releases'],
  ['components', 'Components'],
  ['events', 'Events'],
  ['health', 'Health'],
] as const;

async function reload() {
  const mine = ++token;
  const current = id.value;
  if (!repo.value) loading.value = true;
  try {
    const next = await api.getRepository(current);
    if (mine !== token) return;
    repo.value = next;
    error.value = null;
  } catch (reason) {
    if (mine !== token) return;
    error.value = errorMessage(reason);
  } finally {
    if (mine === token) loading.value = false;
  }
}

provide(repositoryContextKey, { repo, loading, error, reload });

watch(id, () => {
  repo.value = null;
  void reload();
}, { immediate: true });

watch([repo, () => route.meta.title], () => {
  const name = repo.value?.displayName;
  const tab = typeof route.meta.title === 'string' ? route.meta.title : 'Repository';
  document.title = name ? `${name} · ${tab} · Archiver` : `${tab} · Archiver`;
});
</script>

<template>
  <LoadingState v-if="loading && !repo" message="Loading repository…" />
  <ErrorState v-else-if="error && !repo" :message="error" @retry="reload" />
  <div v-else-if="repo" class="stack">
    <header class="stack">
      <p class="muted mono">{{ repo.provider }} · {{ formatBytes(repo.sizeBytes) }}</p>
      <div class="cluster">
        <h1>{{ repo.displayName }}</h1>
        <StatusLabel :value="repo.archiveStatus" />
        <StatusLabel :value="repo.health" />
      </div>
      <p v-if="repo.description">{{ repo.description }}</p>
      <p class="mono muted break">{{ repo.canonicalUrl }}</p>
    </header>
    <BannerNote v-if="error" tone="danger">{{ error }}</BannerNote>
    <BannerNote v-if="repo.health === 'corrupt'" tone="danger">
      Integrity status is corrupt. Treat extracted contents as untrustworthy until a verify job passes.
      <RouterLink :to="`/repositories/${repo.id}/health`">Open health</RouterLink>
    </BannerNote>
    <BannerNote v-if="repo.deletedAt" tone="warn">
      This repository was soft-deleted. Restore it to resume sync, or purge it to remove the archive from disk.
    </BannerNote>
    <nav class="tabs" aria-label="Repository">
      <RouterLink
        v-for="[slug, label] in tabs"
        :key="slug"
        :to="`/repositories/${repo.id}/${slug}`"
        :class="{ active: route.path.endsWith('/' + slug) }"
      >
        {{ label }}
      </RouterLink>
    </nav>
    <RouterView />
  </div>
</template>
