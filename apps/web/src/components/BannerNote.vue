<script setup lang="ts">
withDefaults(defineProps<{ tone?: 'danger' | 'warn' | 'ok' | 'info' }>(), { tone: 'info' });
</script>

<template>
  <div class="banner" :class="tone" :role="tone === 'danger' ? 'alert' : 'status'">
    <slot />
  </div>
</template>
