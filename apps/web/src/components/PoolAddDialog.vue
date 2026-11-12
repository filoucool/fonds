<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, errorMessage } from '../api/client';
import type { StoragePathCandidate } from '../api/types';
import BannerNote from './BannerNote.vue';
import FormDialog from './FormDialog.vue';
import { bytesFromGib, WEIGHT_PRESETS } from '../lib/pool';
import { requireInt } from '../lib/profile';
import { formatBytes } from '../lib/format';

const CUSTOM = '__custom__';

defineProps<{ busy?: boolean }>();
const emit = defineEmits<{ cancel: []; created: [] }>();

const name = ref('');
const rootChoice = ref('');
const customPath = ref('');
const thresholdGib = ref('10');
const weightPreset = ref('5');
const acceptNew = ref(true);
const localError = ref<string | null>(null);
const saving = ref(false);
const candidates = ref<StoragePathCandidate[]>([]);
const candidatesError = ref<string | null>(null);
const loadingCandidates = ref(true);

const resolvedRootPath = computed(() => {
  if (rootChoice.value === CUSTOM) return customPath.value.trim();
  return rootChoice.value.trim();
});

function candidateLabel(item: StoragePathCandidate): string {
  const space = `${formatBytes(item.freeBytes)} free`;
  if (item.label) return `${item.label} · ${space} · ${item.path}`;
  return `${space} · ${item.path}`;
}

async function loadCandidates() {
  loadingCandidates.value = true;
  candidatesError.value = null;
  try {
    const items = await api.listStoragePathCandidates();
    candidates.value = items;
    const inUse = new Set(items.filter((item) => item.kind === 'configured').map((item) => item.path));
    const fresh = items.find((item) => item.kind !== 'configured' && !inUse.has(item.path));
    if (fresh) rootChoice.value = fresh.path;
    else if (items[0]) rootChoice.value = items[0].path;
  } catch (reason) {
    candidatesError.value = errorMessage(reason);
    rootChoice.value = CUSTOM;
  } finally {
    loadingCandidates.value = false;
  }
}

async function submit() {
  if (saving.value) return;
  localError.value = null;
  const gib = Number(thresholdGib.value.trim());
  const path = resolvedRootPath.value;
  if (!name.value.trim() || !path) {
    localError.value = 'Name and root path are required.';
    return;
  }
  if (!Number.isFinite(gib) || gib < 0) {
    localError.value = 'Enter a valid free-space reserve in GB.';
    return;
  }
  const preset = WEIGHT_PRESETS.find((item) => item.id === weightPreset.value);
  const weight = preset?.value ?? 5;
  saving.value = true;
  try {
    await api.createPool({
      name: name.value.trim(),
      rootPath: path,
      freeSpaceThresholdBytes: bytesFromGib(gib),
      acceptNew: acceptNew.value,
      placementWeight: requireInt(String(weight), 'Placement weight', 0),
    });
    emit('created');
  } catch (reason) {
    localError.value = errorMessage(reason);
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  void loadCandidates();
});
</script>

<template>
  <FormDialog title="Add storage pool" submit-label="Add pool" primary :busy="busy || saving" @cancel="emit('cancel')" @submit="submit">
    <p class="muted">
      Paths come from the archive host: your data directory, writable subfolders, and mounts under those roots (see
      <span class="mono">FONDS_STORAGE_ROOTS</span> to add more).
    </p>
    <BannerNote v-if="localError" tone="danger">{{ localError }}</BannerNote>
    <BannerNote v-if="candidatesError" tone="warn">
      Could not load suggested paths. Enter a path manually.
    </BannerNote>
    <div class="form-grid">
      <label class="field">
        <span class="lbl">Name</span>
        <input v-model="name" type="text" required autocomplete="off" />
      </label>
      <label class="field" style="grid-column: 1 / -1">
        <span class="lbl">Root path</span>
        <select v-model="rootChoice" :disabled="loadingCandidates && !candidates.length">
          <option v-if="loadingCandidates" value="">Scanning host paths…</option>
          <option v-else-if="!candidates.length && rootChoice !== CUSTOM" disabled value="">
            No suggested paths
          </option>
          <option v-for="item in candidates" :key="item.path" :value="item.path">
            {{ candidateLabel(item) }}
          </option>
          <option :value="CUSTOM">Other path…</option>
        </select>
        <input
          v-if="rootChoice === CUSTOM"
          v-model="customPath"
          type="text"
          required
          class="mono"
          autocomplete="off"
          placeholder="/absolute/path/on/host"
        />
        <span v-else-if="resolvedRootPath" class="hint mono break">{{ resolvedRootPath }}</span>
      </label>
      <label class="field">
        <span class="lbl">Reserve free space (GB)</span>
        <input v-model="thresholdGib" type="text" inputmode="decimal" />
        <span class="hint">Refuse new archives when free space drops below this reserve.</span>
      </label>
      <label class="field">
        <span class="lbl">Placement weight</span>
        <select v-model="weightPreset">
          <option v-for="preset in WEIGHT_PRESETS" :key="preset.id" :value="preset.id">
            {{ preset.label }} ({{ preset.value }})
          </option>
        </select>
        <span class="hint">{{ WEIGHT_PRESETS.find((p) => p.id === weightPreset)?.hint }}</span>
      </label>
    </div>
    <label class="choice">
      <input v-model="acceptNew" type="checkbox" />
      <span>Accept new repositories</span>
    </label>
  </FormDialog>
</template>
