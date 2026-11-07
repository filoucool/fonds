<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../../api/client';
import BannerNote from '../../components/BannerNote.vue';
import EmptyState from '../../components/EmptyState.vue';
import ErrorState from '../../components/ErrorState.vue';
import LoadingState from '../../components/LoadingState.vue';
import PagerBar from '../../components/PagerBar.vue';
import StatusLabel from '../../components/StatusLabel.vue';
import { useCursorPager } from '../../composables/useCursorPager';
import { formatDate } from '../../lib/format';
import { routeId } from '../../lib/route';

const props = defineProps<{ kind: 'issues' | 'pulls' }>();
const route = useRoute();
const id = computed(() => routeId(route.params.id));
const noun = computed(() => (props.kind === 'issues' ? 'issues' : 'pull requests'));

const { items, loading, refreshing, error, reset, next, prev, hasPrev, hasNext } = useCursorPager((cursor) => {
  const query = { cursor, limit: 30 };
  return props.kind === 'issues' ? api.listIssues(id.value, query) : api.listPulls(id.value, query);
});

watch([id, () => props.kind], () => {
  void reset();
}, { immediate: true });
</script>

<template>
  <div class="stack">
    <LoadingState v-if="loading && !items.length" :message="`Loading ${noun}…`" />
    <ErrorState v-else-if="error && !items.length" :message="error" @retry="reset" />
    <EmptyState
      v-else-if="!items.length"
      :title="`No ${noun} archived`"
      :detail="`Records appear after the ${noun} component has been archived.`"
    />
    <template v-else>
      <BannerNote v-if="error" tone="danger">{{ error }}</BannerNote>
      <article v-for="item in items" :key="item.id" class="panel stack">
        <header class="cluster">
          <h2 style="margin: 0">#{{ item.number }} {{ item.title }}</h2>
          <StatusLabel :value="item.state" />
        </header>
        <p class="muted">
          {{ item.author || 'Unknown author' }} · opened {{ formatDate(item.createdAt) }} · updated {{ formatDate(item.updatedAt) }}
        </p>
        <p v-if="item.url"><a :href="item.url" target="_blank" rel="noreferrer">Upstream</a></p>
        <div class="prose">{{ item.body || 'No body archived.' }}</div>
        <p v-if="item.bodyTruncated" class="hint">Body truncated.</p>
      </article>
      <PagerBar :has-prev="hasPrev" :has-next="hasNext" :loading="loading || refreshing" @prev="prev" @next="next" />
    </template>
  </div>
</template>
