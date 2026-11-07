<script setup lang="ts">
import { ref } from 'vue';
import type { ExportFormat } from '../api/types';
import AppDialog from './AppDialog.vue';

defineProps<{ busy?: boolean }>();
const emit = defineEmits<{ cancel: []; confirm: [format: ExportFormat] }>();
const format = ref<ExportFormat>('bundle');
</script>

<template>
  <AppDialog
    title="Export archive"
    confirm-label="Start export"
    :busy="busy"
    @cancel="emit('cancel')"
    @confirm="emit('confirm', format)"
  >
    <p>
      Choose bundle, directory, or package. The archive host queues a job and records an export.
    </p>
    <fieldset>
      <legend>Format</legend>
      <div class="stack">
        <label class="choice"><input v-model="format" type="radio" value="bundle" /> Bundle</label>
        <label class="choice"><input v-model="format" type="radio" value="directory" /> Directory</label>
        <label class="choice"><input v-model="format" type="radio" value="package" /> Package</label>
      </div>
    </fieldset>
  </AppDialog>
</template>
