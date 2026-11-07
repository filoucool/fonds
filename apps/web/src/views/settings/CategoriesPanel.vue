<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, errorMessage } from '../../api/client';
import type { Category } from '../../api/types';
import BannerNote from '../../components/BannerNote.vue';
import EmptyState from '../../components/EmptyState.vue';
import ErrorState from '../../components/ErrorState.vue';
import LoadingState from '../../components/LoadingState.vue';

const items = ref<Category[]>([]);
const drafts = ref<Record<string, { name: string; description: string }>>({});
const loading = ref(true);
const error = ref<string | null>(null);
const notice = ref('');
const name = ref('');
const description = ref('');
const busy = ref(false);

function syncDrafts(list: Category[]) {
  const next: Record<string, { name: string; description: string }> = {};
  for (const item of list) next[item.id] = { name: item.name, description: item.description ?? '' };
  drafts.value = next;
}

async function load() {
  loading.value = true;
  error.value = null;
  try {
    items.value = await api.listCategories();
    syncDrafts(items.value);
  } catch (reason) {
    error.value = errorMessage(reason);
  } finally {
    loading.value = false;
  }
}

async function create() {
  busy.value = true;
  error.value = null;
  try {
    await api.createCategory({ name: name.value.trim(), description: description.value.trim() || null });
    name.value = '';
    description.value = '';
    notice.value = 'Category created.';
    await load();
  } catch (reason) {
    error.value = errorMessage(reason);
  } finally {
    busy.value = false;
  }
}

async function save(item: Category) {
  const draft = drafts.value[item.id];
  if (!draft?.name.trim()) {
    error.value = 'Name is required.';
    return;
  }
  busy.value = true;
  error.value = null;
  try {
    await api.updateCategory(item.id, {
      name: draft.name.trim(),
      description: draft.description.trim() || null,
    });
    notice.value = 'Category saved.';
    await load();
  } catch (reason) {
    error.value = errorMessage(reason);
  } finally {
    busy.value = false;
  }
}

async function remove(item: Category) {
  busy.value = true;
  error.value = null;
  try {
    await api.deleteCategory(item.id);
    notice.value = `Deleted ${item.name}.`;
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
  <section id="categories" class="stack">
    <h2>Categories</h2>
    <LoadingState v-if="loading && !items.length" message="Loading categories…" />
    <ErrorState v-else-if="error && !items.length" :message="error" @retry="load" />
    <div v-else class="stack">
      <BannerNote v-if="notice" tone="ok">{{ notice }}</BannerNote>
      <BannerNote v-if="error" tone="danger">{{ error }}</BannerNote>
      <EmptyState v-if="!items.length" title="No categories" detail="Categories are a single label on a repository." />
      <article v-for="item in items" :key="item.id" class="panel stack">
        <p class="mono muted">{{ item.id }}</p>
        <template v-if="drafts[item.id]">
          <div class="form-grid">
            <label class="field">
              <span class="lbl">Name</span>
              <input v-model="drafts[item.id].name" type="text" />
            </label>
            <label class="field">
              <span class="lbl">Description</span>
              <input v-model="drafts[item.id].description" type="text" />
            </label>
          </div>
          <div class="cluster">
            <button type="button" :disabled="busy" @click="save(item)">Save</button>
            <button type="button" class="danger" :disabled="busy" @click="remove(item)">Delete</button>
          </div>
        </template>
      </article>
      <form class="panel cluster" @submit.prevent="create">
        <label class="field">
          <span class="lbl">Name</span>
          <input v-model="name" type="text" required />
        </label>
        <label class="field">
          <span class="lbl">Description</span>
          <input v-model="description" type="text" />
        </label>
        <button type="submit" :disabled="busy">Add category</button>
      </form>
    </div>
  </section>
</template>
