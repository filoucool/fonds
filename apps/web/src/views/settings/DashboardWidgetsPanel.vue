<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, errorMessage } from '../../api/client';
import { DASHBOARD_WIDGET_IDS, type DashboardWidgetId } from '../../api/types';
import BannerNote from '../../components/BannerNote.vue';
import ErrorState from '../../components/ErrorState.vue';
import LoadingState from '../../components/LoadingState.vue';

const widgetLabels: Record<DashboardWidgetId, string> = {
  status: 'Status',
  jobs: 'Jobs',
  due: 'Due syncs',
  attention: 'Attention',
  storage: 'Storage',
  events: 'Events',
};

const loading = ref(true);
const error = ref<string | null>(null);
const widgetError = ref('');
const widgets = ref<DashboardWidgetId[]>([...DASHBOARD_WIDGET_IDS]);

function shown(id: DashboardWidgetId): boolean {
  return widgets.value.includes(id);
}

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const settings = await api.getSettings();
    widgets.value = settings.dashboardWidgets;
  } catch (reason) {
    error.value = errorMessage(reason);
  } finally {
    loading.value = false;
  }
}

async function toggleWidget(id: DashboardWidgetId) {
  const next = shown(id) ? widgets.value.filter((item) => item !== id) : [...widgets.value, id];
  widgets.value = next;
  widgetError.value = '';
  try {
    const saved = await api.updateSettings({ dashboardWidgets: next });
    widgets.value = saved.dashboardWidgets;
  } catch (reason) {
    widgetError.value = reason instanceof Error ? reason.message : 'Could not save widgets';
    await load();
  }
}

onMounted(() => {
  void load();
});
</script>

<template>
  <section id="dashboard" class="stack">
    <h2>Dashboard</h2>
    <p class="hint">Choose which sections appear on the dashboard. Preferences are saved for this archive.</p>
    <LoadingState v-if="loading" message="Loading dashboard settings…" />
    <ErrorState v-else-if="error" :message="error" @retry="load" />
    <template v-else>
      <BannerNote v-if="widgetError" tone="danger">{{ widgetError }}</BannerNote>
      <fieldset class="panel cluster">
        <legend>Widgets</legend>
        <label v-for="id in DASHBOARD_WIDGET_IDS" :key="id" class="cluster">
          <input type="checkbox" :checked="shown(id)" @change="toggleWidget(id)" />
          <span>{{ widgetLabels[id] }}</span>
        </label>
      </fieldset>
    </template>
  </section>
</template>
