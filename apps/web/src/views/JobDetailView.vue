<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api, errorMessage } from '../api/client';
import type { Job } from '../api/types';
import AppDialog from '../components/AppDialog.vue';
import BannerNote from '../components/BannerNote.vue';
import ErrorState from '../components/ErrorState.vue';
import JobActions from '../components/JobActions.vue';
import JobSteps from '../components/JobSteps.vue';
import LoadingState from '../components/LoadingState.vue';
import PageHeader from '../components/PageHeader.vue';
import StatusLabel from '../components/StatusLabel.vue';
import { useInterval } from '../composables/useInterval';
import { useJobActions } from '../composables/useJobActions';
import { formatDate } from '../lib/format';
import { jobTypeLabel } from '../lib/labels';
import { routeId } from '../lib/route';

const route = useRoute();
const job = ref<Job | null>(null);
const loading = ref(true);
const refreshing = ref(false);
const error = ref<string | null>(null);
const id = computed(() => routeId(route.params.id));
let token = 0;

async function load(refresh = false) {
  const mine = ++token;
  if (refresh && job.value) refreshing.value = true;
  else loading.value = true;
  try {
    const next = await api.getJob(id.value);
    if (mine !== token) return;
    job.value = next;
    error.value = null;
  } catch (reason) {
    if (mine !== token) return;
    error.value = errorMessage(reason);
  } finally {
    if (mine === token) {
      loading.value = false;
      refreshing.value = false;
    }
  }
}

const actions = useJobActions(async () => {
  await load(true);
});

function dismissCancel() {
  actions.cancelId.value = null;
}

function confirmCancel() {
  const id = actions.cancelId.value;
  if (id) void actions.run(id, 'cancel');
}

watch(id, () => {
  job.value = null;
  void load(false);
}, { immediate: true });

useInterval(() => {
  if (job.value && (job.value.state === 'queued' || job.value.state === 'running')) void load(true);
}, 2000);
</script>

<template>
  <PageHeader :title="job ? jobTypeLabel(job.type) : 'Job'" lede="Full job record, including steps and byte progress.">
    <template #actions>
      <RouterLink class="button" to="/jobs">All jobs</RouterLink>
      <span v-if="refreshing" class="muted">Refreshing…</span>
      <button type="button" :disabled="loading" @click="load(true)">Refresh</button>
    </template>
  </PageHeader>
  <LoadingState v-if="loading && !job" message="Loading job…" />
  <ErrorState v-else-if="error && !job" :message="error" @retry="load(false)" />
  <div v-else-if="job" class="stack">
    <BannerNote v-if="error" tone="danger">{{ error }}</BannerNote>
    <BannerNote v-if="actions.error.value" tone="danger">{{ actions.error.value }}</BannerNote>
    <section class="panel stack">
      <div class="cluster">
        <StatusLabel :value="job.state" />
        <span class="mono">{{ job.id }}</span>
        <span class="spacer" />
        <JobActions :job="job" :busy="actions.busy.value" @act="actions.request(job.id, $event)" />
      </div>
      <dl class="facts">
        <dt>Repository</dt>
        <dd>
          <RouterLink v-if="job.repositoryId" :to="`/repositories/${job.repositoryId}/overview`">
            {{ job.repositoryName || job.repositoryId }}
          </RouterLink>
          <span v-else>{{ job.repositoryName || '—' }}</span>
        </dd>
        <dt>Priority</dt>
        <dd class="mono">{{ job.priority }}</dd>
        <dt>Attempt</dt>
        <dd class="mono">{{ job.attempt }} / {{ job.maxAttempts }}</dd>
        <dt>Created</dt>
        <dd class="mono">{{ formatDate(job.createdAt) }}</dd>
        <dt>Not before</dt>
        <dd class="mono">{{ formatDate(job.notBefore) }}</dd>
        <dt>Started</dt>
        <dd class="mono">{{ formatDate(job.startedAt) }}</dd>
        <dt>Finished</dt>
        <dd class="mono">{{ formatDate(job.finishedAt) }}</dd>
      </dl>
      <p v-if="job.errorMessage" class="banner danger" role="alert">
        <span v-if="job.errorCategory" class="mono">{{ job.errorCategory }} · </span>{{ job.errorMessage }}
      </p>
    </section>
    <section class="stack">
      <h2>Steps</h2>
      <JobSteps :steps="job.steps" />
    </section>
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
