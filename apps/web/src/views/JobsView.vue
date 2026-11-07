<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api/client';
import type { JobState } from '../api/types';
import AppDialog from '../components/AppDialog.vue';
import BannerNote from '../components/BannerNote.vue';
import EmptyState from '../components/EmptyState.vue';
import ErrorState from '../components/ErrorState.vue';
import JobActions from '../components/JobActions.vue';
import JobSteps from '../components/JobSteps.vue';
import LoadingState from '../components/LoadingState.vue';
import PageHeader from '../components/PageHeader.vue';
import PagerBar from '../components/PagerBar.vue';
import StatusLabel from '../components/StatusLabel.vue';
import { useCursorPager } from '../composables/useCursorPager';
import { useInterval } from '../composables/useInterval';
import { useJobActions } from '../composables/useJobActions';
import { formatDate } from '../lib/format';
import { isJobState, JOB_STATES, jobTypeLabel } from '../lib/labels';
import { queryString } from '../lib/route';

const route = useRoute();
const router = useRouter();
const state = computed(() => {
  const raw = queryString(route.query, 'state');
  return isJobState(raw) ? raw : '';
});

const { items, loading, refreshing, error, load, reset, next, prev, hasPrev, hasNext } = useCursorPager(
  (cursor) => api.listJobs({ state: state.value || undefined, cursor, limit: 40 }),
);

const actions = useJobActions(async () => {
  await load();
});

function setState(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  void router.replace({ query: value ? { state: value } : {} });
}

watch(state, () => {
  void reset();
}, { immediate: true });

useInterval(() => {
  const active = items.value.some((job) => job.state === 'queued' || job.state === 'running');
  if (active) void load();
}, 2000);

function stateLabel(value: JobState | ''): string {
  return value || 'all';
}

function dismissCancel() {
  actions.cancelId.value = null;
}

function confirmCancel() {
  const id = actions.cancelId.value;
  if (id) void actions.run(id, 'cancel');
}
</script>

<template>
  <PageHeader title="Jobs" lede="Queue for sync, verify, export, import, migrate, and catalog rebuild.">
    <template #actions>
      <span v-if="refreshing" class="muted">Refreshing…</span>
      <button type="button" :disabled="loading" @click="load()">Refresh</button>
    </template>
  </PageHeader>
  <div class="stack">
    <label class="field" style="max-width: 240px">
      <span class="lbl">State</span>
      <select :value="state" @change="setState">
        <option value="">All states</option>
        <option v-for="item in JOB_STATES" :key="item" :value="item">{{ item }}</option>
      </select>
    </label>
    <BannerNote v-if="actions.error.value" tone="danger">{{ actions.error.value }}</BannerNote>
    <LoadingState v-if="loading && !items.length" message="Loading jobs…" />
    <ErrorState v-else-if="error && !items.length" :message="error" @retry="reset" />
    <EmptyState
      v-else-if="!items.length"
      :title="`No ${stateLabel(state)} jobs`"
      detail="Jobs appear when you sync, verify, export, import, or rebuild."
    />
    <template v-else>
      <BannerNote v-if="error" tone="danger">{{ error }}</BannerNote>
      <div class="table-wrap">
        <table class="data">
          <caption class="sr-only">Jobs</caption>
          <thead>
            <tr>
              <th>Job</th>
              <th>Type</th>
              <th>State</th>
              <th>Repository</th>
              <th>Attempt</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody v-for="job in items" :key="job.id">
            <tr>
              <td class="mono">
                <RouterLink :to="`/jobs/${job.id}`">{{ job.id }}</RouterLink>
              </td>
              <td>{{ jobTypeLabel(job.type) }}</td>
              <td><StatusLabel :value="job.state" /></td>
              <td>
                <RouterLink v-if="job.repositoryId" :to="`/repositories/${job.repositoryId}/overview`">
                  {{ job.repositoryName || job.repositoryId }}
                </RouterLink>
                <span v-else>{{ job.repositoryName || '—' }}</span>
              </td>
              <td class="mono">{{ job.attempt }}/{{ job.maxAttempts }}</td>
              <td class="mono">{{ formatDate(job.createdAt) }}</td>
              <td>
                <JobActions :job="job" :busy="actions.busy.value" @act="actions.request(job.id, $event)" />
              </td>
            </tr>
            <tr>
              <td colspan="7">
                <p v-if="job.errorMessage" class="banner danger" role="alert">
                  <span v-if="job.errorCategory" class="mono">{{ job.errorCategory }} · </span>{{ job.errorMessage }}
                </p>
                <JobSteps :steps="job.steps" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <PagerBar :has-prev="hasPrev" :has-next="hasNext" :loading="loading || refreshing" @prev="prev" @next="next" />
    </template>
  </div>
  <AppDialog
    v-if="actions.cancelId.value"
    title="Cancel job"
    confirm-label="Cancel job"
    danger
    :busy="actions.busy.value"
    @cancel="dismissCancel"
    @confirm="confirmCancel"
  >
    <p>Cancel this job? A running sync stops when the worker reaches a safe point.</p>
  </AppDialog>
</template>
