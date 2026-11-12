<script setup lang="ts">
import { computed } from 'vue';
import PoolCard from '../../components/PoolCard.vue';
import { formatBytes, formatPercent } from '../../lib/format';
import { placementLabel } from '../../lib/labels';
import { capacitySegments, fleetStats, poolUsedBytes, sortPools } from '../../lib/pool';
import { useStorageContext } from './useStorageContext';

const { pools, settings } = useStorageContext();

const stats = computed(() => fleetStats(pools.value));
const defaultPool = computed(() => {
  const id = settings.value?.defaultPoolId;
  if (!id) return null;
  return pools.value.find((pool) => pool.id === id) ?? null;
});
const topPools = computed(() => sortPools(pools.value, 'health').slice(0, 4));
const segments = computed(() => capacitySegments(pools.value));
</script>

<template>
  <section class="stack">
    <div v-if="pools.length" class="stat-grid">
      <article class="stat">
        <p class="stat-num">{{ formatPercent(stats.usedBytes, stats.totalBytes) }}</p>
        <p class="stat-label">Fleet used</p>
        <p class="muted">{{ formatBytes(stats.freeBytes) }} free of {{ formatBytes(stats.totalBytes) }}</p>
      </article>
      <article class="stat">
        <p class="stat-num">{{ stats.poolCount }}</p>
        <p class="stat-label">Pools</p>
        <p class="muted">{{ stats.repositoryCount }} repositories</p>
      </article>
      <article class="stat">
        <p class="stat-num">{{ stats.belowThreshold }}</p>
        <p class="stat-label">Low space</p>
        <p class="muted">Below free-space reserve</p>
      </article>
      <RouterLink class="stat" :to="{ path: '/settings', hash: '#placement' }">
        <p class="stat-num" style="font-size: 16px; font-family: var(--serif)">
          {{ settings ? placementLabel(settings.placementMode) : '—' }}
        </p>
        <p class="stat-label">Placement</p>
        <p class="muted">
          Default: {{ defaultPool?.name ?? 'None' }} ·
          {{ settings?.balancingEnabled ? 'Balancing on' : 'Balancing off' }}
        </p>
      </RouterLink>
    </div>

    <article v-if="pools.length" class="panel stack">
      <h2 style="margin: 0">Used capacity by pool</h2>
      <div class="capacity-stack" role="img" :aria-label="`Used space across ${pools.length} pools`">
        <span
          v-for="item in segments"
          :key="item.pool.id"
          class="capacity-segment"
          :title="`${item.pool.name}: ${item.share.toFixed(1)}% of archived bytes`"
          :style="{ width: `${item.share}%` }"
        />
      </div>
      <ul class="plain capacity-legend">
        <li v-for="item in segments" :key="item.pool.id">
          <span class="capacity-swatch" />
          <span>{{ item.pool.name }}</span>
          <span class="muted">{{ formatBytes(poolUsedBytes(item.pool)) }}</span>
        </li>
      </ul>
    </article>

    <section class="stack">
      <div v-if="pools.length" class="cluster">
        <h2 style="margin: 0">Pool health</h2>
        <RouterLink class="muted" to="/storage/pools">View all pools</RouterLink>
      </div>
      <div v-if="topPools.length" class="pool-grid">
        <PoolCard
          v-for="pool in topPools"
          :key="pool.id"
          :pool="pool"
          :is-default="pool.id === settings?.defaultPoolId"
        />
      </div>
      <p v-else class="muted">
        No pools yet.
        <RouterLink to="/storage/pools">Add a pool</RouterLink>
      </p>
    </section>
  </section>
</template>
