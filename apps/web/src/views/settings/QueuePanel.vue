<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, errorMessage } from '../../api/client';
import BannerNote from '../../components/BannerNote.vue';
import ErrorState from '../../components/ErrorState.vue';
import LoadingState from '../../components/LoadingState.vue';

const loading = ref(true);
const ready = ref(false);
const error = ref<string | null>(null);
const notice = ref('');
const busy = ref(false);
const maxConcurrentJobs = ref(2);
const maxAttempts = ref(3);
const requestTimeoutMs = ref(60000);
const gitTimeoutMs = ref(3600000);
const maxProviderPages = ref(200);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const settings = await api.getSettings();
    maxConcurrentJobs.value = settings.maxConcurrentJobs;
    maxAttempts.value = settings.maxAttempts;
    requestTimeoutMs.value = settings.requestTimeoutMs;
    gitTimeoutMs.value = settings.gitTimeoutMs;
    maxProviderPages.value = settings.maxProviderPages;
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
      maxConcurrentJobs: maxConcurrentJobs.value,
      maxAttempts: maxAttempts.value,
      requestTimeoutMs: requestTimeoutMs.value,
      gitTimeoutMs: gitTimeoutMs.value,
      maxProviderPages: maxProviderPages.value,
    });
    notice.value = 'Queue settings saved.';
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
  <section id="queue" class="stack">
    <h2>Queue</h2>
    <LoadingState v-if="loading && !ready" message="Loading queue settings…" />
    <ErrorState v-else-if="error && !ready" :message="error" @retry="load" />
    <form v-else class="panel stack" @submit.prevent="save">
      <BannerNote v-if="notice" tone="ok">{{ notice }}</BannerNote>
      <BannerNote v-if="error" tone="danger">{{ error }}</BannerNote>
      <div class="form-grid">
        <label class="field">
          <span class="lbl">Concurrent downloads</span>
          <input v-model.number="maxConcurrentJobs" type="number" min="1" max="16" required />
        </label>
        <label class="field">
          <span class="lbl">Max attempts</span>
          <input v-model.number="maxAttempts" type="number" min="1" max="10" required />
        </label>
        <label class="field">
          <span class="lbl">Request timeout (ms)</span>
          <input v-model.number="requestTimeoutMs" type="number" min="1000" required />
        </label>
        <label class="field">
          <span class="lbl">Git timeout (ms)</span>
          <input v-model.number="gitTimeoutMs" type="number" min="1000" required />
        </label>
        <label class="field">
          <span class="lbl">Max provider pages</span>
          <input v-model.number="maxProviderPages" type="number" min="1" required />
          <span class="hint">Hitting the cap leaves the component partial instead of claiming it is complete.</span>
        </label>
      </div>
      <button type="submit" class="primary" :disabled="busy">Save queue</button>
    </form>
  </section>
</template>
