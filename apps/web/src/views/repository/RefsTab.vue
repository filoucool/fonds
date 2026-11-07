<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../../api/client';
import type { RefsResponse } from '../../api/types';
import EmptyState from '../../components/EmptyState.vue';
import ErrorState from '../../components/ErrorState.vue';
import LoadingState from '../../components/LoadingState.vue';
import { useResource } from '../../composables/useResource';
import { REFS_SURVIVE_NOTE } from '../../lib/copy';
import { formatDate, shortOid } from '../../lib/format';
import { routeId } from '../../lib/route';

const route = useRoute();
const id = computed(() => routeId(route.params.id));
const { data, error, loading, load } = useResource<RefsResponse>(() => api.getRefs(id.value));

watch(id, () => {
  void load();
}, { immediate: true });
</script>

<template>
  <div class="stack">
    <p class="muted">{{ REFS_SURVIVE_NOTE }} Current upstream and preserved history are kept as two lists.</p>
    <LoadingState v-if="loading && !data" message="Loading refs…" />
    <ErrorState v-else-if="error && !data" :message="error" @retry="load(false)" />
    <template v-else-if="data">
      <section class="stack">
        <h2>Current upstream</h2>
        <EmptyState v-if="!data.current.length" title="No current upstream refs" detail="The latest snapshot did not include upstream refs." />
        <div v-else class="table-wrap">
          <table class="data">
            <caption class="sr-only">Current upstream refs</caption>
            <thead>
              <tr><th>Name</th><th>Short</th><th>Object</th></tr>
            </thead>
            <tbody>
              <tr v-for="item in data.current" :key="item.name">
                <td class="mono">{{ item.name }}</td>
                <td class="mono">{{ item.shortOid || shortOid(item.oid) }}</td>
                <td class="mono break">{{ item.oid }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <section class="stack">
        <h2>Preserved history</h2>
        <EmptyState
          v-if="!data.archived.length"
          title="No preserved refs"
          detail="They appear when an upstream ref is deleted or moved."
        />
        <div v-else class="table-wrap">
          <table class="data">
            <caption class="sr-only">Preserved history</caption>
            <thead>
              <tr>
                <th>Name</th>
                <th>Short</th>
                <th>Source ref</th>
                <th>Reason</th>
                <th>Recorded</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in data.archived" :key="item.name + item.oid">
                <td class="mono">{{ item.name }}</td>
                <td class="mono" :title="item.oid">{{ item.shortOid || shortOid(item.oid) }}</td>
                <td class="mono">{{ item.sourceRef || '—' }}</td>
                <td>{{ item.reason || '—' }}</td>
                <td class="mono">{{ formatDate(item.recordedAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>
