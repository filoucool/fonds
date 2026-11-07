<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../../api/client';
import type { ComponentKey, ComponentRecord } from '../../api/types';
import EmptyState from '../../components/EmptyState.vue';
import ErrorState from '../../components/ErrorState.vue';
import LoadingState from '../../components/LoadingState.vue';
import StatusLabel from '../../components/StatusLabel.vue';
import { useResource } from '../../composables/useResource';
import { formatBytes, formatDate } from '../../lib/format';
import { COMPONENT_KEYS, componentLabel } from '../../lib/labels';
import { routeId } from '../../lib/route';

const route = useRoute();
const id = computed(() => routeId(route.params.id));
const { data, error, loading, load } = useResource<ComponentRecord[]>(() => api.listComponents(id.value));

const rows = computed(() => {
  const records = data.value ?? [];
  const known = new Set<string>(COMPONENT_KEYS);
  const ordered = COMPONENT_KEYS.map((key) => {
    const found = records.find((item) => item.component === key);
    return { key, record: found ?? null };
  });
  const extras = records
    .filter((item) => !known.has(item.component))
    .map((item) => ({ key: item.component as ComponentKey, record: item }));
  return [...ordered, ...extras];
});

watch(id, () => {
  void load();
}, { immediate: true });
</script>

<template>
  <div class="stack">
    <LoadingState v-if="loading && !data" message="Loading components…" />
    <ErrorState v-else-if="error && !data" :message="error" @retry="load(false)" />
    <EmptyState v-else-if="data && !rows.length" title="No components" detail="Component records have not been reported." />
    <div v-else-if="data" class="table-wrap">
      <table class="data">
        <caption class="sr-only">Archive components</caption>
        <thead>
          <tr>
            <th>Component</th>
            <th>State</th>
            <th class="right">Size</th>
            <th>Last success</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.key">
            <td>{{ componentLabel(row.key) }}</td>
            <td>
              <StatusLabel v-if="row.record" :value="row.record.state" />
              <span v-else class="muted">—</span>
            </td>
            <td class="mono right">{{ row.record ? formatBytes(row.record.sizeBytes) : '—' }}</td>
            <td class="mono">{{ formatDate(row.record?.lastSuccessAt) }}</td>
            <td>{{ row.record?.error || (row.record ? '—' : 'No record') }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
