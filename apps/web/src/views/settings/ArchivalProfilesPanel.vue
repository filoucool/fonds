<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, errorMessage } from '../../api/client';
import type { ArchivalProfile, ArchivalProfileConfig } from '../../api/types';
import AppDialog from '../../components/AppDialog.vue';
import BannerNote from '../../components/BannerNote.vue';
import EmptyState from '../../components/EmptyState.vue';
import ErrorState from '../../components/ErrorState.vue';
import LoadingState from '../../components/LoadingState.vue';
import ProfileConfigFields from '../../components/ProfileConfigFields.vue';
import { blankConfig, isBuiltinProfile, normalizeConfig } from '../../lib/profile';

const profiles = ref<ArchivalProfile[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const notice = ref('');
const editingId = ref<string | null>(null);
const name = ref('');
const description = ref('');
const initial = ref<ArchivalProfileConfig>(blankConfig(true));
const formKey = ref(0);
const fields = ref<{ build: () => ArchivalProfileConfig } | null>(null);
const formLoading = ref(false);
const busy = ref(false);
const pendingDelete = ref<ArchivalProfile | null>(null);
const defaultId = ref('');
const settingsError = ref('');

async function load() {
  loading.value = true;
  error.value = null;
  try {
    profiles.value = await api.listArchivalProfiles();
    try {
      const settings = await api.getSettings();
      defaultId.value = settings.defaultArchivalProfileId ?? '';
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

function apply(profile: ArchivalProfile) {
  editingId.value = profile.id;
  name.value = profile.name;
  description.value = profile.description ?? '';
  initial.value = normalizeConfig(profile.config);
  formKey.value += 1;
}

function startNew() {
  editingId.value = null;
  name.value = '';
  description.value = '';
  initial.value = blankConfig(true);
  formKey.value += 1;
}

async function edit(profile: ArchivalProfile) {
  formLoading.value = true;
  error.value = null;
  try {
    apply(await api.getArchivalProfile(profile.id));
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
  let config: ArchivalProfileConfig;
  try {
    if (!fields.value) throw new Error('Profile form is not ready.');
    config = fields.value.build();
  } catch (reason) {
    error.value = errorMessage(reason);
    return;
  }
  const body = { name: trimmed, description: description.value.trim() || null, config };
  busy.value = true;
  try {
    const saved = editingId.value
      ? await api.updateArchivalProfile(editingId.value, body)
      : await api.createArchivalProfile(body);
    notice.value = editingId.value ? 'Profile saved.' : 'Profile created.';
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
  error.value = null;
  try {
    const id = pendingDelete.value.id;
    await api.deleteArchivalProfile(id);
    if (editingId.value === id) startNew();
    pendingDelete.value = null;
    notice.value = 'Profile deleted.';
    await load();
  } catch (reason) {
    error.value = errorMessage(reason);
  } finally {
    busy.value = false;
  }
}

async function saveDefault() {
  settingsError.value = '';
  notice.value = '';
  busy.value = true;
  try {
    const settings = await api.updateSettings({ defaultArchivalProfileId: defaultId.value || null });
    defaultId.value = settings.defaultArchivalProfileId ?? '';
    notice.value = 'Default archival profile saved.';
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
  <section id="profiles" class="stack">
    <h2>Archival profiles</h2>
    <LoadingState v-if="loading && !profiles.length" message="Loading archival profiles…" />
    <ErrorState v-else-if="error && !profiles.length" :message="error" @retry="load" />
    <div v-else class="stack">
      <BannerNote v-if="error" tone="danger">{{ error }}</BannerNote>
      <BannerNote v-if="notice" tone="ok">{{ notice }}</BannerNote>
      <BannerNote v-if="settingsError" tone="warn">{{ settingsError }}</BannerNote>
      <form class="panel cluster" @submit.prevent="saveDefault">
        <label class="field" style="min-width: 240px">
          <span class="lbl">Default archival profile</span>
          <select v-model="defaultId">
            <option value="">None</option>
            <option v-for="profile in profiles" :key="profile.id" :value="profile.id">{{ profile.name }}</option>
          </select>
        </label>
        <button type="submit" :disabled="busy">Save default</button>
      </form>
      <EmptyState v-if="!profiles.length" title="No archival profiles" detail="Create one to choose which components a new archive keeps." />
      <div v-else class="table-wrap">
        <table class="data">
          <caption class="sr-only">Archival profiles</caption>
          <thead>
            <tr><th>Name</th><th>Description</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="profile in profiles" :key="profile.id">
              <td>
                {{ profile.name }}
                <span v-if="isBuiltinProfile(profile)" class="muted"> · built in</span>
                <div class="mono muted">{{ profile.id }}</div>
              </td>
              <td>{{ profile.description || '—' }}</td>
              <td class="cluster">
                <button type="button" @click="edit(profile)">Edit</button>
                <button
                  v-if="!isBuiltinProfile(profile)"
                  type="button"
                  class="danger"
                  @click="pendingDelete = profile"
                >
                  Delete
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <form class="panel stack" @submit.prevent="save">
        <h3>{{ editingId ? 'Edit profile' : 'New profile' }}</h3>
        <p v-if="formLoading" class="muted">Loading profile…</p>
        <label class="field">
          <span class="lbl">Name</span>
          <input v-model="name" type="text" required />
        </label>
        <label class="field">
          <span class="lbl">Description</span>
          <input v-model="description" type="text" />
        </label>
        <ProfileConfigFields :key="formKey" ref="fields" :initial="initial" />
        <div class="cluster">
          <button type="submit" class="primary" :disabled="busy">{{ editingId ? 'Save profile' : 'Create profile' }}</button>
          <button type="button" @click="startNew">New profile</button>
        </div>
      </form>
    </div>
    <AppDialog
      v-if="pendingDelete"
      title="Delete archival profile"
      confirm-label="Delete"
      danger
      :busy="busy"
      @cancel="pendingDelete = null"
      @confirm="remove"
    >
      <p>Delete {{ pendingDelete.name }}? Built-in profiles stay on the host if it refuses the delete.</p>
    </AppDialog>
  </section>
</template>
