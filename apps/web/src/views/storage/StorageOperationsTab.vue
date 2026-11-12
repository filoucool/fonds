<script setup lang="ts">
import { ref } from 'vue';
import { api, errorMessage } from '../../api/client';
import BannerNote from '../../components/BannerNote.vue';
import MigrateWizard from '../../components/MigrateWizard.vue';
import AppDialog from '../../components/AppDialog.vue';
import { useStorageContext } from './useStorageContext';

const { ctx, pools } = useStorageContext();

const migrateOpen = ref(false);
const sourcePath = ref('');
const rebuildOpen = ref(false);
const busy = ref(false);

async function importLocal() {
  ctx.setActionError(null);
  if (!sourcePath.value.trim()) {
    ctx.setActionError('Source path is required.');
    return;
  }
  busy.value = true;
  try {
    const result = await api.importLocalArchive(sourcePath.value.trim());
    ctx.setJobId(result.jobId);
    ctx.setNotice('Local archive import queued.');
    sourcePath.value = '';
  } catch (reason) {
    ctx.setActionError(errorMessage(reason));
  } finally {
    busy.value = false;
  }
}

async function rebuild() {
  busy.value = true;
  ctx.setActionError(null);
  try {
    const result = await api.rebuildCatalog();
    ctx.setJobId(result.jobId);
    ctx.setNotice('Catalog rebuild queued.');
    rebuildOpen.value = false;
  } catch (reason) {
    ctx.setActionError(errorMessage(reason));
  } finally {
    busy.value = false;
  }
}

async function onMigrated(jobId: string) {
  migrateOpen.value = false;
  ctx.setJobId(jobId);
  ctx.setNotice('Migrate job queued.');
  await ctx.reload();
}
</script>

<template>
  <section class="stack">
    <article class="panel stack">
      <h2 style="margin: 0">Migrate</h2>
      <p class="muted">Move an archived repository to another pool. This queues a migrate job on the host.</p>
      <button type="button" class="primary" :disabled="!pools.length || busy" @click="migrateOpen = true">
        Start migrate wizard
      </button>
    </article>

    <article class="panel stack">
      <h2 style="margin: 0">Catalog</h2>
      <BannerNote tone="warn">
        Rebuild reindexes every archived repository. It can take a long time on large hosts.
      </BannerNote>
      <p class="muted">Import reads a filesystem path on the archive host and queues an import job.</p>
      <div class="cluster">
        <button type="button" :disabled="busy" @click="rebuildOpen = true">Rebuild catalog…</button>
        <RouterLink to="/jobs">View jobs</RouterLink>
      </div>
      <form class="cluster" @submit.prevent="importLocal">
        <label class="field" style="flex: 1; min-width: 220px">
          <span class="lbl">Local archive path</span>
          <input v-model="sourcePath" type="text" class="mono" autocomplete="off" />
        </label>
        <button type="submit" :disabled="busy">Import local archive</button>
      </form>
    </article>
  </section>

  <MigrateWizard
    v-if="migrateOpen"
    :pools="pools"
    @cancel="migrateOpen = false"
    @migrated="onMigrated"
  />

  <AppDialog
    v-if="rebuildOpen"
    title="Rebuild catalog"
    confirm-label="Rebuild"
    :busy="busy"
    @cancel="rebuildOpen = false"
    @confirm="rebuild"
  >
    <p>Rebuild walks archives on disk and refreshes the catalog index.</p>
  </AppDialog>
</template>
