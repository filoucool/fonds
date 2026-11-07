<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, errorMessage } from '../../api/client';
import type { PlacementMode, Pool } from '../../api/types';
import BannerNote from '../../components/BannerNote.vue';
import ErrorState from '../../components/ErrorState.vue';
import LoadingState from '../../components/LoadingState.vue';

const loading = ref(true);
const ready = ref(false);
const error = ref<string | null>(null);
const notice = ref('');
const busy = ref(false);
const pools = ref<Pool[]>([]);
const placementMode = ref<PlacementMode>('most-free');
const defaultPoolId = ref('');
const balancingEnabled = ref(false);
const high = ref(0.9);
const low = ref(0.7);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const [settings, poolList] = await Promise.all([api.getSettings(), api.listPools()]);
    pools.value = poolList;
    placementMode.value = settings.placementMode;
    defaultPoolId.value = settings.defaultPoolId ?? '';
    balancingEnabled.value = settings.balancingEnabled;
    high.value = settings.balanceHighWatermarkRatio;
    low.value = settings.balanceLowWatermarkRatio;
    ready.value = true;
  } catch (reason) {
    error.value = errorMessage(reason);
  } finally {
    loading.value = false;
  }
}

async function save() {
  busy.value = true;
  notice.value = '';
  error.value = null;
  try {
    await api.updateSettings({
      placementMode: placementMode.value,
      defaultPoolId: defaultPoolId.value || null,
      balancingEnabled: balancingEnabled.value,
      balanceHighWatermarkRatio: high.value,
      balanceLowWatermarkRatio: low.value,
    });
    notice.value = 'Placement saved.';
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
  <section id="placement" class="stack">
    <h2>Placement</h2>
    <LoadingState v-if="loading && !ready" message="Loading placement…" />
    <ErrorState v-else-if="error && !ready" :message="error" @retry="load" />
    <form v-else class="panel stack" @submit.prevent="save">
      <BannerNote v-if="notice" tone="ok">{{ notice }}</BannerNote>
      <BannerNote v-if="error" tone="danger">{{ error }}</BannerNote>
      <BannerNote v-if="!balancingEnabled" tone="warn">
        Automatic moves stay disabled until balancing is on.
      </BannerNote>
      <label class="field">
        <span class="lbl">Placement mode</span>
        <select v-model="placementMode">
          <option value="most-free">Most free space</option>
          <option value="default-pool">Default pool</option>
          <option value="manual">Manual</option>
        </select>
      </label>
      <label class="field">
        <span class="lbl">Default pool</span>
        <select v-model="defaultPoolId">
          <option value="">None</option>
          <option v-for="pool in pools" :key="pool.id" :value="pool.id">{{ pool.name }}</option>
        </select>
      </label>
      <label class="choice">
        <input v-model="balancingEnabled" type="checkbox" />
        <span>Enable automatic balancing</span>
      </label>
      <div class="form-grid">
        <label class="field">
          <span class="lbl">High watermark</span>
          <input v-model.number="high" type="number" min="0.01" max="1" step="0.01" />
        </label>
        <label class="field">
          <span class="lbl">Low watermark</span>
          <input v-model.number="low" type="number" min="0.01" max="1" step="0.01" />
        </label>
      </div>
      <button type="submit" class="primary" :disabled="busy">Save placement</button>
    </form>
  </section>
</template>
