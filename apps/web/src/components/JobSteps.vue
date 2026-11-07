<script setup lang="ts">
import { computed } from 'vue';
import type { JobStep } from '../api/types';
import { formatDate } from '../lib/format';
import { componentLabel } from '../lib/labels';
import ProgressBar from './ProgressBar.vue';
import StatusLabel from './StatusLabel.vue';

const props = defineProps<{ steps: JobStep[] | null | undefined }>();
const ordered = computed(() => [...(props.steps ?? [])].sort((a, b) => a.sequence - b.sequence));
</script>

<template>
  <p v-if="!ordered.length" class="muted">No steps reported.</p>
  <div v-else class="table-wrap">
    <table class="data">
      <caption class="sr-only">Job steps</caption>
      <thead>
        <tr>
          <th>#</th>
          <th>Component</th>
          <th>State</th>
          <th>Progress</th>
          <th>Started</th>
          <th>Finished</th>
          <th>Error</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="step in ordered" :key="step.id">
          <td class="mono">{{ step.sequence }}</td>
          <td>{{ componentLabel(step.component) }}</td>
          <td><StatusLabel :value="step.state" /></td>
          <td style="min-width: 160px">
            <ProgressBar :done="step.bytesDone" :total="step.bytesTotal" />
          </td>
          <td class="mono">{{ formatDate(step.startedAt) }}</td>
          <td class="mono">{{ formatDate(step.finishedAt) }}</td>
          <td>{{ step.error || '—' }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
