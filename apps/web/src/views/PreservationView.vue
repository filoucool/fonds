<script setup lang="ts">
import { ref, onMounted } from 'vue';
import PageHeader from '../components/PageHeader.vue';
import LoadingState from '../components/LoadingState.vue';
import BannerNote from '../components/BannerNote.vue';
import { api } from '../api/client';
import type { BackupRunSummary, Phase3Settings, SelfPreservationReport } from '../api/types';

const loading = ref(true);
const error = ref<string | null>(null);
const settings = ref<Phase3Settings | null>(null);
const backups = ref<BackupRunSummary[]>([]);
const report = ref<SelfPreservationReport | null>(null);
const busy = ref(false);
const localBackupPath = ref('/var/backups/archiver');

async function load() {
  loading.value = true;
  error.value = null;
  try {
    settings.value = await api.getPhase3Settings();
    backups.value = (await api.listBackups()).items;
    report.value = await api.getSelfPreservationReport();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'failed to load preservation settings';
  } finally {
    loading.value = false;
  }
}

async function runLocalBackup() {
  busy.value = true;
  error.value = null;
  try {
    await api.runBackup({ type: 'local', path: localBackupPath.value }, 'complete');
    backups.value = (await api.listBackups()).items;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'backup failed to enqueue';
  } finally {
    busy.value = false;
  }
}

async function toggleOnChangeSnapshots() {
  if (!settings.value) return;
  busy.value = true;
  try {
    settings.value = await api.patchPhase3Settings({
      snapshots: { ...settings.value.snapshots, onChange: !settings.value.snapshots.onChange },
    });
  } finally {
    busy.value = false;
  }
}

onMounted(() => void load());
</script>

<template>
  <PageHeader
    title="Preservation"
    lede="Managed backups, historical snapshots, dependency preservation, and self-archiving controls."
  />
  <LoadingState v-if="loading && !settings" message="Loading preservation settings…" />
  <p v-else-if="error" class="error">{{ error }}</p>
  <div v-else class="stack">
    <section>
      <h2>Backups</h2>
      <p class="muted">Local destination path for the next queued backup job.</p>
      <label class="stack-tight">
        <span>Local backup directory</span>
        <input v-model="localBackupPath" type="text" class="mono" />
      </label>
      <button type="button" :disabled="busy" @click="runLocalBackup">Queue local backup</button>
      <ul v-if="backups.length" class="list">
        <li v-for="item in backups.slice(0, 8)" :key="item.id">
          <span class="mono">{{ item.id.slice(0, 8) }}</span>
          — {{ item.state }} — {{ item.profile }} — {{ item.createdAt }}
        </li>
      </ul>
      <p v-else class="muted">No managed backups recorded yet.</p>
    </section>

    <section>
      <h2>Snapshots</h2>
      <p class="muted">Change-triggered snapshots keep prior archive state addressable without duplicating Git objects.</p>
      <button type="button" :disabled="busy || !settings" @click="toggleOnChangeSnapshots">
        {{ settings?.snapshots.onChange ? 'Disable' : 'Enable' }} on-change snapshots
      </button>
    </section>

    <section>
      <h2>Self-preservation</h2>
      <BannerNote v-if="report" tone="info">
        Inventory report lists {{ report.enrolled.length }} enrolled and {{ report.missing.length }} missing dependency sources.
      </BannerNote>
      <ul v-if="report?.missing.length" class="list">
        <li v-for="item in report.missing.slice(0, 10)" :key="item.name">{{ item.name }} — {{ item.reason }}</li>
      </ul>
    </section>
  </div>
</template>
