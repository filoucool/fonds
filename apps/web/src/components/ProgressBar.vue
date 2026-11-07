<script setup lang="ts">
import { computed } from 'vue';
import { formatBytes } from '../lib/format';

const props = defineProps<{ done: number | null; total: number | null }>();
const width = computed(() => {
  const total = props.total ?? 0;
  const done = props.done ?? 0;
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, (done / total) * 100));
});
</script>

<template>
  <div class="stack">
    <div class="meter" :title="`${width.toFixed(0)}%`">
      <div class="fill" :style="{ width: `${width}%` }" />
    </div>
    <span class="mono muted">{{ formatBytes(done) }} / {{ formatBytes(total) }}</span>
  </div>
</template>
