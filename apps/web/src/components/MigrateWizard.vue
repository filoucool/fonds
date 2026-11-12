<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { api, errorMessage } from '../api/client';
import type { Pool, RepositorySummary } from '../api/types';
import BannerNote from './BannerNote.vue';
import FormDialog from './FormDialog.vue';
import { formatBytes } from '../lib/format';
import StatusLabel from './StatusLabel.vue';

const props = defineProps<{
  pools: Pool[];
  initialDestinationId?: string;
  busy?: boolean;
}>();

const emit = defineEmits<{ cancel: []; migrated: [jobId: string] }>();

const step = ref<1 | 2>(1);
const query = ref('');
const searching = ref(false);
const searchError = ref<string | null>(null);
const results = ref<RepositorySummary[]>([]);
const selected = ref<RepositorySummary | null>(null);
const destinationPoolId = ref(props.initialDestinationId ?? '');
const localError = ref<string | null>(null);
const working = ref(false);

const destination = computed(() => props.pools.find((pool) => pool.id === destinationPoolId.value) ?? null);

const samePool = computed(() => {
  if (!selected.value?.storagePool || !destination.value) return false;
  return selected.value.storagePool.id === destination.value.id;
});

watch(
  () => props.initialDestinationId,
  (id) => {
    if (id) destinationPoolId.value = id;
  },
);

async function search() {
  const q = query.value.trim();
  if (q.length < 2) {
    searchError.value = 'Type at least two characters to search.';
    results.value = [];
    return;
  }
  searching.value = true;
  searchError.value = null;
  try {
    const page = await api.listRepositories({ q, limit: 20, sort: 'name' });
    results.value = page.items;
    if (!page.items.length) searchError.value = 'No repositories matched that search.';
  } catch (reason) {
    searchError.value = errorMessage(reason);
    results.value = [];
  } finally {
    searching.value = false;
  }
}

function pick(repo: RepositorySummary) {
  selected.value = repo;
  step.value = 2;
  localError.value = null;
}

function back() {
  step.value = 1;
  localError.value = null;
}

async function confirm() {
  localError.value = null;
  if (!selected.value || !destinationPoolId.value) {
    localError.value = 'Pick a repository and destination pool.';
    return;
  }
  if (samePool.value) {
    localError.value = 'That repository already lives on the destination pool.';
    return;
  }
  working.value = true;
  try {
    const result = await api.migrateRepository(selected.value.id, destinationPoolId.value);
    emit('migrated', result.jobId);
  } catch (reason) {
    localError.value = errorMessage(reason);
  } finally {
    working.value = false;
  }
}

const dialogBusy = computed(() => props.busy === true || searching.value || working.value);
const submitLabel = computed(() => (step.value === 1 ? 'Search' : 'Start migrate job'));

function onSubmit() {
  if (step.value === 1) void search();
  else void confirm();
}
</script>

<template>
  <FormDialog
    title="Migrate repository"
    :submit-label="submitLabel"
    primary
    :busy="dialogBusy"
    @cancel="emit('cancel')"
    @submit="onSubmit"
  >
    <BannerNote v-if="localError" tone="danger">{{ localError }}</BannerNote>
    <BannerNote v-if="searchError && step === 1" tone="warn">{{ searchError }}</BannerNote>

    <template v-if="step === 1">
      <p class="muted">Search by name or URL, then pick the archive to move.</p>
      <div class="cluster">
        <label class="field grow" style="min-width: 220px; flex: 1">
          <span class="lbl">Repository</span>
          <input v-model="query" type="search" autocomplete="off" @keydown.enter.prevent="search" />
        </label>
        <button type="button" :disabled="searching" @click="search">Search</button>
      </div>
      <ul v-if="results.length" class="plain pick-list">
        <li v-for="repo in results" :key="repo.id">
          <button type="button" class="pick-row" @click="pick(repo)">
            <span>{{ repo.displayName }}</span>
            <span class="muted mono">{{ formatBytes(repo.sizeBytes) }}</span>
            <StatusLabel :value="repo.archiveStatus" />
            <span v-if="repo.storagePool" class="muted">on {{ repo.storagePool.name }}</span>
          </button>
        </li>
      </ul>
    </template>

    <template v-else-if="selected">
      <p class="muted">Confirm the move. A migrate job is queued on the host.</p>
      <dl class="facts">
        <dt>Repository</dt>
        <dd>{{ selected.displayName }}</dd>
        <dt>Size</dt>
        <dd>{{ formatBytes(selected.sizeBytes) }}</dd>
        <dt>From</dt>
        <dd>{{ selected.storagePool?.name ?? 'Unknown pool' }}</dd>
        <dt>To</dt>
        <dd>
          <select v-model="destinationPoolId">
            <option v-for="pool in pools" :key="pool.id" :value="pool.id">{{ pool.name }}</option>
          </select>
        </dd>
      </dl>
      <BannerNote v-if="samePool" tone="warn">Source and destination are the same pool.</BannerNote>
      <button type="button" @click="back">Back</button>
    </template>
  </FormDialog>
</template>
