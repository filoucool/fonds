<script setup lang="ts">
import { ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { api, errorMessage } from '../api/client';
import PageHeader from '../components/PageHeader.vue';

const router = useRouter();
const route = useRoute();
const username = ref('');
const password = ref('');
const error = ref<string | null>(null);
const busy = ref(false);

async function login() {
  busy.value = true;
  error.value = null;
  try {
    await api.login(username.value.trim(), password.value);
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/dashboard';
    await router.push(redirect);
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <PageHeader title="Sign in" lede="Local account required when trusted-network auth is disabled." />
  <form class="panel stack narrow" @submit.prevent="login">
    <p v-if="error" class="error">{{ error }}</p>
    <label>
      Username
      <input v-model="username" type="text" autocomplete="username" required />
    </label>
    <label>
      Password
      <input v-model="password" type="password" autocomplete="current-password" required />
    </label>
    <button type="submit" class="primary" :disabled="busy">Sign in</button>
  </form>
</template>

<style scoped>
.narrow {
  max-width: 28rem;
}
</style>
