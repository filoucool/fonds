<script setup lang="ts">
import { ref } from 'vue';
import { api, errorMessage } from '../../api/client';
import BannerNote from '../../components/BannerNote.vue';
import { formatBytes } from '../../lib/format';
import { useStorageContext } from './useStorageContext';

const { ctx } = useStorageContext();

const backup = ref<{ path: string; bytes: number } | null>(null);
const busy = ref(false);

async function backupSqlite() {
  ctx.setActionError(null);
  backup.value = null;
  busy.value = true;
  try {
    backup.value = await api.backupSqlite();
    ctx.setNotice('SQLite backup written on the host.');
  } catch (reason) {
    ctx.setActionError(errorMessage(reason));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="stack">
    <article class="panel stack">
      <h2 style="margin: 0">SQLite backup</h2>
      <p class="muted">
        The archive host writes a backup of the catalog database and returns its path. The file stays on the machine running Fonds.
      </p>
      <button type="button" :disabled="busy" @click="backupSqlite">Back up SQLite</button>
      <BannerNote v-if="backup" tone="ok">
        Backup written to <span class="mono break">{{ backup.path }}</span>
        ({{ formatBytes(backup.bytes) }}).
      </BannerNote>
    </article>
  </section>
</template>
