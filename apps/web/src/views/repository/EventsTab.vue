<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../../api/client';
import BannerNote from '../../components/BannerNote.vue';
import EmptyState from '../../components/EmptyState.vue';
import ErrorState from '../../components/ErrorState.vue';
import JsonBlock from '../../components/JsonBlock.vue';
import LoadingState from '../../components/LoadingState.vue';
import PagerBar from '../../components/PagerBar.vue';
import StatusLabel from '../../components/StatusLabel.vue';
import { useCursorPager } from '../../composables/useCursorPager';
import { formatDate } from '../../lib/format';
import { routeId } from '../../lib/route';

const route = useRoute();
const id = computed(() => routeId(route.params.id));
const { items, loading, refreshing, error, reset, next, prev, hasPrev, hasNext } = useCursorPager((cursor) =>
  api.listEvents(id.value, { cursor, limit: 50 }),
);

watch(id, () => {
  void reset();
}, { immediate: true });
</script>

<template>
  <div class="stack">
    <LoadingState v-if="loading && !items.length" message="Loading events…" />
    <ErrorState v-else-if="error && !items.length" :message="error" @retry="reset" />
    <EmptyState v-else-if="!items.length" title="No events" detail="Sync and verify history will be recorded here." />
    <template v-else>
      <BannerNote v-if="error" tone="danger">{{ error }}</BannerNote>
      <div class="table-wrap">
        <table class="data">
          <caption class="sr-only">Repository events</caption>
          <thead>
            <tr>
              <th>When</th>
              <th>Kind</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="event in items" :key="event.id">
              <tr>
                <td class="mono">{{ formatDate(event.createdAt) }}</td>
                <td><StatusLabel :value="event.kind" /></td>
                <td>{{ event.message }}</td>
              </tr>
              <tr v-if="event.detail != null && event.detail !== ''">
                <td colspan="3"><JsonBlock :value="event.detail" /></td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
      <PagerBar :has-prev="hasPrev" :has-next="hasNext" :loading="loading || refreshing" @prev="prev" @next="next" />
    </template>
  </div>
</template>
