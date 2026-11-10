<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const q = ref('');

function submit() {
  const query = q.value.trim();
  if (!query) {
    void router.push('/search');
    return;
  }
  void router.push({ path: '/search', query: { q: query, capabilities: 'metadata,filenames,source_text' } });
}
</script>

<template>
  <form class="global-search" role="search" @submit.prevent="submit">
    <label class="sr-only" for="global-search-q">Search archives</label>
    <input id="global-search-q" v-model="q" type="search" placeholder="Search metadata, paths…" />
    <button type="submit">Search</button>
  </form>
</template>

<style scoped>
.global-search {
  display: flex;
  gap: 0.35rem;
  margin: 0.5rem 0 1rem;
}
.global-search input {
  flex: 1;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}
</style>
