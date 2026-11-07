<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, errorMessage } from '../../api/client';
import type { BlobResponse, TreeEntry, TreeSpace } from '../../api/types';
import BannerNote from '../../components/BannerNote.vue';
import EmptyState from '../../components/EmptyState.vue';
import ErrorState from '../../components/ErrorState.vue';
import LoadingState from '../../components/LoadingState.vue';
import { formatBytes, shortOid } from '../../lib/format';
import { assignQuery, queryString, routeId } from '../../lib/route';
import { useRepositoryContext } from './context';

const route = useRoute();
const router = useRouter();
const { repo } = useRepositoryContext();
const loading = ref(false);
const error = ref<string | null>(null);
const entries = ref<TreeEntry[]>([]);
const blob = ref<BlobResponse | null>(null);
const refDraft = ref('');
const pathDraft = ref('');
let token = 0;

const space = computed<TreeSpace>(() => (queryString(route.query, 'space') === 'wiki' ? 'wiki' : 'repository'));
const refName = computed(() => queryString(route.query, 'ref'));
const pathValue = computed(() => queryString(route.query, 'path'));
const view = computed(() => (queryString(route.query, 'view') === 'blob' ? 'blob' : 'tree'));
const id = computed(() => routeId(route.params.id));

const crumbs = computed(() => {
  const parts = pathValue.value.split('/').filter(Boolean);
  const items = [{ name: space.value === 'wiki' ? 'Wiki' : 'Repository', path: '' }];
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    items.push({ name: part, path: current });
  }
  return items;
});

const sorted = computed(() =>
  [...entries.value].sort((a, b) => {
    if (a.kind === 'tree' && b.kind !== 'tree') return -1;
    if (b.kind === 'tree' && a.kind !== 'tree') return 1;
    return a.name.localeCompare(b.name);
  }),
);

function push(partial: Record<string, string | undefined>) {
  void router.push({ query: assignQuery(route.query, partial) });
}

function setSpace(next: TreeSpace) {
  push({ space: next === 'wiki' ? 'wiki' : undefined, path: undefined, view: undefined });
}

function applyLocation() {
  push({
    ref: refDraft.value.trim() || undefined,
    path: pathDraft.value.trim() || undefined,
    view: undefined,
  });
}

function openEntry(entry: TreeEntry) {
  if (entry.kind === 'tree') push({ path: entry.path || undefined, view: undefined });
  else if (entry.kind === 'blob') push({ path: entry.path, view: 'blob' });
}

function openCrumb(path: string) {
  push({ path: path || undefined, view: undefined });
}

async function load() {
  const mine = ++token;
  loading.value = true;
  error.value = null;
  const query = {
    space: space.value,
    ref: refName.value || undefined,
    path: pathValue.value || undefined,
  };
  try {
    if (view.value === 'blob') {
      entries.value = [];
      blob.value = null;
      const next = await api.getBlob(id.value, query);
      if (mine !== token) return;
      blob.value = next;
    } else {
      blob.value = null;
      entries.value = [];
      const next = await api.getTree(id.value, query);
      if (mine !== token) return;
      entries.value = next;
    }
  } catch (reason) {
    if (mine !== token) return;
    error.value = errorMessage(reason);
    if (view.value === 'blob') blob.value = null;
    else entries.value = [];
  } finally {
    if (mine === token) loading.value = false;
  }
}

watch([id, space, refName, pathValue, view], () => {
  refDraft.value = refName.value;
  pathDraft.value = pathValue.value;
  void load();
}, { immediate: true });

const rawUrl = computed(() =>
  api.blobRawUrl(id.value, {
    space: space.value,
    ref: refName.value || undefined,
    path: pathValue.value,
  }),
);
</script>

<template>
  <div class="stack">
    <form class="cluster" @submit.prevent="applyLocation">
      <button type="button" :aria-pressed="space === 'repository'" @click="setSpace('repository')">Repository</button>
      <button type="button" :aria-pressed="space === 'wiki'" @click="setSpace('wiki')">Wiki</button>
      <label class="field" style="width: 180px">
        <span class="lbl">Ref</span>
        <input v-model="refDraft" type="text" :placeholder="repo?.defaultBranch || 'default branch'" />
      </label>
      <label class="field" style="flex: 1; min-width: 180px">
        <span class="lbl">Path</span>
        <input v-model="pathDraft" type="text" class="mono" />
      </label>
      <button type="submit">Open</button>
    </form>
    <p class="hint">A blank ref uses the archived default branch.</p>
    <nav class="crumbs" aria-label="Path">
      <template v-for="(crumb, index) in crumbs" :key="crumb.path || 'root'">
        <span v-if="index" class="sep">/</span>
        <button type="button" class="linkish" @click="openCrumb(crumb.path)">{{ crumb.name }}</button>
      </template>
    </nav>
    <LoadingState v-if="loading && !entries.length && !blob" message="Loading files…" />
    <ErrorState v-else-if="error && !entries.length && !blob" :message="error" @retry="load" />
    <template v-else>
      <BannerNote v-if="error" tone="danger">{{ error }}</BannerNote>
      <section v-if="view === 'blob' && blob" class="stack">
        <p class="mono muted break">{{ blob.ref }} · {{ blob.path }} · {{ blob.oid }} · {{ formatBytes(blob.sizeBytes) }}</p>
        <BannerNote v-if="blob.binary" tone="info">
          Binary object. The archive stored {{ formatBytes(blob.sizeBytes) }} and did not extract text.
        </BannerNote>
        <BannerNote v-else-if="blob.truncated" tone="warn">
          Preview truncated. Download the raw object for the full contents.
        </BannerNote>
        <pre v-if="!blob.binary" class="code-view">{{ blob.content }}</pre>
        <p><a :href="rawUrl">Download raw</a></p>
      </section>
      <EmptyState v-else-if="!sorted.length" title="This directory is empty" detail="Nothing is archived at this path." />
      <div v-else class="table-wrap">
        <table class="data">
          <caption class="sr-only">Tree</caption>
          <thead>
            <tr>
              <th>Name</th>
              <th>Kind</th>
              <th>Mode</th>
              <th class="right">Size</th>
              <th>Object</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in sorted" :key="entry.path + entry.kind">
              <td>
                <button
                  v-if="entry.kind === 'tree' || entry.kind === 'blob'"
                  type="button"
                  class="linkish"
                  @click="openEntry(entry)"
                >
                  {{ entry.name }}
                </button>
                <span v-else>{{ entry.name }}</span>
              </td>
              <td>{{ entry.kind }}</td>
              <td class="mono">{{ entry.mode }}</td>
              <td class="mono right">{{ formatBytes(entry.sizeBytes) }}</td>
              <td class="mono" :title="entry.oid">{{ shortOid(entry.oid) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>
