<script setup lang="ts">
defineProps<{ message: string }>();
const emit = defineEmits<{ retry: [] }>();
</script>

<template>
  <div class="banner danger" role="alert">
    <p>{{ message }}</p>
    <div class="cluster" style="margin-top: 8px">
      <button type="button" @click="emit('retry')">Retry</button>
    </div>
  </div>
</template>
