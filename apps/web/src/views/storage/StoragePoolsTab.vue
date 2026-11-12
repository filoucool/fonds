<script setup lang="ts">
import { computed, ref } from 'vue';
import EmptyState from '../../components/EmptyState.vue';
import MigrateWizard from '../../components/MigrateWizard.vue';
import PoolAddDialog from '../../components/PoolAddDialog.vue';
import PoolCard from '../../components/PoolCard.vue';
import PoolConfigureDialog from '../../components/PoolConfigureDialog.vue';
import type { Pool } from '../../api/types';
import { sortPools, type PoolSort } from '../../lib/pool';
import { useStorageContext } from './useStorageContext';

const { ctx, pools, settings } = useStorageContext();

const sort = ref<PoolSort>('health');
const addOpen = ref(false);
const configurePool = ref<Pool | null>(null);
const migrateDestinationId = ref<string | undefined>(undefined);
const migrateOpen = ref(false);

const sorted = computed(() => sortPools(pools.value, sort.value));

function openAdd() {
  addOpen.value = true;
}

async function onCreated() {
  addOpen.value = false;
  ctx.setNotice('Pool added.');
  await ctx.reload();
}

function openConfigure(pool: Pool) {
  configurePool.value = pool;
}

async function onConfigured() {
  const name = configurePool.value?.name;
  configurePool.value = null;
  if (name) ctx.setNotice(`${name} saved.`);
  await ctx.reload();
}

function openMigrate(pool: Pool) {
  migrateDestinationId.value = pool.id;
  migrateOpen.value = true;
}

async function onMigrated(jobId: string) {
  migrateOpen.value = false;
  migrateDestinationId.value = undefined;
  ctx.setJobId(jobId);
  ctx.setNotice('Migrate job queued.');
  await ctx.reload();
}

</script>

<template>
  <section class="stack">
    <div class="cluster">
      <label class="field" style="width: 180px">
        <span class="lbl">Sort</span>
        <select v-model="sort">
          <option value="health">Health</option>
          <option value="name">Name</option>
          <option value="free">Free space</option>
        </select>
      </label>
      <span class="spacer" />
      <button type="button" class="primary" @click="openAdd">Add pool</button>
    </div>

    <EmptyState
      v-if="!sorted.length"
      title="No storage pools"
      detail="Add a pool so new archives have a place to land."
    >
      <button type="button" class="primary" @click="openAdd">Add your first pool</button>
    </EmptyState>

    <div v-else class="pool-grid">
      <PoolCard
        v-for="pool in sorted"
        :key="pool.id"
        :pool="pool"
        show-actions
        :is-default="pool.id === settings?.defaultPoolId"
        @configure="openConfigure(pool)"
        @migrate-to="openMigrate(pool)"
      />
    </div>

    <PoolAddDialog v-if="addOpen" :busy="ctx.busy.value" @cancel="addOpen = false" @created="onCreated" />
    <PoolConfigureDialog
      v-if="configurePool"
      :pool="configurePool"
      :busy="ctx.busy.value"
      @cancel="configurePool = null"
      @saved="onConfigured"
    />
    <MigrateWizard
      v-if="migrateOpen"
      :pools="pools"
      :initial-destination-id="migrateDestinationId"
      @cancel="migrateOpen = false"
      @migrated="onMigrated"
    />
  </section>
</template>
