<script setup lang="ts">
defineProps<{ message: string }>();
</script>

<template>
  <div class="empty" role="status">
    <p class="empty-title">{{ message }}</p>
  </div>
</template>
