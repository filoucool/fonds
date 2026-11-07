<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { api } from '../api/client';
import ErrorState from '../components/ErrorState.vue';
import LoadingState from '../components/LoadingState.vue';
import PageHeader from '../components/PageHeader.vue';
import { useResource } from '../composables/useResource';

const { data, error, loading, load } = useResource(() => api.getInventory());
const text = computed(() => (data.value == null ? '' : JSON.stringify(data.value, null, 2)));

onMounted(() => {
  void load();
});
</script>

<template>
  <PageHeader title="Inventory" lede="Catalog document from the archive host.">
    <template #actions>
      <RouterLink class="button" to="/settings">Settings</RouterLink>
      <button type="button" :disabled="loading" @click="load(true)">Refresh</button>
    </template>
  </PageHeader>
  <LoadingState v-if="loading && data == null" message="Loading inventory…" />
  <ErrorState v-else-if="error && data == null" :message="error" @retry="load(false)" />
  <div v-else class="stack">
    <p v-if="error" class="banner danger" role="alert">{{ error }}</p>
    <pre class="code-view">{{ text }}</pre>
  </div>
</template>
