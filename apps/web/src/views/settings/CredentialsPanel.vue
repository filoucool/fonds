<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, errorMessage } from '../../api/client';
import type { CredentialSummary, Provider } from '../../api/types';
import AppDialog from '../../components/AppDialog.vue';
import BannerNote from '../../components/BannerNote.vue';
import EmptyState from '../../components/EmptyState.vue';
import ErrorState from '../../components/ErrorState.vue';
import LoadingState from '../../components/LoadingState.vue';
import { formatDate } from '../../lib/format';
import { PROVIDERS, providerLabel } from '../../lib/labels';

const credentials = ref<CredentialSummary[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const notice = ref('');
const busy = ref(false);
const provider = ref<Provider>('github');
const label = ref('');
const token = ref('');
const pending = ref<CredentialSummary | null>(null);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    credentials.value = await api.listCredentials();
  } catch (reason) {
    error.value = errorMessage(reason);
  } finally {
    loading.value = false;
  }
}

async function add() {
  error.value = null;
  notice.value = '';
  if (!label.value.trim() || !token.value) {
    error.value = 'Label and token are required.';
    return;
  }
  busy.value = true;
  try {
    await api.createCredential({
      provider: provider.value,
      label: label.value.trim(),
      token: token.value,
    });
    token.value = '';
    label.value = '';
    notice.value = 'Credential saved. The token is not shown again.';
    await load();
  } catch (reason) {
    error.value = errorMessage(reason);
  } finally {
    busy.value = false;
  }
}

async function remove() {
  if (!pending.value) return;
  busy.value = true;
  try {
    await api.deleteCredential(pending.value.id);
    pending.value = null;
    notice.value = 'Credential removed.';
    await load();
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
  <section id="credentials" class="stack">
    <h2>Credentials</h2>
    <p class="muted">Tokens are write-only. After saving, only the hint is shown.</p>
    <LoadingState v-if="loading && !credentials.length" message="Loading credentials…" />
    <ErrorState v-else-if="error && !credentials.length && !notice" :message="error" @retry="load" />
    <div v-else class="stack">
      <BannerNote v-if="error" tone="danger">{{ error }}</BannerNote>
      <BannerNote v-if="notice" tone="ok">{{ notice }}</BannerNote>
      <form class="panel stack" @submit.prevent="add">
        <div class="form-grid">
          <label class="field">
            <span class="lbl">Provider</span>
            <select v-model="provider">
              <option v-for="item in PROVIDERS" :key="item" :value="item">{{ providerLabel(item) }}</option>
            </select>
          </label>
          <label class="field">
            <span class="lbl">Label</span>
            <input v-model="label" type="text" autocomplete="off" />
          </label>
          <label class="field">
            <span class="lbl">Token</span>
            <input v-model="token" type="password" autocomplete="off" />
          </label>
        </div>
        <div><button type="submit" class="primary" :disabled="busy">Add credential</button></div>
      </form>
      <EmptyState v-if="!credentials.length" title="No credentials" detail="Add a token when a private host requires authentication. The token itself is never listed." />
      <div v-else class="table-wrap">
        <table class="data">
          <thead>
            <tr><th>Label</th><th>Provider</th><th>Hint</th><th>Created</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="item in credentials" :key="item.id">
              <td>{{ item.label }}</td>
              <td>{{ providerLabel(item.provider) }}</td>
              <td class="mono">{{ item.hint }}</td>
              <td class="mono">{{ formatDate(item.createdAt) }}</td>
              <td><button type="button" class="danger" @click="pending = item">Delete</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <AppDialog
      v-if="pending"
      title="Remove credential"
      confirm-label="Remove"
      danger
      :busy="busy"
      @cancel="pending = null"
      @confirm="remove"
    >
      <p>Remove {{ pending.label }}? The token is deleted from the archive host. Jobs that need it will fail until you add another.</p>
    </AppDialog>
  </section>
</template>
