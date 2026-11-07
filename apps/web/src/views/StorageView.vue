<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, errorMessage } from '../api/client';
import type { Pool, Settings } from '../api/types';
import BannerNote from '../components/BannerNote.vue';
import ByteMeter from '../components/ByteMeter.vue';
import EmptyState from '../components/EmptyState.vue';
import ErrorState from '../components/ErrorState.vue';
import LoadingState from '../components/LoadingState.vue';
import PageHeader from '../components/PageHeader.vue';
import StatusLabel from '../components/StatusLabel.vue';
import { BALANCING_OFF_NOTE } from '../lib/copy';
import { formatBytes, formatDate } from '../lib/format';
import { placementLabel } from '../lib/labels';
import { requireInt } from '../lib/profile';

const pools = ref<Pool[]>([]);
const settings = ref<Settings | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const actionError = ref<string | null>(null);
const notice = ref('');
const busy = ref(false);

const name = ref('');
const rootPath = ref('');
const threshold = ref('10737418240');
const acceptNew = ref(true);
const weight = ref('1');

const migrateRepo = ref('');
const destinationPoolId = ref('');
const jobId = ref('');
const backup = ref<{ path: string; bytes: number } | null>(null);
const sourcePath = ref('');

const drafts = ref<Record<string, { threshold: string; weight: string; acceptNew: boolean; enabled: boolean }>>({});

function syncDrafts(list: Pool[]) {
  const next: typeof drafts.value = {};
  for (const pool of list) {
    next[pool.id] = {
      threshold: String(pool.freeSpaceThresholdBytes),
      weight: String(pool.placementWeight),
      acceptNew: pool.acceptNew,
      enabled: pool.enabled,
    };
  }
  drafts.value = next;
}

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const [poolList, settingsResult] = await Promise.all([
      api.listPools(),
      api.getSettings().catch((reason: unknown) => {
        actionError.value = errorMessage(reason);
        return null;
      }),
    ]);
    pools.value = poolList;
    settings.value = settingsResult;
    syncDrafts(poolList);
    if (!destinationPoolId.value && poolList[0]) destinationPoolId.value = poolList[0].id;
  } catch (reason) {
    error.value = errorMessage(reason);
  } finally {
    loading.value = false;
  }
}

async function addPool() {
  actionError.value = null;
  notice.value = '';
  busy.value = true;
  try {
    if (!name.value.trim() || !rootPath.value.trim()) throw new Error('Name and root path are required.');
    await api.createPool({
      name: name.value.trim(),
      rootPath: rootPath.value.trim(),
      freeSpaceThresholdBytes: requireInt(threshold.value, 'Free-space threshold', 0),
      acceptNew: acceptNew.value,
      placementWeight: requireInt(weight.value, 'Placement weight', 0),
    });
    name.value = '';
    rootPath.value = '';
    notice.value = 'Pool added.';
    await load();
  } catch (reason) {
    actionError.value = errorMessage(reason);
  } finally {
    busy.value = false;
  }
}

async function savePool(pool: Pool) {
  const draft = drafts.value[pool.id];
  if (!draft) return;
  actionError.value = null;
  notice.value = '';
  busy.value = true;
  try {
    await api.updatePool(pool.id, {
      freeSpaceThresholdBytes: requireInt(draft.threshold, 'Free-space threshold', 0),
      placementWeight: requireInt(draft.weight, 'Placement weight', 0),
      acceptNew: draft.acceptNew,
      enabled: draft.enabled,
    });
    notice.value = `${pool.name} saved.`;
    await load();
  } catch (reason) {
    actionError.value = errorMessage(reason);
  } finally {
    busy.value = false;
  }
}

async function migrate() {
  actionError.value = null;
  jobId.value = '';
  if (!migrateRepo.value.trim() || !destinationPoolId.value) {
    actionError.value = 'Repository id and destination pool are required.';
    return;
  }
  busy.value = true;
  try {
    const result = await api.migrateRepository(migrateRepo.value.trim(), destinationPoolId.value);
    jobId.value = result.jobId;
  } catch (reason) {
    actionError.value = errorMessage(reason);
  } finally {
    busy.value = false;
  }
}

async function rebuild() {
  actionError.value = null;
  busy.value = true;
  try {
    const result = await api.rebuildCatalog();
    jobId.value = result.jobId;
    notice.value = 'Catalog rebuild queued.';
  } catch (reason) {
    actionError.value = errorMessage(reason);
  } finally {
    busy.value = false;
  }
}

async function importLocal() {
  actionError.value = null;
  if (!sourcePath.value.trim()) {
    actionError.value = 'Source path is required.';
    return;
  }
  busy.value = true;
  try {
    const result = await api.importLocalArchive(sourcePath.value.trim());
    jobId.value = result.jobId;
    notice.value = 'Local archive import queued.';
  } catch (reason) {
    actionError.value = errorMessage(reason);
  } finally {
    busy.value = false;
  }
}

async function backupSqlite() {
  actionError.value = null;
  backup.value = null;
  busy.value = true;
  try {
    backup.value = await api.backupSqlite();
  } catch (reason) {
    actionError.value = errorMessage(reason);
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  void load();
});
</script>

<template>
  <PageHeader
    title="Storage"
    lede="Pools, placement, catalog rebuild, and the SQLite backup path returned by the host."
  >
    <template #actions>
      <button type="button" :disabled="loading" @click="load">Refresh</button>
    </template>
  </PageHeader>
  <LoadingState v-if="loading && !pools.length && !error" message="Loading storage…" />
  <ErrorState v-else-if="error && !pools.length" :message="error" @retry="load" />
  <div v-else class="stack">
    <BannerNote v-if="error" tone="danger">{{ error }}</BannerNote>
    <BannerNote v-if="actionError" tone="danger">{{ actionError }}</BannerNote>
    <BannerNote v-if="notice" tone="ok">{{ notice }}</BannerNote>
    <BannerNote v-if="settings && !settings.balancingEnabled" tone="warn">
      Balancing is off. {{ BALANCING_OFF_NOTE }}
      <RouterLink :to="{ path: '/settings', hash: '#placement' }">Edit placement</RouterLink>
    </BannerNote>
    <p class="muted">
      Placement mode:
      {{ settings ? placementLabel(settings.placementMode) : 'unknown' }}.
      <RouterLink :to="{ path: '/settings', hash: '#placement' }">Edit placement policy</RouterLink>
    </p>
    <p v-if="jobId" role="status">
      Job <RouterLink :to="`/jobs/${jobId}`">{{ jobId }}</RouterLink> queued.
    </p>
    <BannerNote v-if="backup" tone="ok">
      Backup written to <span class="mono break">{{ backup.path }}</span>
      ({{ formatBytes(backup.bytes) }}).
    </BannerNote>

    <form class="panel stack" @submit.prevent="addPool">
      <h2>Add pool</h2>
      <div class="form-grid">
        <label class="field">
          <span class="lbl">Name</span>
          <input v-model="name" type="text" required />
        </label>
        <label class="field">
          <span class="lbl">Root path</span>
          <input v-model="rootPath" type="text" required class="mono" />
        </label>
        <label class="field">
          <span class="lbl">Free-space threshold bytes</span>
          <input v-model="threshold" type="text" inputmode="numeric" />
        </label>
        <label class="field">
          <span class="lbl">Placement weight</span>
          <input v-model="weight" type="text" inputmode="numeric" />
        </label>
      </div>
      <label class="choice">
        <input v-model="acceptNew" type="checkbox" />
        <span>Accept new repositories</span>
      </label>
      <div><button type="submit" class="primary" :disabled="busy">Add pool</button></div>
    </form>

    <EmptyState
      v-if="!pools.length"
      title="No storage pools"
      detail="Add a pool so new archives have a place to land."
    />
    <div v-else class="pool-grid">
      <article v-for="pool in pools" :key="pool.id" class="panel stack">
        <header class="cluster">
          <h2 style="margin: 0">{{ pool.name }}</h2>
          <StatusLabel v-if="!pool.enabled" value="paused" label="disabled" />
          <StatusLabel v-if="!pool.acceptNew" value="warning" label="closed" />
        </header>
        <p class="mono break">{{ pool.rootPath }}</p>
        <ByteMeter :free="pool.freeBytes" :total="pool.totalBytes" :threshold="pool.freeSpaceThresholdBytes" />
        <p class="muted">{{ pool.repositoryCount }} repositories · added {{ formatDate(pool.createdAt) }}</p>
        <p v-if="pool.freeBytes < pool.freeSpaceThresholdBytes" class="banner warn">
          Free space is below the threshold of {{ formatBytes(pool.freeSpaceThresholdBytes) }}.
        </p>
        <template v-if="drafts[pool.id]">
          <div class="form-grid">
            <label class="field">
              <span class="lbl">Threshold bytes</span>
              <input v-model="drafts[pool.id].threshold" type="text" inputmode="numeric" />
            </label>
            <label class="field">
              <span class="lbl">Weight</span>
              <input v-model="drafts[pool.id].weight" type="text" inputmode="numeric" />
            </label>
          </div>
          <label class="choice">
            <input v-model="drafts[pool.id].acceptNew" type="checkbox" />
            <span>Accept new</span>
          </label>
          <label class="choice">
            <input v-model="drafts[pool.id].enabled" type="checkbox" />
            <span>Enabled</span>
          </label>
          <div><button type="button" :disabled="busy" @click="savePool(pool)">Save pool</button></div>
        </template>
      </article>
    </div>

    <form class="panel stack" @submit.prevent="migrate">
      <h2>Migrate</h2>
      <p class="muted">Move one archived repository onto another pool. This queues a migrate job.</p>
      <div class="form-grid">
        <label class="field">
          <span class="lbl">Repository id</span>
          <input v-model="migrateRepo" type="text" class="mono" />
        </label>
        <label class="field">
          <span class="lbl">Destination pool</span>
          <select v-model="destinationPoolId">
            <option v-for="pool in pools" :key="pool.id" :value="pool.id">{{ pool.name }}</option>
          </select>
        </label>
      </div>
      <div><button type="submit" :disabled="busy">Migrate</button></div>
    </form>

    <section class="panel stack">
      <h2>Catalog</h2>
      <p class="muted">Rebuild reindexes archived repositories. Import reads a filesystem path on the archive host.</p>
      <div class="cluster">
        <button type="button" :disabled="busy" @click="rebuild">Rebuild catalog</button>
      </div>
      <form class="cluster" @submit.prevent="importLocal">
        <label class="field" style="flex: 1; min-width: 220px">
          <span class="lbl">Local archive path</span>
          <input v-model="sourcePath" type="text" class="mono" />
        </label>
        <button type="submit" :disabled="busy">Import local archive</button>
      </form>
    </section>

    <section class="panel stack">
      <h2>SQLite backup</h2>
      <p class="muted">The host writes a backup and returns its path. The file stays on the archive machine.</p>
      <div><button type="button" :disabled="busy" @click="backupSqlite">Back up SQLite</button></div>
    </section>
  </div>
</template>
