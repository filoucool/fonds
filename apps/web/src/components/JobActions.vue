<script setup lang="ts">
import type { Job } from '../api/types';
import type { JobActionName } from '../composables/useJobActions';

defineProps<{ job: Job; busy?: boolean }>();
const emit = defineEmits<{ act: [action: JobActionName] }>();
</script>

<template>
  <div class="cluster">
    <button v-if="job.state === 'running'" type="button" :disabled="busy" @click="emit('act', 'pause')">
      Pause
    </button>
    <button v-if="job.state === 'paused'" type="button" :disabled="busy" @click="emit('act', 'resume')">
      Resume
    </button>
    <button
      v-if="job.state === 'queued' || job.state === 'running' || job.state === 'paused'"
      type="button"
      class="danger"
      :disabled="busy"
      @click="emit('act', 'cancel')"
    >
      Cancel
    </button>
    <button
      v-if="job.state === 'failed' || job.state === 'cancelled' || job.state === 'partial'"
      type="button"
      :disabled="busy"
      @click="emit('act', 'retry')"
    >
      Retry
    </button>
  </div>
</template>
