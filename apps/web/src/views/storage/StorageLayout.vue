<script setup lang="ts">
import { onMounted, provide, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api, errorMessage } from '../../api/client';
import type { Pool, Settings } from '../../api/types';
import BannerNote from '../../components/BannerNote.vue';
import ErrorState from '../../components/ErrorState.vue';
import LoadingState from '../../components/LoadingState.vue';
import PageHeader from '../../components/PageHeader.vue';
import { BALANCING_OFF_NOTE } from '../../lib/copy';
import { storageContextKey } from './context';

const route = useRoute();
const pools = ref<Pool[]>([]);
const settings = ref<Settings | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const actionError = ref<string | null>(null);
const notice = ref('');
const busy = ref(false);
const jobId = ref('');

const tabs = [
  ['overview', 'Overview'],
  ['pools', 'Pools'],
  ['operations', 'Operations'],
  ['maintenance', 'Maintenance'],
] as const;

function tabActive(slug: string): boolean {
  if (slug === 'pools') return route.path.startsWith('/storage/pools');
  return route.path === `/storage/${slug}`;
}

async function reload() {
  loading.value = true;
  error.value = null;
  try {
    const [poolList, settingsResult] = await Promise.all([
      api.listPools(),
      api.getSettings().catch((reason: unknown) => {
        actionError.value = errorMessage(reason);
        return null;
      }),
    ]);
    pools.value = poolList;
    settings.value = settingsResult;
  } catch (reason) {
    error.value = errorMessage(reason);
  } finally {
    loading.value = false;
  }
}

function setNotice(text: string) {
  notice.value = text;
}

function setActionError(text: string | null) {
  actionError.value = text;
}

function setJobId(id: string) {
  jobId.value = id;
}

provide(storageContextKey, {
  pools,
  settings,
  loading,
  error,
  actionError,
  notice,
  busy,
  jobId,
  reload,
  setNotice,
  setActionError,
  setJobId,
});

onMounted(() => {
  void reload();
});
</script>

<template>
  <PageHeader
    title="Storage"
    lede="Capacity, placement, and host operations for archive storage pools."
  >
    <template #actions>
      <button type="button" :disabled="loading" @click="reload">Refresh</button>
    </template>
  </PageHeader>

  <LoadingState v-if="loading && !pools.length && !error" message="Loading storage…" />
  <ErrorState v-else-if="error && !pools.length" :message="error" @retry="reload" />

  <div v-else class="stack">
    <BannerNote v-if="error" tone="danger">{{ error }}</BannerNote>
    <BannerNote v-if="actionError" tone="danger">{{ actionError }}</BannerNote>
    <BannerNote v-if="notice" tone="ok">{{ notice }}</BannerNote>
    <BannerNote v-if="settings && !settings.balancingEnabled" tone="warn">
      Balancing is off. {{ BALANCING_OFF_NOTE }}
      <RouterLink :to="{ path: '/settings', hash: '#placement' }">Edit placement</RouterLink>
    </BannerNote>
    <p v-if="jobId" role="status">
      Job <RouterLink :to="`/jobs/${jobId}`">{{ jobId }}</RouterLink> queued.
    </p>

    <nav class="tabs" aria-label="Storage">
      <RouterLink
        v-for="[slug, label] in tabs"
        :key="slug"
        :to="slug === 'pools' ? '/storage/pools' : `/storage/${slug}`"
        :class="{ active: tabActive(slug) }"
      >
        {{ label }}
      </RouterLink>
    </nav>

    <RouterView />
  </div>
</template>
