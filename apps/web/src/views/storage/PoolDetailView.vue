<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../api/client';
import BannerNote from '../../components/BannerNote.vue';
import EmptyState from '../../components/EmptyState.vue';
import ErrorState from '../../components/ErrorState.vue';
import LoadingState from '../../components/LoadingState.vue';
import MigrateWizard from '../../components/MigrateWizard.vue';
import PoolCard from '../../components/PoolCard.vue';
import PoolConfigureDialog from '../../components/PoolConfigureDialog.vue';
import PagerBar from '../../components/PagerBar.vue';
import StatusLabel from '../../components/StatusLabel.vue';
import { useCursorPager } from '../../composables/useCursorPager';
import { formatBytes, formatDate } from '../../lib/format';
import { routeId } from '../../lib/route';
import { useStorageContext } from './useStorageContext';

const { ctx, pools, settings, loading: storageLoading } = useStorageContext();

const route = useRoute();
const router = useRouter();
const poolId = computed(() => routeId(route.params.poolId));
const pool = computed(() => pools.value.find((item) => item.id === poolId.value) ?? null);
const configureOpen = ref(false);
const migrateOpen = ref(false);

const { items, loading, error, reset, next, prev, hasPrev, hasNext } = useCursorPager((cursor) =>
  api.listRepositories({ limit: 50, cursor, storagePoolId: poolId.value, sort: 'name' }),
);

watch(
  poolId,
  () => {
    void reset();
  },
  { immediate: true },
);

function openMigrate() {
  migrateOpen.value = true;
}

async function onMigrated(jobId: string) {
  migrateOpen.value = false;
  ctx.setJobId(jobId);
  ctx.setNotice('Migrate job queued.');
  await Promise.all([ctx.reload(), reset()]);
}

async function onConfigured() {
  configureOpen.value = false;
  if (pool.value) ctx.setNotice(`${pool.value.name} saved.`);
  await ctx.reload();
}
</script>

<template>
  <section v-if="!pool && !storageLoading" class="stack">
    <ErrorState message="Storage pool not found." @retry="ctx.reload" />
    <button type="button" @click="router.push('/storage/pools')">Back to pools</button>
  </section>

  <section v-else-if="pool" class="stack">
    <p class="crumbs">
      <RouterLink to="/storage/pools">Pools</RouterLink>
      <span class="sep">/</span>
      <span>{{ pool.name }}</span>
    </p>

    <PoolCard :pool="pool" :is-default="pool.id === settings?.defaultPoolId" />

    <div class="cluster">
      <button type="button" @click="configureOpen = true">Configure</button>
      <button type="button" @click="openMigrate">Migrate repository here…</button>
    </div>

    <section class="stack">
      <h2 style="margin: 0">Repositories on this pool</h2>
      <LoadingState v-if="loading && !items.length" message="Loading repositories…" />
      <ErrorState v-else-if="error && !items.length" :message="error" @retry="reset" />
      <EmptyState
        v-else-if="!items.length"
        title="No repositories"
        detail="Nothing on this pool yet. New archives appear here after placement."
      />
      <div v-else class="table-wrap">
        <table class="data fit">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th class="right">Size</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="repo in items" :key="repo.id">
              <td>
                <RouterLink :to="`/repositories/${repo.id}/overview`">{{ repo.displayName }}</RouterLink>
              </td>
              <td><StatusLabel :value="repo.archiveStatus" /></td>
              <td class="right mono">{{ formatBytes(repo.sizeBytes) }}</td>
              <td class="mono muted">{{ formatDate(repo.updatedAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <PagerBar :has-prev="hasPrev" :has-next="hasNext" @prev="prev" @next="next" />
    </section>

    <BannerNote v-if="pool.freeBytes < pool.freeSpaceThresholdBytes" tone="warn">
      Free space is below the configured reserve.
    </BannerNote>
  </section>

  <PoolConfigureDialog
    v-if="configureOpen && pool"
    :pool="pool"
    @cancel="configureOpen = false"
    @saved="onConfigured"
  />
  <MigrateWizard
    v-if="migrateOpen && pool"
    :pools="pools"
    :initial-destination-id="pool.id"
    @cancel="migrateOpen = false"
    @migrated="onMigrated"
  />
</template>
