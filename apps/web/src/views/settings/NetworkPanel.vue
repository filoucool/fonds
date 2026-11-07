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
const allowPrivateNetworks = ref(false);
const allowFileUrls = ref(false);
const exceptions = ref('');
const githubHosts = ref('github.com');
const gitlabHosts = ref('gitlab.com');

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const settings = await api.getSettings();
    allowPrivateNetworks.value = settings.allowPrivateNetworks;
    allowFileUrls.value = settings.allowFileUrls;
    exceptions.value = (settings.privateNetworkExceptions ?? []).join('\n');
    githubHosts.value = (settings.githubHosts ?? []).join('\n');
    gitlabHosts.value = (settings.gitlabHosts ?? []).join('\n');
    ready.value = true;
  } catch (reason) {
    error.value = errorMessage(reason);
  } finally {
    loading.value = false;
  }
}

function lines(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
}

async function save() {
  busy.value = true;
  notice.value = '';
  error.value = null;
  try {
    await api.updateSettings({
      allowPrivateNetworks: allowPrivateNetworks.value,
      allowFileUrls: allowFileUrls.value,
      privateNetworkExceptions: lines(exceptions.value),
      githubHosts: lines(githubHosts.value),
      gitlabHosts: lines(gitlabHosts.value),
    });
    notice.value = 'Network settings saved.';
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
  <section id="network" class="stack">
    <h2>Network</h2>
    <LoadingState v-if="loading && !ready" message="Loading network settings…" />
    <ErrorState v-else-if="error && !ready" :message="error" @retry="load" />
    <form v-else class="panel stack" @submit.prevent="save">
      <BannerNote v-if="notice" tone="ok">{{ notice }}</BannerNote>
      <BannerNote v-if="error" tone="danger">{{ error }}</BannerNote>
      <label class="choice">
        <input v-model="allowPrivateNetworks" type="checkbox" />
        <span>Allow private and link-local addresses</span>
      </label>
      <label class="choice">
        <input v-model="allowFileUrls" type="checkbox" />
        <span>Allow file and local-path remotes</span>
      </label>
      <p class="hint">File remotes are off by default. Turn them on only for archives you already trust on this machine.</p>
      <label class="field">
        <span class="lbl">Private network exceptions</span>
        <textarea v-model="exceptions" rows="4" spellcheck="false" />
        <span class="hint">One hostname, IP, or IPv4 CIDR per line.</span>
      </label>
      <div class="form-grid">
        <label class="field">
          <span class="lbl">GitHub hosts</span>
          <textarea v-model="githubHosts" rows="3" spellcheck="false" />
        </label>
        <label class="field">
          <span class="lbl">GitLab hosts</span>
          <textarea v-model="gitlabHosts" rows="3" spellcheck="false" />
        </label>
      </div>
      <button type="submit" class="primary" :disabled="busy">Save network</button>
    </form>
  </section>
</template>
