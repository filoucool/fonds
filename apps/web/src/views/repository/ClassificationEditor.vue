<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { api, errorMessage } from '../../api/client';
import type { Category, Tag } from '../../api/types';
import BannerNote from '../../components/BannerNote.vue';
import { useRepositoryContext } from './context';

const { repo, reload } = useRepositoryContext();
const categories = ref<Category[]>([]);
const tags = ref<Tag[]>([]);
const categoryId = ref('');
const tagIds = ref<string[]>([]);
const error = ref<string | null>(null);
const notice = ref('');
const busy = ref(false);
const loadError = ref<string | null>(null);

watch(repo, (value) => {
  categoryId.value = value?.category?.id ?? '';
  tagIds.value = (value?.tags ?? []).map((tag) => tag.id);
}, { immediate: true });

async function save() {
  if (!repo.value) return;
  error.value = null;
  notice.value = '';
  busy.value = true;
  try {
    await api.updateRepository(repo.value.id, {
      categoryId: categoryId.value || null,
      tagIds: tagIds.value,
    });
    notice.value = 'Classification saved.';
    await reload();
  } catch (reason) {
    error.value = errorMessage(reason);
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  try {
    const [categoryList, tagList] = await Promise.all([api.listCategories(), api.listTags()]);
    categories.value = categoryList;
    tags.value = tagList;
  } catch (reason) {
    loadError.value = errorMessage(reason);
  }
});
</script>

<template>
  <form v-if="repo" class="panel stack" @submit.prevent="save">
    <h2>Classification</h2>
    <BannerNote v-if="loadError" tone="warn">{{ loadError }}</BannerNote>
    <label class="field">
      <span class="lbl">Category</span>
      <select v-model="categoryId">
        <option value="">None</option>
        <option v-if="repo.category && !categories.some((item) => item.id === repo?.category?.id)" :value="repo.category?.id">
          {{ repo.category.name }}
        </option>
        <option v-for="category in categories" :key="category.id" :value="category.id">{{ category.name }}</option>
      </select>
    </label>
    <fieldset>
      <legend>Tags</legend>
      <p v-if="!tags.length" class="muted">No tags defined. Add them in Settings.</p>
      <div v-else class="check-grid">
        <label v-for="tag in tags" :key="tag.id" class="choice">
          <input v-model="tagIds" type="checkbox" :value="tag.id" />
          <span>{{ tag.name }}</span>
        </label>
      </div>
    </fieldset>
    <div><button type="submit" :disabled="busy">Save classification</button></div>
    <BannerNote v-if="error" tone="danger">{{ error }}</BannerNote>
    <BannerNote v-if="notice" tone="ok">{{ notice }}</BannerNote>
  </form>
</template>
