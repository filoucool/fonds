<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { api, errorMessage } from '../api/client';
import type { Pool } from '../api/types';
import BannerNote from './BannerNote.vue';
import FormDialog from './FormDialog.vue';
import {
  formatGibForInput,
  parseGibInput,
  WEIGHT_PRESETS,
  weightPresetId,
} from '../lib/pool';
import { requireInt } from '../lib/profile';

const props = defineProps<{ pool: Pool; busy?: boolean }>();
const emit = defineEmits<{ cancel: []; saved: [] }>();

const thresholdGib = ref(formatGibForInput(props.pool.freeSpaceThresholdBytes));
const weightPreset = ref(weightPresetId(props.pool.placementWeight));
const acceptNew = ref(props.pool.acceptNew);
const enabled = ref(props.pool.enabled);
const localError = ref<string | null>(null);
const saving = ref(false);

const busy = computed(() => props.busy === true || saving.value);

watch(
  () => props.pool,
  (pool) => {
    thresholdGib.value = formatGibForInput(pool.freeSpaceThresholdBytes);
    weightPreset.value = weightPresetId(pool.placementWeight);
    acceptNew.value = pool.acceptNew;
    enabled.value = pool.enabled;
  },
);

async function submit() {
  localError.value = null;
  const threshold = parseGibInput(thresholdGib.value);
  if (threshold == null) {
    localError.value = 'Enter a valid free-space reserve in GB.';
    return;
  }
  const preset = WEIGHT_PRESETS.find((item) => item.id === weightPreset.value);
  const weight = preset?.value ?? props.pool.placementWeight;
  saving.value = true;
  try {
    await api.updatePool(props.pool.id, {
      freeSpaceThresholdBytes: threshold,
      placementWeight: requireInt(String(weight), 'Placement weight', 0),
      acceptNew: acceptNew.value,
      enabled: enabled.value,
    });
    emit('saved');
  } catch (reason) {
    localError.value = errorMessage(reason);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <FormDialog
    :title="`Configure ${pool.name}`"
    submit-label="Save changes"
    primary
    :busy="busy"
    @cancel="emit('cancel')"
    @submit="submit"
  >
    <BannerNote v-if="localError" tone="danger">{{ localError }}</BannerNote>
    <p class="mono muted break">{{ pool.rootPath }}</p>
    <div class="form-grid">
      <label class="field">
        <span class="lbl">Reserve free space (GB)</span>
        <input v-model="thresholdGib" type="text" inputmode="decimal" />
        <span class="hint">Keep at least this much free before refusing new archives.</span>
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
    <label class="choice">
      <input v-model="enabled" type="checkbox" />
      <span>Pool enabled</span>
    </label>
  </FormDialog>
</template>
