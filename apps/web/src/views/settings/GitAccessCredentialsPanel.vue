<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, errorMessage } from '../../api/client';

const sshKeys = ref<{ id: string; label: string; fingerprint: string }[]>([]);
const tokens = ref<{ id: string; label: string; hint: string; scopes: string[] }[]>([]);
const sshLabel = ref('');
const sshKey = ref('');
const tokenLabel = ref('');
const tokenValue = ref<{ id: string; token: string; hint: string } | null>(null);
const error = ref<string | null>(null);
const busy = ref(false);

async function load() {
  sshKeys.value = await api.listSshKeys();
  tokens.value = await api.listAccessTokens();
}

async function addSsh() {
  busy.value = true;
  error.value = null;
  try {
    await api.addSshKey(sshLabel.value.trim(), sshKey.value.trim());
    sshLabel.value = '';
    sshKey.value = '';
    await load();
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}

async function addToken() {
  busy.value = true;
  error.value = null;
  try {
    tokenValue.value = await api.createAccessToken(tokenLabel.value.trim(), ['api', 'git_fetch', 'git_push']);
    tokenLabel.value = '';
    await load();
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}

async function revoke(id: string) {
  await api.revokeAccessToken(id);
  await load();
}

onMounted(() => {
  void load().catch((err) => {
    error.value = errorMessage(err);
  });
});
</script>

<template>
  <section id="git-access" class="stack">
    <h2>Git access credentials</h2>
    <p class="muted">SSH keys and HTTPS tokens for clone/push. Separate from upstream provider tokens.</p>
    <p v-if="error" class="error">{{ error }}</p>
    <h3>SSH public keys</h3>
    <ul v-if="sshKeys.length" class="list">
      <li v-for="key in sshKeys" :key="key.id">{{ key.label }} · {{ key.fingerprint }}</li>
    </ul>
    <p v-else class="muted">No SSH keys registered.</p>
    <form class="stack" @submit.prevent="addSsh">
      <input v-model="sshLabel" type="text" placeholder="Label" required />
      <textarea v-model="sshKey" rows="3" placeholder="ssh-ed25519 AAAA…" required />
      <button type="submit" :disabled="busy">Add SSH key</button>
    </form>
    <h3>Access tokens</h3>
    <ul v-if="tokens.length" class="list">
      <li v-for="token in tokens" :key="token.id">
        {{ token.label }} ({{ token.hint }}) · {{ token.scopes.join(', ') }}
        <button type="button" @click="revoke(token.id)">Revoke</button>
      </li>
    </ul>
    <p v-else class="muted">No access tokens.</p>
    <form class="stack" @submit.prevent="addToken">
      <input v-model="tokenLabel" type="text" placeholder="Token label" required />
      <button type="submit" :disabled="busy">Create token</button>
    </form>
    <p v-if="tokenValue" class="mono warn">Copy now: {{ tokenValue.token }}</p>
  </section>
</template>
