<script setup lang="ts">
defineProps<{ hasPrev: boolean; hasNext: boolean; loading?: boolean }>();
const emit = defineEmits<{ prev: []; next: [] }>();
</script>

<template>
  <div class="cluster">
    <button type="button" :disabled="!hasPrev || loading" @click="emit('prev')">Previous</button>
    <button type="button" :disabled="!hasNext || loading" @click="emit('next')">Next page</button>
    <span v-if="loading" class="muted">Loading…</span>
  </div>
</template>
