<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, errorMessage } from '../../api/client';
import type { Schedule, SyncProfile } from '../../api/types';
import AppDialog from '../../components/AppDialog.vue';
import BannerNote from '../../components/BannerNote.vue';
import EmptyState from '../../components/EmptyState.vue';
import ErrorState from '../../components/ErrorState.vue';
import LoadingState from '../../components/LoadingState.vue';
import ScheduleFields from '../../components/ScheduleFields.vue';
import { formatSchedule } from '../../lib/format';
import { assertTimezone, isBuiltinProfile } from '../../lib/profile';

const profiles = ref<SyncProfile[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const notice = ref('');
const editingId = ref<string | null>(null);
const name = ref('');
const description = ref('');
const timezone = ref('America/New_York');
const paused = ref(false);
const initial = ref<Schedule>({ kind: 'manual' });
const formKey = ref(0);
const fields = ref<{ build: () => Schedule } | null>(null);
const formLoading = ref(false);
const busy = ref(false);
const pendingDelete = ref<SyncProfile | null>(null);
const defaultId = ref('');
const settingsError = ref('');

async function load() {
  loading.value = true;
  error.value = null;
  try {
    profiles.value = await api.listSyncProfiles();
    try {
      const settings = await api.getSettings();
      defaultId.value = settings.defaultSyncProfileId ?? '';
      settingsError.value = '';
    } catch (reason) {
      settingsError.value = errorMessage(reason);
    }
  } catch (reason) {
    error.value = errorMessage(reason);
  } finally {
    loading.value = false;
  }
}

function apply(profile: SyncProfile) {
  editingId.value = profile.id;
  name.value = profile.name;
  description.value = profile.description ?? '';
  timezone.value = profile.timezone || 'America/New_York';
  paused.value = profile.paused;
  initial.value = profile.schedule;
  formKey.value += 1;
}

function startNew() {
  editingId.value = null;
  name.value = '';
  description.value = '';
  timezone.value = 'America/New_York';
  paused.value = false;
  initial.value = { kind: 'manual' };
  formKey.value += 1;
}

async function edit(profile: SyncProfile) {
  formLoading.value = true;
  error.value = null;
  try {
    apply(await api.getSyncProfile(profile.id));
  } catch (reason) {
    error.value = errorMessage(reason);
    apply(profile);
  } finally {
    formLoading.value = false;
  }
}

async function save() {
  error.value = null;
  notice.value = '';
  const trimmed = name.value.trim();
  if (!trimmed) {
    error.value = 'Name is required.';
    return;
  }
  let schedule: Schedule;
  let zone = '';
  try {
    if (!fields.value) throw new Error('Schedule form is not ready.');
    schedule = fields.value.build();
    zone = assertTimezone(timezone.value);
  } catch (reason) {
    error.value = errorMessage(reason);
    return;
  }
  const body = {
    name: trimmed,
    description: description.value.trim() || null,
    schedule,
    timezone: zone,
    paused: paused.value,
  };
  busy.value = true;
  try {
    const saved = editingId.value
      ? await api.updateSyncProfile(editingId.value, body)
      : await api.createSyncProfile(body);
    notice.value = editingId.value ? 'Sync profile saved.' : 'Sync profile created.';
    await load();
    if (saved?.id) apply(saved);
  } catch (reason) {
    error.value = errorMessage(reason);
  } finally {
    busy.value = false;
  }
}

async function remove() {
  if (!pendingDelete.value) return;
  busy.value = true;
  try {
    const id = pendingDelete.value.id;
    await api.deleteSyncProfile(id);
    if (editingId.value === id) startNew();
    pendingDelete.value = null;
    notice.value = 'Sync profile deleted.';
    await load();
  } catch (reason) {
    error.value = errorMessage(reason);
  } finally {
    busy.value = false;
  }
}

async function saveDefault() {
  settingsError.value = '';
  busy.value = true;
  try {
    const settings = await api.updateSettings({ defaultSyncProfileId: defaultId.value || null });
    defaultId.value = settings.defaultSyncProfileId ?? '';
    notice.value = 'Default sync profile saved.';
  } catch (reason) {
    settingsError.value = errorMessage(reason);
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  void load();
});
</script>

<template>
  <section id="sync" class="stack">
    <h2>Sync profiles</h2>
    <LoadingState v-if="loading && !profiles.length" message="Loading sync profiles…" />
    <ErrorState v-else-if="error && !profiles.length" :message="error" @retry="load" />
    <div v-else class="stack">
      <BannerNote v-if="error" tone="danger">{{ error }}</BannerNote>
      <BannerNote v-if="notice" tone="ok">{{ notice }}</BannerNote>
      <BannerNote v-if="settingsError" tone="warn">{{ settingsError }}</BannerNote>
      <form class="panel cluster" @submit.prevent="saveDefault">
        <label class="field" style="min-width: 240px">
          <span class="lbl">Default sync profile</span>
          <select v-model="defaultId">
            <option value="">None</option>
            <option v-for="profile in profiles" :key="profile.id" :value="profile.id">{{ profile.name }}</option>
          </select>
        </label>
        <button type="submit" :disabled="busy">Save default</button>
      </form>
      <EmptyState v-if="!profiles.length" title="No sync profiles" detail="Create a schedule for repositories that should refresh on their own." />
      <div v-else class="table-wrap">
        <table class="data">
          <thead>
            <tr><th>Name</th><th>Schedule</th><th>Timezone</th><th>Paused</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="profile in profiles" :key="profile.id">
              <td>
                {{ profile.name }}
                <span v-if="isBuiltinProfile(profile)" class="muted"> · built in</span>
                <div class="mono muted">{{ profile.id }}</div>
              </td>
              <td>{{ formatSchedule(profile.schedule) }}</td>
              <td class="mono">{{ profile.timezone }}</td>
              <td>{{ profile.paused ? 'Yes' : 'No' }}</td>
              <td class="cluster">
                <button type="button" @click="edit(profile)">Edit</button>
                <button v-if="!isBuiltinProfile(profile)" type="button" class="danger" @click="pendingDelete = profile">
                  Delete
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <form class="panel stack" @submit.prevent="save">
        <h3>{{ editingId ? 'Edit sync profile' : 'New sync profile' }}</h3>
        <p v-if="formLoading" class="muted">Loading profile…</p>
        <label class="field">
          <span class="lbl">Name</span>
          <input v-model="name" type="text" required />
        </label>
        <label class="field">
          <span class="lbl">Description</span>
          <input v-model="description" type="text" />
        </label>
        <label class="field">
          <span class="lbl">Timezone</span>
          <input v-model="timezone" type="text" />
        </label>
        <label class="choice">
          <input v-model="paused" type="checkbox" />
          <span>Paused</span>
        </label>
        <ScheduleFields :key="formKey" ref="fields" :initial="initial" />
        <div class="cluster">
          <button type="submit" class="primary" :disabled="busy">{{ editingId ? 'Save sync profile' : 'Create sync profile' }}</button>
          <button type="button" @click="startNew">New sync profile</button>
        </div>
      </form>
    </div>
    <AppDialog
      v-if="pendingDelete"
      title="Delete sync profile"
      confirm-label="Delete"
      danger
      :busy="busy"
      @cancel="pendingDelete = null"
      @confirm="remove"
    >
      <p>Delete {{ pendingDelete.name }}? Repositories using it keep their last schedule until you assign another.</p>
    </AppDialog>
  </section>
</template>
