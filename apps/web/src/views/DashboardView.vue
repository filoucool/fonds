<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../api/client';
import type { AttentionItem, Dashboard, DueSync } from '../api/types';
import BannerNote from '../components/BannerNote.vue';
import ByteMeter from '../components/ByteMeter.vue';
import EmptyState from '../components/EmptyState.vue';
import ErrorState from '../components/ErrorState.vue';
import LoadingState from '../components/LoadingState.vue';
import PageHeader from '../components/PageHeader.vue';
import StatusLabel from '../components/StatusLabel.vue';
import { useInterval } from '../composables/useInterval';
import { useResource } from '../composables/useResource';
import { formatClock, formatDate, numberOrZero } from '../lib/format';
import { ARCHIVE_STATUSES, componentLabel } from '../lib/labels';

const { data, error, loading, refreshing, load } = useResource<Dashboard>(() => api.getDashboard());
const refreshedAt = ref<Date | null>(null);

async function refresh(silent = false) {
  await load(silent);
  if (!error.value) refreshedAt.value = new Date();
}

const total = computed(() =>
  ARCHIVE_STATUSES.reduce((sum, key) => sum + numberOrZero(data.value?.countsByStatus?.[key]), 0),
);

const attentionCount = computed(() => {
  const value = data.value?.attentionComponents;
  if (typeof value === 'number') return value;
  if (Array.isArray(value)) return value.length;
  return 0;
});

const attentionItems = computed(() => {
  const value = data.value?.attentionComponents;
  if (!Array.isArray(value)) return [] as AttentionItem[];
  return value.filter((item) => item && typeof item === 'object');
});

function dueRows(items: DueSync[]) {
  return items.map((item) => ({
    id: item.repositoryId || item.id || '',
    name: item.repositoryName || item.displayName || item.name || item.repositoryId || item.id || 'Repository',
    nextRunAt: item.nextRunAt ?? null,
  }));
}

const due = computed(() => dueRows(data.value?.dueSyncs ?? []));

onMounted(() => {
  void refresh(false);
});
useInterval(() => {
  void refresh(true);
}, 10000);
</script>

<template>
  <PageHeader title="Dashboard" lede="Archive status, queue, capacity, and what needs a person.">
    <template #actions>
      <span v-if="refreshedAt" class="mono muted">Updated {{ formatClock(refreshedAt) }}</span>
      <span v-if="refreshing" class="muted">Refreshing…</span>
      <button type="button" :disabled="loading" @click="refresh(true)">Refresh</button>
    </template>
  </PageHeader>

  <LoadingState v-if="loading && !data" message="Loading dashboard…" />
  <ErrorState v-else-if="error && !data" :message="error" @retry="refresh(false)" />
  <div v-else-if="data" class="stack">
    <BannerNote v-if="error" tone="danger">{{ error }}</BannerNote>
    <BannerNote v-if="total === 0" tone="info">
      No repositories archived yet.
      <RouterLink to="/import">Import a repository</RouterLink>
    </BannerNote>

    <section>
      <h2>Archive status</h2>
      <div class="stat-grid">
        <RouterLink
          v-for="status in ARCHIVE_STATUSES"
          :key="status"
          class="stat"
          :to="{
            path: '/repositories',
            query: status === 'deleted' ? { status, includeDeleted: '1' } : { status },
          }"
        >
          <div class="stat-num">{{ numberOrZero(data.countsByStatus[status]) }}</div>
          <StatusLabel :value="status" />
        </RouterLink>
      </div>
    </section>

    <section>
      <h2>Jobs</h2>
      <div class="stat-grid">
        <RouterLink class="stat" :to="{ path: '/jobs', query: { state: 'queued' } }">
          <div class="stat-num">{{ data.jobs.queued }}</div>
          <span class="stat-label">Queued</span>
        </RouterLink>
        <RouterLink class="stat" :to="{ path: '/jobs', query: { state: 'running' } }">
          <div class="stat-num">{{ data.jobs.running }}</div>
          <span class="stat-label">Running</span>
        </RouterLink>
        <RouterLink class="stat" :to="{ path: '/jobs', query: { state: 'failed' } }">
          <div class="stat-num">{{ data.jobs.failed }}</div>
          <span class="stat-label">Failed</span>
        </RouterLink>
        <RouterLink class="stat" :to="{ path: '/jobs', query: { state: 'paused' } }">
          <div class="stat-num">{{ data.jobs.paused }}</div>
          <span class="stat-label">Paused</span>
        </RouterLink>
      </div>
    </section>

    <section class="split">
      <div class="panel stack">
        <h2>Due syncs</h2>
        <EmptyState
          v-if="!due.length"
          title="No syncs due"
          detail="Scheduled repositories show up here when a sync profile is due."
        />
        <div v-else class="table-wrap">
          <table class="data fit">
            <caption class="sr-only">Due syncs</caption>
            <thead>
              <tr>
                <th>Repository</th>
                <th>Next run</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, index) in due" :key="row.id || index">
                <td>
                  <RouterLink v-if="row.id" :to="`/repositories/${row.id}/overview`">{{ row.name }}</RouterLink>
                  <span v-else>{{ row.name }}</span>
                </td>
                <td class="mono">{{ formatDate(row.nextRunAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div class="panel stack">
        <h2>Attention</h2>
        <p class="stat-num">{{ attentionCount }}</p>
        <p class="muted">Components that need review.</p>
        <ul v-if="attentionItems.length" class="plain">
          <li v-for="(item, index) in attentionItems" :key="`${item.repositoryId}-${item.component}-${index}`">
            <RouterLink
              v-if="item.repositoryId"
              :to="`/repositories/${item.repositoryId}/components`"
            >
              {{ item.repositoryName || item.repositoryId }}
            </RouterLink>
            <span v-else>{{ item.repositoryName || 'Repository' }}</span>
            <span class="muted">{{ componentLabel(item.component) }}</span>
            <StatusLabel v-if="item.state" :value="item.state" />
            <span v-if="item.error" class="muted">{{ item.error }}</span>
          </li>
        </ul>
        <p v-else-if="attentionCount === 0" class="muted">No components need attention.</p>
        <p v-else class="muted">The dashboard reported a count without a component list.</p>
      </div>
    </section>

    <section class="stack">
      <h2>Storage</h2>
      <EmptyState
        v-if="!data.storage.pools.length"
        title="No storage pools"
        detail="Add a pool on the Storage page before placing new archives."
      />
      <div v-else class="pool-grid">
        <article v-for="pool in data.storage.pools" :key="pool.id" class="panel stack">
          <header class="cluster">
            <h3 style="margin: 0; color: var(--text)">{{ pool.name }}</h3>
            <span class="mono muted">{{ pool.repositoryCount }} repositories</span>
          </header>
          <ByteMeter :free="pool.freeBytes" :total="pool.totalBytes" :threshold="pool.thresholdBytes" />
          <StatusLabel
            v-if="pool.freeBytes < pool.thresholdBytes"
            value="warning"
            label="Below free-space threshold"
          />
        </article>
      </div>
    </section>

    <section class="stack">
      <h2>Recent events</h2>
      <EmptyState v-if="!data.recentEvents.length" title="No recent events" detail="Sync, verify, and import activity will be listed here." />
      <div v-else class="table-wrap">
        <table class="data">
          <caption class="sr-only">Recent events</caption>
          <thead>
            <tr>
              <th>When</th>
              <th>Repository</th>
              <th>Kind</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="event in data.recentEvents" :key="event.id">
              <td class="mono">{{ formatDate(event.createdAt) }}</td>
              <td>
                <RouterLink v-if="event.repositoryId" :to="`/repositories/${event.repositoryId}/events`">
                  {{ event.repositoryName || event.repositoryId }}
                </RouterLink>
                <span v-else>{{ event.repositoryName || '—' }}</span>
              </td>
              <td><StatusLabel :value="event.kind" /></td>
              <td>{{ event.message }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
