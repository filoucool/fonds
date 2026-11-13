<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { api, errorMessage } from '../api/client';
import PageHeader from '../components/PageHeader.vue';

const router = useRouter();
const route = useRoute();
const username = ref('');
const password = ref('');
const error = ref<string | null>(null);
const busy = ref(false);
const loading = ref(true);
const needsBootstrap = ref(false);

const title = computed(() => (needsBootstrap.value ? 'Create admin account' : 'Sign in'));
const lede = computed(() =>
  needsBootstrap.value
    ? 'No local admin exists yet. Create the first account to enable password sign-in.'
    : 'Local account required when trusted-network auth is disabled.',
);
const submitLabel = computed(() => (needsBootstrap.value ? 'Create admin' : 'Sign in'));

async function redirectAfterAuth() {
  const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/dashboard';
  await router.push(redirect);
}

async function submit() {
  busy.value = true;
  error.value = null;
  try {
    const name = username.value.trim();
    if (needsBootstrap.value) {
      if (password.value.length < 12) {
        error.value = 'Password must be at least 12 characters.';
        return;
      }
      await api.bootstrapAdmin(name, password.value);
    } else {
      await api.login(name, password.value);
    }
    await redirectAfterAuth();
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  void (async () => {
    try {
      const session = await api.getAuthSession();
      if (session.authenticated) {
        await redirectAfterAuth();
        return;
      }
      needsBootstrap.value = api.bootstrapAllowed(session);
    } catch (err) {
      error.value = errorMessage(err);
    } finally {
      loading.value = false;
    }
  })();
});
</script>

<template>
  <PageHeader :title="title" :lede="lede" />
  <form v-if="!loading" class="panel stack narrow" @submit.prevent="submit">
    <p v-if="error" class="error">{{ error }}</p>
    <label>
      Username
      <input v-model="username" type="text" autocomplete="username" required />
    </label>
    <label>
      Password
      <input
        v-model="password"
        type="password"
        :autocomplete="needsBootstrap ? 'new-password' : 'current-password'"
        :minlength="needsBootstrap ? 12 : undefined"
        required
      />
    </label>
    <p v-if="needsBootstrap" class="muted">Use at least 12 characters.</p>
    <button type="submit" class="primary" :disabled="busy">{{ submitLabel }}</button>
  </form>
</template>

<style scoped>
.narrow {
  max-width: 28rem;
}
</style>
