<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, errorMessage } from '../../api/client';

const busy = ref(false);
const error = ref<string | null>(null);
const mode = ref<'trusted' | 'local' | 'oidc'>('trusted');
const publicBaseUrl = ref('');
const indexing = ref(false);

async function load() {
  const settings = await api.getSettings();
  mode.value = settings.auth?.mode ?? 'trusted';
  publicBaseUrl.value = settings.gitAccess?.publicBaseUrl ?? '';
  indexing.value = settings.search?.globalIndexingEnabled ?? false;
}

async function save() {
  busy.value = true;
  error.value = null;
  try {
    await api.updateSettings({
      auth: { mode: mode.value },
      gitAccess: { publicBaseUrl: publicBaseUrl.value.trim() || null },
      search: { globalIndexingEnabled: indexing.value },
    });
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  void load().catch((err) => {
    error.value = errorMessage(err);
  });
});
</script>

<template>
  <section id="access" class="stack">
    <h2>Access, Git &amp; search</h2>
    <p class="muted">
      Authentication defaults to trusted LAN (no login). Enable local auth via API bootstrap before switching mode.
      REST contract: <a href="/api/v1/openapi.json" target="_blank" rel="noopener">/api/v1/openapi.json</a>.
    </p>
    <p v-if="error" class="error">{{ error }}</p>
    <label>
      Auth mode
      <select v-model="mode" :disabled="busy">
        <option value="trusted">Trusted network (no login)</option>
        <option value="local">Local accounts</option>
        <option value="oidc">OpenID Connect</option>
      </select>
    </label>
    <label>
      Public base URL (for clone addresses)
      <input v-model="publicBaseUrl" type="url" placeholder="https://fonds.example" :disabled="busy" />
    </label>
    <label class="row">
      <input v-model="indexing" type="checkbox" :disabled="busy" />
      Allow global filename/source indexing (off by default)
    </label>
    <div><button type="button" class="primary" :disabled="busy" @click="save">Save access settings</button></div>
  </section>
</template>
