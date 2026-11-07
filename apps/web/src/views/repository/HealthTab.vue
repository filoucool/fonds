<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api, errorMessage } from '../../api/client';
import type { IntegrityRun } from '../../api/types';
import BannerNote from '../../components/BannerNote.vue';
import EmptyState from '../../components/EmptyState.vue';
import ErrorState from '../../components/ErrorState.vue';
import LoadingState from '../../components/LoadingState.vue';
import StatusLabel from '../../components/StatusLabel.vue';
import { useResource } from '../../composables/useResource';
import { formatDate } from '../../lib/format';
import { componentLabel } from '../../lib/labels';
import { routeId } from '../../lib/route';

const route = useRoute();
const id = computed(() => routeId(route.params.id));
const { data, error, loading, load } = useResource<IntegrityRun[]>(() => api.listIntegrity(id.value));
const actionError = ref<string | null>(null);
const jobId = ref('');
const busy = ref(false);

watch(id, () => {
  void load();
}, { immediate: true });

async function verify() {
  actionError.value = null;
  jobId.value = '';
  busy.value = true;
  try {
    const result = await api.verifyRepository(id.value);
    jobId.value = result.jobId;
  } catch (reason) {
    actionError.value = errorMessage(reason);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="stack">
    <div class="cluster">
      <button type="button" :disabled="busy" @click="verify">Verify</button>
      <button type="button" :disabled="loading" @click="load(true)">Refresh</button>
      <RouterLink v-if="jobId" :to="`/jobs/${jobId}`">Job {{ jobId }}</RouterLink>
    </div>
    <BannerNote v-if="actionError" tone="danger">{{ actionError }}</BannerNote>
    <LoadingState v-if="loading && !data" message="Loading integrity runs…" />
    <ErrorState v-else-if="error && !data" :message="error" @retry="load(false)" />
    <EmptyState
      v-else-if="data && !data.length"
      title="No integrity runs"
      detail="Verify the repository to record checks."
    />
    <template v-else-if="data">
      <article v-for="run in data" :key="run.id" class="panel stack">
        <header class="cluster">
          <h2 style="margin: 0">{{ run.verificationType }}</h2>
          <StatusLabel :value="run.status" />
          <StatusLabel v-if="run.results" :value="run.results.ok ? 'ok' : 'failed'" :label="run.results.ok ? 'checks passed' : 'checks failed'" />
        </header>
        <p class="muted">Scope {{ run.scope }} · {{ formatDate(run.startedAt) }} – {{ formatDate(run.finishedAt) }}</p>
        <p class="mono muted">{{ run.id }}</p>
        <p v-if="!run.results" class="muted">No checks recorded for this run.</p>
        <div v-else class="table-wrap">
          <table class="data">
            <caption class="sr-only">Integrity checks</caption>
            <thead>
              <tr><th>Component</th><th>Result</th><th>Detail</th></tr>
            </thead>
            <tbody>
              <tr v-for="check in run.results.checks" :key="check.id">
                <td>{{ componentLabel(check.component) }}</td>
                <td><StatusLabel :value="check.ok ? 'ok' : 'failed'" /></td>
                <td>{{ check.detail || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>
    </template>
  </div>
</template>
