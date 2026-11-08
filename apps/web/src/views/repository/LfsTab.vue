<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../../api/client';
import type { LfsObject } from '../../api/types';
import EmptyState from '../../components/EmptyState.vue';
import ErrorState from '../../components/ErrorState.vue';
import LoadingState from '../../components/LoadingState.vue';
import { useResource } from '../../composables/useResource';
import { formatBytes } from '../../lib/format';
import { routeId } from '../../lib/route';

const route = useRoute();
const id = computed(() => routeId(route.params.id));
const { data, error, loading, load } = useResource<LfsObject[]>(() => api.listLfs(id.value));

watch(id, () => {
  void load();
}, { immediate: true });
</script>

<template>
  <div class="stack">
    <LoadingState v-if="loading && !data" message="Loading LFS objects…" />
    <ErrorState v-else-if="error && !data" :message="error" @retry="load(false)" />
    <EmptyState
      v-else-if="data && !data.length"
      title="No LFS objects archived"
      detail="Pointers anywhere in the repository are listed here after the LFS component runs."
    />
    <div v-else-if="data" class="table-wrap">
      <table class="data">
        <caption class="sr-only">Archived Git LFS objects</caption>
        <thead>
          <tr>
            <th>Path</th>
            <th>Object</th>
            <th class="right">Size</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="object in data" :key="object.oid + object.path">
            <td class="mono">{{ object.path }}</td>
            <td class="mono">{{ object.oid }}</td>
            <td class="right mono">{{ formatBytes(object.size) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
