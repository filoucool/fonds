<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../../api/client';
import type { DiscussionItem } from '../../api/types';
import BannerNote from '../../components/BannerNote.vue';
import EmptyState from '../../components/EmptyState.vue';
import ErrorState from '../../components/ErrorState.vue';
import LoadingState from '../../components/LoadingState.vue';
import PagerBar from '../../components/PagerBar.vue';
import StatusLabel from '../../components/StatusLabel.vue';
import { useCursorPager } from '../../composables/useCursorPager';
import { formatDate } from '../../lib/format';
import { routeId } from '../../lib/route';

const props = defineProps<{ kind: 'issues' | 'pulls' | 'discussions' }>();
const route = useRoute();
const id = computed(() => routeId(route.params.id));
const noun = computed(() => (props.kind === 'issues' ? 'issues' : props.kind === 'pulls' ? 'pull requests' : 'discussions'));
const comments = ref<DiscussionItem[]>([]);

const { items, loading, refreshing, error, reset, next, prev, hasPrev, hasNext } = useCursorPager((cursor) => {
  const query = { cursor, limit: 30 };
  if (props.kind === 'pulls') return api.listPulls(id.value, query);
  if (props.kind === 'discussions') return api.listDiscussions(id.value, query);
  return api.listIssues(id.value, query);
});

function commentsFor(item: DiscussionItem): DiscussionItem[] {
  return comments.value.filter((comment) => comment.parentKey === item.providerKey);
}

watch([id, () => props.kind], () => {
  comments.value = [];
  void reset();
}, { immediate: true });

watch(items, () => {
  if (props.kind === 'discussions') {
    comments.value = [];
    return;
  }
  const parents = items.value.map((item) => item.providerKey).filter((key) => key.length > 0);
  const kind = props.kind === 'pulls' ? 'pull' : 'issue';
  void api.listComments(id.value, kind, parents).then((rows) => {
    comments.value = rows;
  }).catch(() => {
    comments.value = [];
  });
});
</script>

<template>
  <div class="stack">
    <LoadingState v-if="loading && !items.length" :message="`Loading ${noun}…`" />
    <ErrorState v-else-if="error && !items.length" :message="error" @retry="reset" />
    <EmptyState
      v-else-if="!items.length"
      :title="`No ${noun} archived`"
      :detail="props.kind === 'discussions' ? 'GitHub discussions are archived when a credential is stored. GitLab does not expose this component.' : `Records appear after the ${noun} component has been archived.`"
    />
    <template v-else>
      <BannerNote v-if="error" tone="danger">{{ error }}</BannerNote>
      <article v-for="item in items" :key="item.id" class="panel stack">
        <header class="cluster">
          <h2 style="margin: 0">#{{ item.number }} {{ item.title }}</h2>
          <StatusLabel :value="item.state" />
          <StatusLabel v-if="item.upstreamMissing" value="deleted" label="removed upstream" />
        </header>
        <p class="muted">
          {{ item.author || 'Unknown author' }} · opened {{ formatDate(item.createdAt) }} · updated {{ formatDate(item.updatedAt) }}
        </p>
        <p v-if="item.url"><a :href="item.url" target="_blank" rel="noreferrer">Upstream</a></p>
        <div class="prose">{{ item.body || 'No body archived.' }}</div>
        <p v-if="item.bodyTruncated" class="hint">Body truncated.</p>
        <section v-if="commentsFor(item).length" class="stack">
          <h3>Comments</h3>
          <article v-for="comment in commentsFor(item)" :key="comment.id" class="stack">
            <p class="muted">{{ comment.author || 'Unknown author' }} · {{ formatDate(comment.createdAt) }}</p>
            <p v-if="comment.upstreamMissing" class="hint">Removed upstream. The archived text is kept.</p>
            <div class="prose">{{ comment.body || 'No body archived.' }}</div>
          </article>
        </section>
      </article>
      <PagerBar :has-prev="hasPrev" :has-next="hasNext" :loading="loading || refreshing" @prev="prev" @next="next" />
    </template>
  </div>
</template>
