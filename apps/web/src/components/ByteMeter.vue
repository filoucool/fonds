<script setup lang="ts">
import { computed } from 'vue';
import { formatBytes, formatPercent } from '../lib/format';

const props = defineProps<{
  free: number | null;
  total: number | null;
  threshold?: number | null;
}>();

const usedRatio = computed(() => {
  const total = props.total ?? 0;
  const free = props.free ?? 0;
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, ((total - free) / total) * 100));
});

const tick = computed(() => {
  const total = props.total ?? 0;
  if (!total || props.threshold == null) return null;
  const raw = ((total - props.threshold) / total) * 100;
  return Math.min(100, Math.max(0, raw));
});

const below = computed(() => {
  if (props.threshold == null || props.free == null) return false;
  return props.free < props.threshold;
});
</script>

<template>
  <div class="stack">
    <div
      class="meter"
      :class="{ danger: below }"
      :title="`Used ${formatPercent((total ?? 0) - (free ?? 0), total ?? 0)}`"
    >
      <div class="fill" :style="{ width: `${usedRatio}%` }" />
      <i
        v-if="tick != null"
        class="tick"
        :style="{ left: `${tick}%` }"
        :title="`Free-space threshold ${formatBytes(threshold)}`"
      />
    </div>
    <p class="mono muted">
      {{ formatBytes(free) }} free of {{ formatBytes(total) }}
      <template v-if="threshold != null"> · threshold {{ formatBytes(threshold) }}</template>
    </p>
  </div>
</template>
