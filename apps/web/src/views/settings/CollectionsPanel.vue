<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, errorMessage } from '../../api/client';
import type { Collection } from '../../api/types';
import AppDialog from '../../components/AppDialog.vue';
import BannerNote from '../../components/BannerNote.vue';
import EmptyState from '../../components/EmptyState.vue';
import ErrorState from '../../components/ErrorState.vue';
import LoadingState from '../../components/LoadingState.vue';
import { formatDate, lines } from '../../lib/format';

const collections = ref<Collection[]>([]);
const drafts = ref<Record<string, { name: string; description: string }>>({});
const members = ref<Record<string, string>>({});
const memberNotes = ref<Record<string, string>>({});
const loading = ref(true);
const error = ref<string | null>(null);
const notice = ref('');
const busy = ref(false);
const name = ref('');
const description = ref('');
const pending = ref<Collection | null>(null);

function sync(list: Collection[]) {
  const next: typeof drafts.value = {};
  for (const collection of list) {
    next[collection.id] = { name: collection.name, description: collection.description ?? '' };
    if (!(collection.id in members.value)) members.value[collection.id] = '';
  }
  drafts.value = next;
}

async function load() {
  loading.value = true;
  error.value = null;
  try {
    collections.value = await api.listCollections();
    sync(collections.value);
  } catch (reason) {
    error.value = errorMessage(reason);
  } finally {
    loading.value = false;
  }
}

async function create() {
  if (!name.value.trim()) {
    error.value = 'Name is required.';
    return;
  }
  busy.value = true;
  error.value = null;
  try {
    await api.createCollection({ name: name.value.trim(), description: description.value.trim() || null });
    name.value = '';
    description.value = '';
    notice.value = 'Collection created.';
    await load();
  } catch (reason) {
    error.value = errorMessage(reason);
  } finally {
    busy.value = false;
  }
}

async function save(collection: Collection) {
  const draft = drafts.value[collection.id];
  if (!draft?.name.trim()) {
    error.value = 'Name is required.';
    return;
  }
  busy.value = true;
  error.value = null;
  try {
    await api.updateCollection(collection.id, {
      name: draft.name.trim(),
      description: draft.description.trim() || null,
    });
    notice.value = 'Collection saved.';
    await load();
  } catch (reason) {
    error.value = errorMessage(reason);
  } finally {
    busy.value = false;
  }
}

async function loadMembers(collection: Collection) {
  error.value = null;
  memberNotes.value[collection.id] = 'Loading members…';
  busy.value = true;
  try {
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await api.listRepositories({
        collectionId: collection.id,
        limit: 100,
        cursor,
        includeDeleted: true,
      });
      for (const item of page.items) ids.push(item.id);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    members.value[collection.id] = ids.join('\n');
    memberNotes.value[collection.id] = `${ids.length} repository ids loaded.`;
  } catch (reason) {
    error.value = errorMessage(reason);
    memberNotes.value[collection.id] = '';
  } finally {
    busy.value = false;
  }
}

async function saveMembers(collection: Collection) {
  busy.value = true;
  error.value = null;
  try {
    const repositoryIds = lines(members.value[collection.id] ?? '');
    await api.setCollectionRepositories(collection.id, repositoryIds);
    notice.value = `Replaced members of ${collection.name}.`;
    await load();
  } catch (reason) {
    error.value = errorMessage(reason);
  } finally {
    busy.value = false;
  }
}

async function remove() {
  if (!pending.value) return;
  busy.value = true;
  try {
    await api.deleteCollection(pending.value.id);
    pending.value = null;
    notice.value = 'Collection deleted.';
    await load();
  } catch (reason) {
    error.value = errorMessage(reason);
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  void load();
});
</script>

<template>
  <section id="collections" class="stack">
    <h2>Collections</h2>
    <LoadingState v-if="loading && !collections.length" message="Loading collections…" />
    <ErrorState v-else-if="error && !collections.length" :message="error" @retry="load" />
    <div v-else class="stack">
      <BannerNote v-if="error" tone="danger">{{ error }}</BannerNote>
      <BannerNote v-if="notice" tone="ok">{{ notice }}</BannerNote>
      <form class="panel form-grid" @submit.prevent="create">
        <label class="field">
          <span class="lbl">Name</span>
          <input v-model="name" type="text" />
        </label>
        <label class="field">
          <span class="lbl">Description</span>
          <input v-model="description" type="text" />
        </label>
        <div><button type="submit" class="primary" :disabled="busy">Add collection</button></div>
      </form>
      <EmptyState v-if="!collections.length" title="No collections" detail="Collections are sets of repository ids used as a list filter." />
      <article v-for="collection in collections" :key="collection.id" class="panel stack">
        <header class="cluster">
          <h3 style="margin: 0; color: var(--text)">{{ collection.name }}</h3>
          <span class="mono muted">{{ collection.repositoryCount }} repositories</span>
        </header>
        <p class="mono muted">{{ collection.id }} · {{ formatDate(collection.createdAt) }}</p>
        <template v-if="drafts[collection.id]">
          <div class="form-grid">
            <label class="field">
              <span class="lbl">Name</span>
              <input v-model="drafts[collection.id].name" type="text" />
            </label>
            <label class="field">
              <span class="lbl">Description</span>
              <input v-model="drafts[collection.id].description" type="text" />
            </label>
          </div>
          <div class="cluster">
            <button type="button" :disabled="busy" @click="save(collection)">Save</button>
            <button type="button" class="danger" :disabled="busy" @click="pending = collection">Delete</button>
          </div>
        </template>
        <label class="field">
          <span class="lbl">Repository ids</span>
          <textarea v-model="members[collection.id]" rows="5" spellcheck="false" />
          <span class="hint">One id per line. Saving replaces the membership list.</span>
        </label>
        <p v-if="memberNotes[collection.id]" class="muted">{{ memberNotes[collection.id] }}</p>
        <div class="cluster">
          <button type="button" :disabled="busy" @click="loadMembers(collection)">Load current ids</button>
          <button type="button" :disabled="busy" @click="saveMembers(collection)">Replace members</button>
        </div>
      </article>
    </div>
    <AppDialog
      v-if="pending"
      title="Delete collection"
      confirm-label="Delete"
      danger
      :busy="busy"
      @cancel="pending = null"
      @confirm="remove"
    >
      <p>Delete {{ pending.name }}? The repositories stay archived.</p>
    </AppDialog>
  </section>
</template>
