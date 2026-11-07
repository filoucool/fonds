<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api, errorMessage } from '../../api/client';
import type { ArchivalProfile, SyncProfile } from '../../api/types';
import BannerNote from '../../components/BannerNote.vue';
import { formatBytes, formatDate, formatSchedule } from '../../lib/format';
import { COMPONENT_KEYS, componentLabel } from '../../lib/labels';
import { normalizeConfig } from '../../lib/profile';
import { useRepositoryContext } from './context';

const { repo, reload } = useRepositoryContext();
const profiles = ref<ArchivalProfile[]>([]);
const syncProfiles = ref<SyncProfile[]>([]);
const profileId = ref('');
const syncProfileId = ref('');
const error = ref<string | null>(null);
const notice = ref('');
const busy = ref(false);
const loadError = ref<string | null>(null);

watch(repo, (value) => {
  profileId.value = value?.profile?.id ?? '';
  syncProfileId.value = value?.sync?.profileId ?? '';
}, { immediate: true });

const effective = computed(() => normalizeConfig(repo.value?.profile?.effective));

async function saveProfile() {
  if (!repo.value) return;
  await patch({ profileId: profileId.value || null }, 'Archival profile saved.');
}

async function saveSync() {
  if (!repo.value) return;
  await patch({ syncProfileId: syncProfileId.value || null }, 'Sync profile saved.');
}

async function setPaused(event: Event) {
  if (!repo.value) return;
  const paused = (event.target as HTMLInputElement).checked;
  await patch({ syncPaused: paused }, paused ? 'Sync paused.' : 'Sync resumed.');
}

async function patch(
  body: { profileId?: string | null; syncProfileId?: string | null; syncPaused?: boolean },
  success: string,
) {
  if (!repo.value) return;
  error.value = null;
  notice.value = '';
  busy.value = true;
  try {
    await api.updateRepository(repo.value.id, body);
    notice.value = success;
    await reload();
  } catch (reason) {
    error.value = errorMessage(reason);
    await reload();
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  try {
    const [profileList, syncList] = await Promise.all([api.listArchivalProfiles(), api.listSyncProfiles()]);
    profiles.value = profileList;
    syncProfiles.value = syncList;
  } catch (reason) {
    loadError.value = errorMessage(reason);
  }
});
</script>

<template>
  <section v-if="repo" class="panel stack">
    <h2>Profile and sync</h2>
    <BannerNote v-if="loadError" tone="warn">{{ loadError }}</BannerNote>
    <BannerNote v-if="error" tone="danger">{{ error }}</BannerNote>
    <BannerNote v-if="notice" tone="ok">{{ notice }}</BannerNote>
    <label class="field">
      <span class="lbl">Archival profile</span>
      <select v-model="profileId">
        <option value="">None</option>
        <option
          v-if="repo.profile?.id && !profiles.some((item) => item.id === repo?.profile?.id)"
          :value="repo.profile?.id"
        >
          {{ repo.profile.name || repo.profile.id }}
        </option>
        <option v-for="profile in profiles" :key="profile.id" :value="profile.id">{{ profile.name }}</option>
      </select>
    </label>
    <div><button type="button" :disabled="busy" @click="saveProfile">Save archival profile</button></div>
    <div>
      <h3>Effective components</h3>
      <ul class="plain">
        <li v-for="key in COMPONENT_KEYS" :key="key">
          <span>{{ componentLabel(key) }}</span>
          <span class="muted">{{ effective.components[key] ? 'Included' : 'Excluded' }}</span>
        </li>
      </ul>
      <p class="hint">
        Limits:
        repository {{ formatBytes(effective.limits.maxRepositoryBytes) }},
        asset {{ formatBytes(effective.limits.maxAssetBytes) }},
        component {{ formatBytes(effective.limits.maxComponentBytes) }}.
        A dash means that limit is unset.
      </p>
      <p class="hint">
        Exclusions:
        {{ effective.exclusions.length ? effective.exclusions.join(', ') : 'none' }}
      </p>
    </div>
    <label class="field">
      <span class="lbl">Sync profile</span>
      <select v-model="syncProfileId">
        <option value="">None</option>
        <option
          v-if="repo.sync?.profileId && !syncProfiles.some((item) => item.id === repo?.sync?.profileId)"
          :value="repo.sync?.profileId"
        >
          {{ repo.sync.profileName || repo.sync.profileId }}
        </option>
        <option v-for="profile in syncProfiles" :key="profile.id" :value="profile.id">{{ profile.name }}</option>
      </select>
    </label>
    <p class="muted">
      {{ repo.sync?.profileName || 'No sync profile' }} · {{ formatSchedule(repo.sync?.schedule) }}
    </p>
    <p class="mono muted">
      Next {{ formatDate(repo.sync?.nextRunAt) }} · Last {{ formatDate(repo.sync?.lastRunAt) }}
    </p>
    <label class="choice">
      <input type="checkbox" :checked="repo.sync?.paused ?? false" :disabled="busy" @change="setPaused" />
      <span>Pause scheduled sync</span>
    </label>
    <div><button type="button" :disabled="busy" @click="saveSync">Save sync profile</button></div>
  </section>
</template>
