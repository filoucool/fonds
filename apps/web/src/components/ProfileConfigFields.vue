<script setup lang="ts">
import { reactive, ref } from 'vue';
import type { ArchivalProfileConfig } from '../api/types';
import { COMPONENT_KEYS, componentLabel } from '../lib/labels';
import { limitToInput, parseByteLimit, parseExclusions } from '../lib/profile';

const props = defineProps<{ initial: ArchivalProfileConfig }>();
const components = reactive({ ...props.initial.components });
const maxRepositoryBytes = ref(limitToInput(props.initial.limits.maxRepositoryBytes));
const maxAssetBytes = ref(limitToInput(props.initial.limits.maxAssetBytes));
const maxComponentBytes = ref(limitToInput(props.initial.limits.maxComponentBytes));
const exclusions = ref(props.initial.exclusions.join('\n'));

function build(): ArchivalProfileConfig {
  return {
    components: { ...components },
    limits: {
      maxRepositoryBytes: parseByteLimit(maxRepositoryBytes.value, 'Max repository bytes'),
      maxAssetBytes: parseByteLimit(maxAssetBytes.value, 'Max asset bytes'),
      maxComponentBytes: parseByteLimit(maxComponentBytes.value, 'Max component bytes'),
    },
    exclusions: parseExclusions(exclusions.value),
  };
}

defineExpose({ build });
</script>

<template>
  <div class="stack">
    <div>
      <h3>Components</h3>
      <div class="check-grid">
        <label v-for="key in COMPONENT_KEYS" :key="key" class="choice">
          <input v-model="components[key]" type="checkbox" />
          <span>{{ componentLabel(key) }}</span>
        </label>
      </div>
    </div>
    <div class="form-grid">
      <label class="field">
        <span class="lbl">Max repository bytes</span>
        <input v-model="maxRepositoryBytes" type="text" inputmode="numeric" autocomplete="off" />
        <span class="hint">Blank means no limit.</span>
      </label>
      <label class="field">
        <span class="lbl">Max asset bytes</span>
        <input v-model="maxAssetBytes" type="text" inputmode="numeric" autocomplete="off" />
        <span class="hint">Blank means no limit.</span>
      </label>
      <label class="field">
        <span class="lbl">Max component bytes</span>
        <input v-model="maxComponentBytes" type="text" inputmode="numeric" autocomplete="off" />
        <span class="hint">Blank means no limit.</span>
      </label>
    </div>
    <label class="field">
      <span class="lbl">Exclusions</span>
      <textarea v-model="exclusions" rows="5" spellcheck="false" />
      <span class="hint">One glob per line.</span>
    </label>
  </div>
</template>
