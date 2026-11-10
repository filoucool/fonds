<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api/client';
import BannerNote from './BannerNote.vue';

const visible = ref(false);

onMounted(() => {
  void (async () => {
    try {
      const session = await api.getAuthSession();
      visible.value = session.mode === 'trusted' && !session.authenticated;
    } catch {
      visible.value = false;
    }
  })();
});
</script>

<template>
  <BannerNote v-if="visible" tone="warn">
    Trusted network mode: anyone who can reach this port may use the API. Enable local login under Settings → Access &amp; Git when exposing beyond loopback.
  </BannerNote>
</template>
