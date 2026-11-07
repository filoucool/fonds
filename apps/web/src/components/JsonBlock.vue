<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ value: unknown }>();
const text = computed(() => {
  if (props.value == null || props.value === '') return '';
  if (typeof props.value === 'string') return props.value;
  try {
    return JSON.stringify(props.value, null, 2);
  } catch {
    return String(props.value);
  }
});
</script>

<template>
  <pre v-if="text" class="code-view">{{ text }}</pre>
</template>
