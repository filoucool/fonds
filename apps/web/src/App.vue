<script setup lang="ts">
import AppNav from './components/AppNav.vue';
</script>

<template>
  <div class="shell">
    <AppNav />
    <main class="main">
      <RouterView />
    </main>
  </div>
</template>
