<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../api/client';
import EmptyState from '../../components/EmptyState.vue';
import ErrorState from '../../components/ErrorState.vue';
import LoadingState from '../../components/LoadingState.vue';
import PagerBar from '../../components/PagerBar.vue';
import BannerNote from '../../components/BannerNote.vue';
import { useCursorPager } from '../../composables/useCursorPager';
import { formatDate, shortOid } from '../../lib/format';
import { assignQuery, queryString, routeId } from '../../lib/route';
import { useRepositoryContext } from './context';

const route = useRoute();
const router = useRouter();
const { repo } = useRepositoryContext();
const refDraft = ref('');
const id = computed(() => routeId(route.params.id));
const refName = computed(() => queryString(route.query, 'ref'));
const filterKey = computed(() => `${id.value}|${refName.value}`);

const { items, loading, refreshing, error, reset, next, prev, hasPrev, hasNext } = useCursorPager((cursor) =>
  api.listCommits(id.value, { cursor, limit: 50, ref: refName.value || undefined }),
);

function applyRef() {
  const nextRef = refDraft.value.trim();
  if (nextRef === refName.value) void reset();
  else void router.replace({ query: assignQuery(route.query, { ref: nextRef || undefined }) });
}

watch(filterKey, () => {
  refDraft.value = refName.value;
  void reset();
}, { immediate: true });
</script>

<template>
  <div class="stack">
    <form class="cluster" @submit.prevent="applyRef">
      <label class="field" style="width: 220px">
        <span class="lbl">Ref</span>
        <input v-model="refDraft" type="text" :placeholder="repo?.defaultBranch || 'default branch'" />
      </label>
      <button type="submit">Apply</button>
    </form>
    <LoadingState v-if="loading && !items.length" message="Loading commits…" />
    <ErrorState v-else-if="error && !items.length" :message="error" @retry="reset" />
    <EmptyState v-else-if="!items.length" title="No commits" detail="This ref has no archived commits." />
    <template v-else>
      <BannerNote v-if="error" tone="danger">{{ error }}</BannerNote>
      <div class="table-wrap">
        <table class="data">
          <caption class="sr-only">Commits</caption>
          <thead>
            <tr>
              <th>Commit</th>
              <th>Summary</th>
              <th>Author</th>
              <th>Authored</th>
              <th>Parents</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="commit in items" :key="commit.oid">
              <td class="mono" :title="commit.oid">{{ commit.shortOid || shortOid(commit.oid) }}</td>
              <td>{{ commit.summary }}</td>
              <td>{{ commit.authorName }}</td>
              <td class="mono">{{ formatDate(commit.authoredAt) }}</td>
              <td class="mono">
                <span v-for="parent in commit.parentOids" :key="parent" :title="parent">{{ shortOid(parent) }} </span>
                <span v-if="!commit.parentOids.length">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <PagerBar :has-prev="hasPrev" :has-next="hasNext" :loading="loading || refreshing" @prev="prev" @next="next" />
    </template>
  </div>
</template>
