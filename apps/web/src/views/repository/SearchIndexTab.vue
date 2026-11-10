<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { api, errorMessage } from '../../api/client';
import BannerNote from '../../components/BannerNote.vue';
import { useRepositoryContext } from './context';

const { repo } = useRepositoryContext();
const status = ref<Awaited<ReturnType<typeof api.getSearchIndex>> | null>(null);
const filenames = ref(false);
const sourceText = ref(false);
const error = ref<string | null>(null);
const notice = ref('');
const busy = ref(false);

async function load() {
  if (!repo.value) return;
  status.value = await api.getSearchIndex(repo.value.id);
  filenames.value = status.value.enabled.filenames;
  sourceText.value = status.value.enabled.sourceText;
}

async function save() {
  if (!repo.value) return;
  busy.value = true;
  error.value = null;
  try {
    status.value = await api.patchSearchIndex(repo.value.id, { filenames: filenames.value, sourceText: sourceText.value });
    notice.value = 'Index settings saved.';
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}

async function rebuild() {
  if (!repo.value) return;
  const result = await api.rebuildSearchIndex(repo.value.id);
  notice.value = `Rebuild queued: ${result.jobId}`;
}

async function pause() {
  if (!repo.value) return;
  status.value = await api.pauseSearchIndex(repo.value.id);
}

async function resume() {
  if (!repo.value) return;
  const result = await api.resumeSearchIndex(repo.value.id);
  status.value = result.status;
  notice.value = `Resume queued: ${result.jobId}`;
}

async function remove() {
  if (!repo.value) return;
  await api.deleteSearchIndex(repo.value.id);
  await load();
  notice.value = 'Search index removed.';
}

watch(repo, () => {
  void load().catch((err) => {
    error.value = errorMessage(err);
  });
});

onMounted(() => {
  void load().catch((err) => {
    error.value = errorMessage(err);
  });
});
</script>

<template>
  <section v-if="status" class="panel stack">
    <h2>Search index</h2>
    <p class="muted">Filename and source indexing are opt-in. State: {{ status.state }}</p>
    <BannerNote v-if="error" tone="danger">{{ error }}</BannerNote>
    <BannerNote v-if="notice" tone="ok">{{ notice }}</BannerNote>
    <label class="row">
      <input v-model="filenames" type="checkbox" /> Index file paths
    </label>
    <label class="row">
      <input v-model="sourceText" type="checkbox" /> Index source text (bounded size)
    </label>
    <p class="muted">{{ status.fileCount }} paths · {{ status.sourceTextBytes }} bytes indexed</p>
    <div class="cluster">
      <button type="button" :disabled="busy" @click="save">Save</button>
      <button type="button" @click="rebuild">Rebuild</button>
      <button type="button" @click="pause">Pause</button>
      <button type="button" @click="resume">Resume</button>
      <button type="button" class="danger" @click="remove">Delete index</button>
    </div>
  </section>
</template>
