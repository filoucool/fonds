<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, errorMessage } from '../api/client';
import type { Category, Collection, ExportFormat, ExportRecord, Tag } from '../api/types';
import BannerNote from '../components/BannerNote.vue';
import ComponentPips from '../components/ComponentPips.vue';
import EmptyState from '../components/EmptyState.vue';
import ErrorState from '../components/ErrorState.vue';
import ExportDialog from '../components/ExportDialog.vue';
import LoadingState from '../components/LoadingState.vue';
import PageHeader from '../components/PageHeader.vue';
import PagerBar from '../components/PagerBar.vue';
import StatusLabel from '../components/StatusLabel.vue';
import AppDialog from '../components/AppDialog.vue';
import { useCursorPager } from '../composables/useCursorPager';
import { formatBytes, formatDate, sourceHost } from '../lib/format';
import { ARCHIVE_STATUSES, isArchiveStatus, isProvider, PROVIDERS, providerLabel } from '../lib/labels';
import { SOFT_DELETE_NOTE } from '../lib/copy';
import { assignQuery, queryString } from '../lib/route';

const route = useRoute();
const router = useRouter();
const selected = reactive(new Set<string>());
const draftQ = ref(queryString(route.query, 'q'));
const categories = ref<Category[]>([]);
const tags = ref<Tag[]>([]);
const collections = ref<Collection[]>([]);
const filterError = ref<string | null>(null);
const actionError = ref<string | null>(null);
const busy = ref(false);
const exportOpen = ref(false);
const deleteOpen = ref(false);
const outcome = ref<{ jobs: string[]; deleted: string[]; exports: ExportRecord[] } | null>(null);

const filterKey = computed(() =>
  JSON.stringify({
    q: queryString(route.query, 'q'),
    status: queryString(route.query, 'status'),
    provider: queryString(route.query, 'provider'),
    categoryId: queryString(route.query, 'categoryId'),
    tagId: queryString(route.query, 'tagId'),
    collectionId: queryString(route.query, 'collectionId'),
    sort: queryString(route.query, 'sort') || 'updated',
    includeDeleted: queryString(route.query, 'includeDeleted'),
  }),
);

const { items, loading, refreshing, error, reset, next, prev, hasPrev, hasNext } = useCursorPager((cursor) => {
  const status = queryString(route.query, 'status');
  const provider = queryString(route.query, 'provider');
  const sort = queryString(route.query, 'sort') || 'updated';
  const include = queryString(route.query, 'includeDeleted');
  return api.listRepositories({
    limit: 50,
    cursor,
    q: queryString(route.query, 'q') || undefined,
    status: isArchiveStatus(status) ? status : undefined,
    provider: isProvider(provider) ? provider : undefined,
    categoryId: queryString(route.query, 'categoryId') || undefined,
    tagId: queryString(route.query, 'tagId') || undefined,
    collectionId: queryString(route.query, 'collectionId') || undefined,
    sort: sort === 'name' || sort === 'size' ? sort : 'updated',
    includeDeleted: include === '1' || include === 'true',
  });
});

function replaceQuery(partial: Record<string, string | undefined>) {
  void router.replace({ query: assignQuery(route.query, partial) });
}

function search() {
  const nextQuery = draftQ.value.trim();
  if (nextQuery === queryString(route.query, 'q')) void reset();
  else replaceQuery({ q: nextQuery || undefined });
}

function selectValue(event: Event): string {
  const target = event.target;
  return target instanceof HTMLSelectElement ? target.value : '';
}

function inputChecked(event: Event): boolean {
  const target = event.target;
  return target instanceof HTMLInputElement ? target.checked : false;
}

function onStatus(event: Event) {
  const value = selectValue(event);
  replaceQuery({
    status: value || undefined,
    includeDeleted:
      value === 'deleted' ? '1' : queryString(route.query, 'includeDeleted') || undefined,
  });
}

function onProvider(event: Event) {
  const value = selectValue(event);
  replaceQuery({ provider: value || undefined });
}

function onSort(event: Event) {
  replaceQuery({ sort: selectValue(event) || 'updated' });
}

function onCategory(event: Event) {
  const value = selectValue(event);
  replaceQuery({ categoryId: value || undefined });
}

function onTag(event: Event) {
  const value = selectValue(event);
  replaceQuery({ tagId: value || undefined });
}

function onCollection(event: Event) {
  const value = selectValue(event);
  replaceQuery({ collectionId: value || undefined });
}

function onDeleted(event: Event) {
  replaceQuery({ includeDeleted: inputChecked(event) ? '1' : undefined });
}

const allSelected = computed(
  () => items.value.length > 0 && items.value.every((item) => selected.has(item.id)),
);

function toggleAll() {
  if (allSelected.value) items.value.forEach((item) => selected.delete(item.id));
  else items.value.forEach((item) => selected.add(item.id));
}

function toggleOne(id: string, checked: boolean) {
  if (checked) selected.add(id);
  else selected.delete(id);
}

const selectedIds = computed(() => [...selected]);

async function runBulk(action: 'sync' | 'verify' | 'export' | 'delete', format?: ExportFormat) {
  actionError.value = null;
  outcome.value = null;
  busy.value = true;
  try {
    const result = await api.bulkRepositories({
      action,
      ids: selectedIds.value,
      confirm: action === 'delete' ? true : undefined,
      exportFormat: format,
    });
    const exports: ExportRecord[] = [];
    for (const id of result.exportIds) {
      try {
        exports.push(await api.getExport(id));
      } catch (reason) {
        exports.push({
          id,
          repositoryId: '',
          format: format ?? 'bundle',
          status: 'unknown',
          byteSize: null,
          error: errorMessage(reason),
          createdAt: '',
          finishedAt: null,
        });
      }
    }
    outcome.value = { jobs: result.jobIds, deleted: result.deletedIds, exports };
    selected.clear();
    exportOpen.value = false;
    deleteOpen.value = false;
    await reset();
  } catch (reason) {
    actionError.value = errorMessage(reason);
  } finally {
    busy.value = false;
  }
}

watch(filterKey, () => {
  selected.clear();
  draftQ.value = queryString(route.query, 'q');
  void reset();
}, { immediate: true });

onMounted(async () => {
  try {
    const [categoryList, tagList, collectionList] = await Promise.all([
      api.listCategories(),
      api.listTags(),
      api.listCollections(),
    ]);
    categories.value = categoryList;
    tags.value = tagList;
    collections.value = collectionList;
  } catch (reason) {
    filterError.value = errorMessage(reason);
  }
});
</script>

<template>
  <PageHeader title="Repositories" lede="Mirrors held by this archive. Deleted rows stay hidden unless you include them.">
    <template #actions>
      <span v-if="refreshing" class="muted">Refreshing…</span>
      <RouterLink class="button primary" to="/import">Import</RouterLink>
    </template>
  </PageHeader>

  <div class="stack">
    <form class="filters" @submit.prevent="search">
      <label class="field grow">
        <span class="lbl">Search</span>
        <input v-model="draftQ" type="search" placeholder="Name or URL" />
      </label>
      <label class="field">
        <span class="lbl">Status</span>
        <select
          :value="queryString(route.query, 'status')"
          @change="onStatus"
        >
          <option value="">Any status</option>
          <option v-for="status in ARCHIVE_STATUSES" :key="status" :value="status">{{ status }}</option>
        </select>
      </label>
      <label class="field">
        <span class="lbl">Provider</span>
        <select
          :value="queryString(route.query, 'provider')"
          @change="onProvider"
        >
          <option value="">Any provider</option>
          <option v-for="provider in PROVIDERS" :key="provider" :value="provider">{{ providerLabel(provider) }}</option>
        </select>
      </label>
      <label class="field">
        <span class="lbl">Sort</span>
        <select
          :value="queryString(route.query, 'sort') || 'updated'"
          @change="onSort"
        >
          <option value="updated">Updated</option>
          <option value="name">Name</option>
          <option value="size">Size</option>
        </select>
      </label>
      <label class="field">
        <span class="lbl">Category</span>
        <select
          :value="queryString(route.query, 'categoryId')"
          @change="onCategory"
        >
          <option value="">Any category</option>
          <option v-for="category in categories" :key="category.id" :value="category.id">{{ category.name }}</option>
        </select>
      </label>
      <label class="field">
        <span class="lbl">Tag</span>
        <select
          :value="queryString(route.query, 'tagId')"
          @change="onTag"
        >
          <option value="">Any tag</option>
          <option v-for="tag in tags" :key="tag.id" :value="tag.id">{{ tag.name }}</option>
        </select>
      </label>
      <label class="field">
        <span class="lbl">Collection</span>
        <select
          :value="queryString(route.query, 'collectionId')"
          @change="onCollection"
        >
          <option value="">Any collection</option>
          <option v-for="collection in collections" :key="collection.id" :value="collection.id">
            {{ collection.name }}
          </option>
        </select>
      </label>
      <label class="choice">
        <input
          type="checkbox"
          :checked="queryString(route.query, 'includeDeleted') === '1' || queryString(route.query, 'includeDeleted') === 'true'"
          @change="onDeleted"
        />
        <span>Include deleted</span>
      </label>
      <button type="submit">Search</button>
    </form>

    <BannerNote v-if="filterError" tone="warn">Filters for category, tag, and collection did not load. {{ filterError }}</BannerNote>
    <BannerNote v-if="actionError" tone="danger">{{ actionError }}</BannerNote>
    <BannerNote v-if="outcome" tone="ok">
      <span v-if="outcome.jobs.length">Queued {{ outcome.jobs.length }} job(s). </span>
      <span v-if="outcome.deleted.length">Soft-deleted {{ outcome.deleted.length }}. </span>
      <span v-for="jobId in outcome.jobs" :key="jobId">
        <RouterLink :to="`/jobs/${jobId}`">{{ jobId }}</RouterLink>
      </span>
      <span v-for="record in outcome.exports" :key="record.id">
        Export {{ record.id }}
        <StatusLabel :value="record.status" />
        <a :href="api.exportDownloadUrl(record.id)">Download</a>
        <span v-if="record.error">{{ record.error }}</span>
      </span>
    </BannerNote>

    <div v-if="selected.size" class="selection">
      <span>{{ selected.size }} selected</span>
      <button type="button" :disabled="busy" @click="runBulk('sync')">Synchronize</button>
      <button type="button" :disabled="busy" @click="runBulk('verify')">Verify</button>
      <button type="button" :disabled="busy" @click="exportOpen = true">Export</button>
      <button type="button" class="danger" :disabled="busy" @click="deleteOpen = true">Delete</button>
      <button type="button" @click="selected.clear()">Clear</button>
    </div>

    <LoadingState v-if="loading && !items.length" message="Loading repositories…" />
    <ErrorState v-else-if="error && !items.length" :message="error" @retry="reset" />
    <EmptyState
      v-else-if="!items.length"
      title="No repositories match"
      detail="Change the filters, or import a URL to start an archive."
    />
    <template v-else>
      <BannerNote v-if="error" tone="danger">{{ error }}</BannerNote>
      <div class="table-wrap">
        <table class="data">
          <caption class="sr-only">Repositories</caption>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  :checked="allSelected"
                  aria-label="Select all on this page"
                  @change="toggleAll"
                />
              </th>
              <th>Name</th>
              <th>Source host</th>
              <th>Provider</th>
              <th>Status</th>
              <th>Health</th>
              <th class="right">Size</th>
              <th>Updated</th>
              <th>Components</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="repo in items" :key="repo.id">
              <td>
                <input
                  type="checkbox"
                  :checked="selected.has(repo.id)"
                  :aria-label="`Select ${repo.displayName}`"
                  @change="toggleOne(repo.id, inputChecked($event))"
                />
              </td>
              <td>
                <RouterLink :to="`/repositories/${repo.id}/overview`" :title="repo.description || repo.canonicalUrl">
                  {{ repo.displayName }}
                </RouterLink>
              </td>
              <td class="mono" :title="repo.canonicalUrl">{{ sourceHost(repo.canonicalUrl) }}</td>
              <td>{{ providerLabel(repo.provider) }}</td>
              <td><StatusLabel :value="repo.archiveStatus" /></td>
              <td><StatusLabel :value="repo.health" /></td>
              <td class="mono right">{{ formatBytes(repo.sizeBytes) }}</td>
              <td class="mono">{{ formatDate(repo.updatedAt) }}</td>
              <td><ComponentPips :components="repo.components" /></td>
            </tr>
          </tbody>
        </table>
      </div>
      <PagerBar :has-prev="hasPrev" :has-next="hasNext" :loading="loading || refreshing" @prev="prev" @next="next" />
    </template>
  </div>

  <ExportDialog v-if="exportOpen" :busy="busy" @cancel="exportOpen = false" @confirm="runBulk('export', $event)" />
  <AppDialog
    v-if="deleteOpen"
    title="Soft delete repositories"
    confirm-label="Soft delete"
    danger
    :busy="busy"
    @cancel="deleteOpen = false"
    @confirm="runBulk('delete')"
  >
    <p>{{ SOFT_DELETE_NOTE }}</p>
    <p>{{ selected.size }} repositories will be soft-deleted.</p>
  </AppDialog>
</template>
