<script setup lang="ts">
import { ref, watch } from 'vue';
import { api, errorMessage } from '../../api/client';
import type { ExportFormat, ExportRecord } from '../../api/types';
import AppDialog from '../../components/AppDialog.vue';
import BannerNote from '../../components/BannerNote.vue';
import ExportDialog from '../../components/ExportDialog.vue';
import StatusLabel from '../../components/StatusLabel.vue';
import { useInterval } from '../../composables/useInterval';
import { PURGE_NOTE, REFS_SURVIVE_NOTE, SOFT_DELETE_NOTE } from '../../lib/copy';
import { formatBytes, formatDate } from '../../lib/format';
import BindingEditor from './BindingEditor.vue';
import ClassificationEditor from './ClassificationEditor.vue';
import { useRepositoryContext } from './context';
import IdentityEditor from './IdentityEditor.vue';
import OverridesEditor from './OverridesEditor.vue';

const { repo, reload } = useRepositoryContext();
const error = ref<string | null>(null);
const notice = ref('');
const busy = ref(false);
const exportOpen = ref(false);
const deleteOpen = ref(false);
const purgeOpen = ref(false);
const jobId = ref('');
const exportRecord = ref<ExportRecord | null>(null);
const lookupId = ref('');

async function run(action: 'sync' | 'verify') {
  if (!repo.value) return;
  error.value = null;
  notice.value = '';
  busy.value = true;
  try {
    const result = action === 'sync' ? await api.syncRepository(repo.value.id) : await api.verifyRepository(repo.value.id);
    jobId.value = result.jobId;
    notice.value = action === 'sync' ? 'Sync queued.' : 'Verify queued.';
  } catch (reason) {
    error.value = errorMessage(reason);
  } finally {
    busy.value = false;
  }
}

async function startExport(format: ExportFormat) {
  if (!repo.value) return;
  error.value = null;
  busy.value = true;
  try {
    const result = await api.exportRepository(repo.value.id, format);
    jobId.value = result.jobId;
    exportOpen.value = false;
    notice.value = 'Export queued.';
    exportRecord.value = await api.getExport(result.exportId);
  } catch (reason) {
    error.value = errorMessage(reason);
  } finally {
    busy.value = false;
  }
}

async function refreshExport() {
  if (!exportRecord.value) return;
  try {
    exportRecord.value = await api.getExport(exportRecord.value.id);
  } catch (reason) {
    error.value = errorMessage(reason);
  }
}

async function lookupExport() {
  if (!lookupId.value.trim()) return;
  error.value = null;
  try {
    exportRecord.value = await api.getExport(lookupId.value.trim());
  } catch (reason) {
    error.value = errorMessage(reason);
  }
}

async function softDelete() {
  if (!repo.value) return;
  busy.value = true;
  error.value = null;
  try {
    await api.deleteRepository(repo.value.id);
    deleteOpen.value = false;
    notice.value = 'Repository soft-deleted.';
    await reload();
  } catch (reason) {
    error.value = errorMessage(reason);
  } finally {
    busy.value = false;
  }
}

async function restore() {
  if (!repo.value) return;
  busy.value = true;
  error.value = null;
  try {
    await api.restoreRepository(repo.value.id);
    notice.value = 'Repository restored.';
    await reload();
  } catch (reason) {
    error.value = errorMessage(reason);
  } finally {
    busy.value = false;
  }
}

async function purge() {
  if (!repo.value) return;
  busy.value = true;
  error.value = null;
  try {
    await api.purgeRepository(repo.value.id, repo.value.displayName);
    purgeOpen.value = false;
    notice.value = 'Repository purged.';
    await reload();
  } catch (reason) {
    error.value = errorMessage(reason);
  } finally {
    busy.value = false;
  }
}

watch(exportRecord, (record) => {
  if (record) lookupId.value = record.id;
});

useInterval(() => {
  const status = exportRecord.value?.status;
  if (status && ['queued', 'running', 'pending'].includes(status)) void refreshExport();
}, 2000);
</script>

<template>
  <div v-if="repo" class="stack">
    <div class="cluster">
      <button v-if="!repo.deletedAt" type="button" :disabled="busy" @click="run('sync')">Synchronize</button>
      <button type="button" :disabled="busy" @click="run('verify')">Verify</button>
      <button type="button" :disabled="busy" @click="exportOpen = true">Export</button>
      <span class="spacer" />
      <button v-if="repo.deletedAt" type="button" :disabled="busy" @click="restore">Restore</button>
      <button v-else type="button" class="danger" :disabled="busy" @click="deleteOpen = true">Soft delete</button>
      <button type="button" class="danger" :disabled="busy" @click="purgeOpen = true">Purge</button>
    </div>
    <BannerNote v-if="error" tone="danger">{{ error }}</BannerNote>
    <BannerNote v-if="notice" tone="ok">
      {{ notice }}
      <RouterLink v-if="jobId" :to="`/jobs/${jobId}`">Job {{ jobId }}</RouterLink>
    </BannerNote>
    <section v-if="exportRecord" class="panel stack">
      <h2>Export {{ exportRecord.id }}</h2>
      <p>
        <StatusLabel :value="exportRecord.status" />
        {{ exportRecord.format }} · {{ formatBytes(exportRecord.byteSize) }}
      </p>
      <p class="mono muted">Created {{ formatDate(exportRecord.createdAt) }} · Finished {{ formatDate(exportRecord.finishedAt) }}</p>
      <p v-if="exportRecord.error">{{ exportRecord.error }}</p>
      <div class="cluster">
        <a :href="api.exportDownloadUrl(exportRecord.id)">Download</a>
        <button type="button" @click="refreshExport">Refresh status</button>
      </div>
    </section>
    <form class="cluster" @submit.prevent="lookupExport">
      <label class="field" style="min-width: 240px">
        <span class="lbl">Export id</span>
        <input v-model="lookupId" type="text" class="mono" />
      </label>
      <button type="submit">Look up export</button>
    </form>
    <BannerNote tone="info">{{ REFS_SURVIVE_NOTE }}</BannerNote>
    <div class="overview-grid">
      <div class="stack">
        <IdentityEditor />
        <ClassificationEditor />
      </div>
      <div class="stack">
        <BindingEditor />
        <OverridesEditor />
      </div>
    </div>
    <ExportDialog v-if="exportOpen" :busy="busy" @cancel="exportOpen = false" @confirm="startExport" />
    <AppDialog
      v-if="deleteOpen"
      title="Soft delete repository"
      confirm-label="Soft delete"
      danger
      :busy="busy"
      @cancel="deleteOpen = false"
      @confirm="softDelete"
    >
      <p>{{ SOFT_DELETE_NOTE }}</p>
    </AppDialog>
    <AppDialog
      v-if="purgeOpen"
      title="Purge repository"
      confirm-label="Purge"
      danger
      :busy="busy"
      :match="repo.displayName"
      @cancel="purgeOpen = false"
      @confirm="purge"
    >
      <p>{{ PURGE_NOTE }}</p>
    </AppDialog>
  </div>
</template>
