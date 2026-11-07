<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, errorMessage } from '../../api/client';
import type { Tag } from '../../api/types';
import AppDialog from '../../components/AppDialog.vue';
import BannerNote from '../../components/BannerNote.vue';
import EmptyState from '../../components/EmptyState.vue';
import ErrorState from '../../components/ErrorState.vue';
import LoadingState from '../../components/LoadingState.vue';
import { formatDate } from '../../lib/format';

const tags = ref<Tag[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const notice = ref('');
const busy = ref(false);
const name = ref('');
const pending = ref<Tag | null>(null);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    tags.value = await api.listTags();
  } catch (reason) {
    error.value = errorMessage(reason);
  } finally {
    loading.value = false;
  }
}

async function create() {
  error.value = null;
  if (!name.value.trim()) {
    error.value = 'Name is required.';
    return;
  }
  busy.value = true;
  try {
    await api.createTag({ name: name.value.trim() });
    name.value = '';
    notice.value = 'Tag created.';
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
    await api.deleteTag(pending.value.id);
    pending.value = null;
    notice.value = 'Tag deleted.';
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
  <section id="tags" class="stack">
    <h2>Tags</h2>
    <LoadingState v-if="loading && !tags.length" message="Loading tags…" />
    <ErrorState v-else-if="error && !tags.length" :message="error" @retry="load" />
    <div v-else class="stack">
      <BannerNote v-if="error" tone="danger">{{ error }}</BannerNote>
      <BannerNote v-if="notice" tone="ok">{{ notice }}</BannerNote>
      <form class="cluster" @submit.prevent="create">
        <label class="field" style="min-width: 220px">
          <span class="lbl">Name</span>
          <input v-model="name" type="text" />
        </label>
        <button type="submit" class="primary" :disabled="busy">Add tag</button>
      </form>
      <EmptyState v-if="!tags.length" title="No tags" detail="Tags can be applied when importing one repository and edited on its overview." />
      <div v-else class="table-wrap">
        <table class="data fit">
          <thead>
            <tr><th>Name</th><th>Created</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="tag in tags" :key="tag.id">
              <td>
                {{ tag.name }}
                <div class="mono muted">{{ tag.id }}</div>
              </td>
              <td class="mono">{{ formatDate(tag.createdAt) }}</td>
              <td><button type="button" class="danger" @click="pending = tag">Delete</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <AppDialog
      v-if="pending"
      title="Delete tag"
      confirm-label="Delete"
      danger
      :busy="busy"
      @cancel="pending = null"
      @confirm="remove"
    >
      <p>Delete {{ pending.name }}? It will be removed from repositories that use it.</p>
    </AppDialog>
  </section>
</template>
