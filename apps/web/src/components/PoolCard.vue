<script setup lang="ts">
import { computed } from 'vue';
import type { Pool } from '../api/types';
import ByteMeter from './ByteMeter.vue';
import StatusLabel from './StatusLabel.vue';
import { formatBytes, formatPercent } from '../lib/format';
import { formatDate } from '../lib/format';
import { poolHealth, poolHealthLabel, poolUsedBytes } from '../lib/pool';

const props = withDefaults(
  defineProps<{
    pool: Pool;
    compact?: boolean;
    showActions?: boolean;
    isDefault?: boolean;
  }>(),
  { compact: false, showActions: false, isDefault: false },
);

const emit = defineEmits<{ configure: []; 'migrate-to': [] }>();

const health = computed(() => poolHealth(props.pool));
const healthTone = computed(() => {
  if (health.value === 'healthy') return 'ok';
  if (health.value === 'disabled') return 'skip';
  return 'warn';
});
</script>

<template>
  <article class="panel pool-card stack" :class="{ compact }">
    <header class="cluster">
      <div class="stack" style="gap: 4px; min-width: 0; flex: 1">
        <h2 v-if="!compact" class="pool-card-title">{{ pool.name }}</h2>
        <h3 v-else class="pool-card-title">{{ pool.name }}</h3>
        <p v-if="isDefault" class="muted" style="margin: 0; font-size: 12px">Default pool</p>
      </div>
      <StatusLabel :value="healthTone" :label="poolHealthLabel(health)" />
    </header>

    <p class="pool-used mono">
      {{ formatPercent(poolUsedBytes(pool), pool.totalBytes ?? 0) }} used
      <span class="muted">· {{ formatBytes(pool.freeBytes) }} free</span>
    </p>

    <ByteMeter
      :free="pool.freeBytes"
      :total="pool.totalBytes"
      :threshold="pool.freeSpaceThresholdBytes"
    />

    <p v-if="!compact" class="mono break muted pool-path">{{ pool.rootPath }}</p>

    <p class="muted pool-meta">
      <RouterLink :to="`/storage/pools/${pool.id}`">{{ pool.repositoryCount }} repositories</RouterLink>
      <template v-if="!compact">
        · added {{ formatDate(pool.createdAt) }}
      </template>
    </p>

    <div v-if="showActions" class="cluster pool-actions">
      <RouterLink class="button-link" :to="`/storage/pools/${pool.id}`">Details</RouterLink>
      <button type="button" @click="emit('configure')">Configure</button>
      <button type="button" @click="emit('migrate-to')">Migrate here…</button>
    </div>
  </article>
</template>
