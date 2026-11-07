<script setup lang="ts">
defineProps<{ title: string; lede?: string }>();
</script>

<template>
  <header class="page-header">
    <div>
      <h1>{{ title }}</h1>
      <p v-if="lede" class="lede">{{ lede }}</p>
    </div>
    <div class="cluster">
      <slot name="actions" />
    </div>
  </header>
</template>
