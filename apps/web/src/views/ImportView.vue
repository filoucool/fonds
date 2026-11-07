<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, errorMessage } from '../api/client';
import type { Category, ImportResult, SyncProfile, ArchivalProfile, Tag } from '../api/types';
import BannerNote from '../components/BannerNote.vue';
import EmptyState from '../components/EmptyState.vue';
import PageHeader from '../components/PageHeader.vue';

const profiles = ref<ArchivalProfile[]>([]);
const syncProfiles = ref<SyncProfile[]>([]);
const categories = ref<Category[]>([]);
const tags = ref<Tag[]>([]);
const optionError = ref<string | null>(null);

const url = ref('');
const displayName = ref('');
const singleProfileId = ref('');
const singleSyncId = ref('');
const singleCategoryId = ref('');
const singleTagIds = ref<string[]>([]);
const singleBusy = ref(false);
const singleError = ref<string | null>(null);
const singleResult = ref<{ id: string; name: string; jobId: string | null } | null>(null);

const text = ref('');
const listProfileId = ref('');
const listSyncId = ref('');
const listCategoryId = ref('');
const listBusy = ref(false);
const listError = ref<string | null>(null);
const importResult = ref<ImportResult | null>(null);

const csvName = ref('');
const csvText = ref('');
const csvBusy = ref(false);
const csvError = ref<string | null>(null);

async function loadOptions() {
  try {
    const [profileList, syncList, categoryList, tagList] = await Promise.all([
      api.listArchivalProfiles(),
      api.listSyncProfiles(),
      api.listCategories(),
      api.listTags(),
    ]);
    profiles.value = profileList;
    syncProfiles.value = syncList;
    categories.value = categoryList;
    tags.value = tagList;
  } catch (reason) {
    optionError.value = errorMessage(reason);
  }
}

async function submitOne() {
  singleError.value = null;
  singleResult.value = null;
  if (!url.value.trim()) {
    singleError.value = 'URL is required.';
    return;
  }
  singleBusy.value = true;
  try {
    const created = await api.createRepository({
      url: url.value.trim(),
      displayName: displayName.value.trim() || undefined,
      profileId: singleProfileId.value || undefined,
      syncProfileId: singleSyncId.value || undefined,
      categoryId: singleCategoryId.value || undefined,
      tagIds: singleTagIds.value,
    });
    singleResult.value = {
      id: created.repository.id,
      name: created.repository.displayName,
      jobId: created.jobId,
    };
    url.value = '';
    displayName.value = '';
  } catch (reason) {
    singleError.value = errorMessage(reason);
  } finally {
    singleBusy.value = false;
  }
}

async function submitText() {
  listError.value = null;
  importResult.value = null;
  if (!text.value.trim()) {
    listError.value = 'Add at least one URL.';
    return;
  }
  listBusy.value = true;
  try {
    importResult.value = await api.importRepositories({
      text: text.value,
      format: 'text',
      profileId: listProfileId.value || undefined,
      syncProfileId: listSyncId.value || undefined,
      categoryId: listCategoryId.value || undefined,
    });
  } catch (reason) {
    listError.value = errorMessage(reason);
  } finally {
    listBusy.value = false;
  }
}

async function onCsv(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  csvName.value = file.name;
  csvText.value = await file.text();
  csvError.value = null;
}

async function submitCsv() {
  csvError.value = null;
  importResult.value = null;
  if (!csvText.value) {
    csvError.value = 'Choose a CSV file first.';
    return;
  }
  csvBusy.value = true;
  try {
    importResult.value = await api.importRepositories({
      text: csvText.value,
      format: 'csv',
      profileId: listProfileId.value || undefined,
      syncProfileId: listSyncId.value || undefined,
      categoryId: listCategoryId.value || undefined,
    });
  } catch (reason) {
    csvError.value = errorMessage(reason);
  } finally {
    csvBusy.value = false;
  }
}

onMounted(() => {
  void loadOptions();
});
</script>

<template>
  <PageHeader
    title="Import"
    lede="Add one repository or a list. Lines that start with # are comments. A CSV file is sent as text with format csv."
  />
  <div class="stack">
    <BannerNote v-if="optionError" tone="warn">
      Profile and category lists did not load. You can still import without them. {{ optionError }}
    </BannerNote>

    <form class="panel stack" @submit.prevent="submitOne">
      <h2>One repository</h2>
      <label class="field">
        <span class="lbl">URL</span>
        <input v-model="url" type="url" required placeholder="https://example.com/org/repo.git" />
      </label>
      <label class="field">
        <span class="lbl">Display name</span>
        <input v-model="displayName" type="text" />
      </label>
      <div class="form-grid">
        <label class="field">
          <span class="lbl">Archival profile</span>
          <select v-model="singleProfileId">
            <option value="">Server default</option>
            <option v-for="profile in profiles" :key="profile.id" :value="profile.id">{{ profile.name }}</option>
          </select>
        </label>
        <label class="field">
          <span class="lbl">Sync profile</span>
          <select v-model="singleSyncId">
            <option value="">Server default</option>
            <option v-for="profile in syncProfiles" :key="profile.id" :value="profile.id">{{ profile.name }}</option>
          </select>
        </label>
        <label class="field">
          <span class="lbl">Category</span>
          <select v-model="singleCategoryId">
            <option value="">None</option>
            <option v-for="category in categories" :key="category.id" :value="category.id">{{ category.name }}</option>
          </select>
        </label>
      </div>
      <fieldset v-if="tags.length">
        <legend>Tags</legend>
        <div class="check-grid">
          <label v-for="tag in tags" :key="tag.id" class="choice">
            <input v-model="singleTagIds" type="checkbox" :value="tag.id" />
            <span>{{ tag.name }}</span>
          </label>
        </div>
      </fieldset>
      <div class="cluster">
        <button type="submit" class="primary" :disabled="singleBusy">Archive</button>
      </div>
      <BannerNote v-if="singleError" tone="danger">{{ singleError }}</BannerNote>
      <BannerNote v-if="singleResult" tone="ok">
        Archived
        <RouterLink :to="`/repositories/${singleResult.id}/overview`">{{ singleResult.name }}</RouterLink>
        <template v-if="singleResult.jobId">
          · job <RouterLink :to="`/jobs/${singleResult.jobId}`">{{ singleResult.jobId }}</RouterLink>
        </template>
      </BannerNote>
    </form>

    <form class="panel stack" @submit.prevent="submitText">
      <h2>URL list</h2>
      <p class="muted">One URL per line. Lines starting with # are comments and are sent through to the host.</p>
      <label class="field">
        <span class="lbl">URLs</span>
        <textarea v-model="text" rows="10" spellcheck="false" placeholder="https://github.com/org/repo" />
      </label>
      <div class="form-grid">
        <label class="field">
          <span class="lbl">Archival profile</span>
          <select v-model="listProfileId">
            <option value="">Server default</option>
            <option v-for="profile in profiles" :key="profile.id" :value="profile.id">{{ profile.name }}</option>
          </select>
        </label>
        <label class="field">
          <span class="lbl">Sync profile</span>
          <select v-model="listSyncId">
            <option value="">Server default</option>
            <option v-for="profile in syncProfiles" :key="profile.id" :value="profile.id">{{ profile.name }}</option>
          </select>
        </label>
        <label class="field">
          <span class="lbl">Category</span>
          <select v-model="listCategoryId">
            <option value="">None</option>
            <option v-for="category in categories" :key="category.id" :value="category.id">{{ category.name }}</option>
          </select>
        </label>
      </div>
      <div class="cluster">
        <button type="submit" class="primary" :disabled="listBusy">Import text</button>
        <label class="button">
          Choose CSV
          <input class="sr-only" type="file" accept=".csv,text/csv,text/plain" @change="onCsv" />
        </label>
        <button type="button" :disabled="csvBusy || !csvText" @click="submitCsv">Import CSV</button>
        <span v-if="csvName" class="mono muted">{{ csvName }} · {{ csvText.length }} characters</span>
      </div>
      <BannerNote v-if="listError || csvError" tone="danger">{{ listError || csvError }}</BannerNote>
    </form>

    <section class="stack">
      <h2>Result</h2>
      <EmptyState
        v-if="!importResult"
        title="No import result yet"
        detail="Created, duplicate, and invalid rows will be listed after a list or CSV import."
      />
      <template v-else>
        <EmptyState
          v-if="!importResult.created.length && !importResult.duplicates.length && !importResult.invalid.length"
          title="Nothing to report"
          detail="The import finished without created, duplicate, or invalid rows."
        />
        <div v-if="importResult.created.length" class="panel stack">
          <h3>Created</h3>
          <div class="table-wrap">
            <table class="data">
              <thead>
                <tr><th>URL</th><th>Repository</th><th>Job</th></tr>
              </thead>
              <tbody>
                <tr v-for="row in importResult.created" :key="row.id">
                  <td class="mono break">{{ row.url }}</td>
                  <td><RouterLink :to="`/repositories/${row.id}/overview`">{{ row.id }}</RouterLink></td>
                  <td>
                    <RouterLink v-if="row.jobId" :to="`/jobs/${row.jobId}`">{{ row.jobId }}</RouterLink>
                    <span v-else>—</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div v-if="importResult.duplicates.length" class="panel stack">
          <h3>Duplicates</h3>
          <div class="table-wrap">
            <table class="data">
              <thead>
                <tr><th>URL</th><th>Existing</th></tr>
              </thead>
              <tbody>
                <tr v-for="row in importResult.duplicates" :key="row.url + row.existingId">
                  <td class="mono break">{{ row.url }}</td>
                  <td><RouterLink :to="`/repositories/${row.existingId}/overview`">{{ row.existingId }}</RouterLink></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div v-if="importResult.invalid.length" class="panel stack">
          <h3>Invalid</h3>
          <div class="table-wrap">
            <table class="data">
              <thead>
                <tr><th>Line</th><th>URL</th><th>Error</th></tr>
              </thead>
              <tbody>
                <tr v-for="row in importResult.invalid" :key="`${row.line}-${row.url}`">
                  <td class="mono">{{ row.line }}</td>
                  <td class="mono break">{{ row.url }}</td>
                  <td>{{ row.error }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </template>
    </section>
  </div>
</template>
