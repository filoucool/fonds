<script setup lang="ts">
import { computed } from 'vue';
import type { ComponentRecord } from '../api/types';
import { COMPONENT_KEYS, componentLabel, toneFor } from '../lib/labels';

const props = defineProps<{ components: ComponentRecord[] | null | undefined }>();

const rows = computed(() =>
  COMPONENT_KEYS.map((key) => {
    const found = (props.components ?? []).find((item) => item.component === key);
    const state = found?.state ?? '';
    return {
      key,
      tone: found ? toneFor(found.state) : 'neutral',
      title: found ? `${componentLabel(key)}: ${found.state}` : `${componentLabel(key)}: not reported`,
      state,
    };
  }),
);

const summary = computed(() => rows.value.map((row) => row.title).join(', '));
</script>

<template>
  <span class="mini-pips" :aria-label="summary">
    <i
      v-for="row in rows"
      :key="row.key"
      class="pip"
      :class="row.tone"
      :title="row.title"
      aria-hidden="true"
    />
  </span>
</template>
