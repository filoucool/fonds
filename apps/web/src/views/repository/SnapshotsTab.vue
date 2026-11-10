<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useResource } from '../../composables/useResource';
import { api } from '../../api/client';
import LoadingState from '../../components/LoadingState.vue';
import EmptyState from '../../components/EmptyState.vue';

const route = useRoute();
const repositoryId = computed(() => String(route.params.id ?? ''));

const { data, error, loading, load } = useResource(async () => {
  const items = await api.listRepositorySnapshots(repositoryId.value);
  return items;
});

async function createSnapshot() {
  await api.createRepositorySnapshot(repositoryId.value);
  await load();
}
</script>

<template>
  <LoadingState v-if="loading && !data" message="Loading snapshots…" />
  <p v-else-if="error" class="error">{{ error.message }}</p>
  <div v-else class="stack">
    <div>
      <button type="button" @click="createSnapshot">Create manual snapshot</button>
    </div>
  <EmptyState v-if="!data?.items.length" title="No snapshots yet" detail="Snapshots capture labeled archive state without duplicating Git objects." />
    <table v-else class="table">
      <thead>
        <tr>
          <th>Created</th>
          <th>Cause</th>
          <th>Pinned</th>
          <th>Digest</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in data.items" :key="item.id">
          <td>{{ item.createdAt }}</td>
          <td>{{ item.cause }}</td>
          <td>{{ item.pinned ? 'yes' : 'no' }}</td>
          <td class="mono">{{ item.contentDigest.slice(0, 12) }}…</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
