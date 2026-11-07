<script setup lang="ts">
import { computed } from 'vue';
import { statusText, toneFor, type Tone } from '../lib/labels';

const props = defineProps<{ value: string; label?: string; tone?: Tone }>();
const resolved = computed(() => props.tone ?? toneFor(props.value));
const text = computed(() => statusText(props.label ?? props.value));
</script>

<template>
  <span class="status" :class="resolved">
    <i class="pip" aria-hidden="true" />
    <span>{{ text }}</span>
  </span>
</template>
