<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { api, errorMessage, isRecord } from '../../api/client';
import BannerNote from '../../components/BannerNote.vue';
import StatusLabel from '../../components/StatusLabel.vue';
import { formatBytes, formatDate } from '../../lib/format';
import { providerLabel } from '../../lib/labels';
import { useRepositoryContext } from './context';

const { repo, reload } = useRepositoryContext();
const displayName = ref('');
const description = ref('');
const error = ref<string | null>(null);
const notice = ref('');
const busy = ref(false);

watch(repo, (value) => {
  displayName.value = value?.displayName ?? '';
  description.value = value?.description ?? '';
}, { immediate: true });

const metadataText = computed(() => {
  const metadata = repo.value?.metadata;
  if (!isRecord(metadata) || Object.keys(metadata).length === 0) return '';
  return JSON.stringify(metadata, null, 2);
});

async function save() {
  if (!repo.value) return;
  error.value = null;
  notice.value = '';
  if (!displayName.value.trim()) {
    error.value = 'Display name is required.';
    return;
  }
  busy.value = true;
  try {
    await api.updateRepository(repo.value.id, {
      displayName: displayName.value.trim(),
      description: description.value.trim() || null,
    });
    notice.value = 'Identity saved.';
    await reload();
  } catch (reason) {
    error.value = errorMessage(reason);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <form v-if="repo" class="panel stack" @submit.prevent="save">
    <h2>Identity</h2>
    <label class="field">
      <span class="lbl">Display name</span>
      <input v-model="displayName" type="text" required />
    </label>
    <label class="field">
      <span class="lbl">Description</span>
      <textarea v-model="description" rows="3" />
    </label>
    <div><button type="submit" :disabled="busy">Save identity</button></div>
    <BannerNote v-if="error" tone="danger">{{ error }}</BannerNote>
    <BannerNote v-if="notice" tone="ok">{{ notice }}</BannerNote>
    <dl class="facts">
      <dt>Canonical URL</dt>
      <dd class="mono break">{{ repo.canonicalUrl }}</dd>
      <dt>Fetch URL</dt>
      <dd class="mono break">{{ repo.fetchUrl }}</dd>
      <dt>Provider</dt>
      <dd>{{ providerLabel(repo.provider) }}</dd>
      <dt>License</dt>
      <dd>{{ repo.license || 'Unknown' }}</dd>
      <dt>Default branch</dt>
      <dd class="mono">{{ repo.defaultBranch || '—' }}</dd>
      <dt>Storage pool</dt>
      <dd>{{ repo.storagePool?.name || 'Unassigned' }}</dd>
      <dt>Relative path</dt>
      <dd class="mono break">{{ repo.relativePath || '—' }}</dd>
      <dt>Size</dt>
      <dd class="mono">{{ formatBytes(repo.sizeBytes) }}</dd>
      <dt>Archive status</dt>
      <dd><StatusLabel :value="repo.archiveStatus" /></dd>
      <dt>Upstream</dt>
      <dd><StatusLabel :value="repo.upstreamStatus" /></dd>
      <dt>Health</dt>
      <dd><StatusLabel :value="repo.health" /></dd>
      <dt>Created</dt>
      <dd class="mono">{{ formatDate(repo.createdAt) }}</dd>
      <dt>Updated</dt>
      <dd class="mono">{{ formatDate(repo.updatedAt) }}</dd>
      <dt>Deleted</dt>
      <dd class="mono">{{ formatDate(repo.deletedAt) }}</dd>
      <dt>Last sync</dt>
      <dd class="mono">{{ formatDate(repo.lastSyncAt) }}</dd>
      <dt>Last success</dt>
      <dd class="mono">{{ formatDate(repo.lastSuccessAt) }}</dd>
    </dl>
    <details v-if="metadataText">
      <summary>Recorded metadata</summary>
      <pre class="code-view">{{ metadataText }}</pre>
    </details>
  </form>
</template>
