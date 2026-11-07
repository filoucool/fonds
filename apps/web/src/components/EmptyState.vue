<script setup lang="ts">
defineProps<{ title: string; detail?: string }>();
</script>

<template>
  <div class="empty">
    <p class="empty-title">{{ title }}</p>
    <p v-if="detail" class="muted">{{ detail }}</p>
    <slot />
  </div>
</template>
