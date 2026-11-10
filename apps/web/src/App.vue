<script setup lang="ts">
import AppNav from './components/AppNav.vue';
import GlobalSearchBar from './components/GlobalSearchBar.vue';
import TrustedNetworkBanner from './components/TrustedNetworkBanner.vue';
</script>

<template>
  <div class="shell">
    <AppNav />
    <main class="main">
      <TrustedNetworkBanner />
      <GlobalSearchBar />
      <RouterView />
    </main>
  </div>
</template>
