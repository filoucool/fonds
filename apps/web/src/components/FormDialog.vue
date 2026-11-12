<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';

defineProps<{
  title: string;
  submitLabel?: string;
  busy?: boolean;
  primary?: boolean;
}>();
const emit = defineEmits<{ cancel: []; submit: [] }>();

const root = ref<HTMLElement | null>(null);
let serial = 0;
const headingId = `form-dlg-${++serial}-${Math.random().toString(36).slice(2, 7)}`;

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('cancel');
}

onMounted(() => {
  document.addEventListener('keydown', onKey);
  const focusable = root.value?.querySelector<HTMLElement>('input, button, select, textarea');
  focusable?.focus();
});
onUnmounted(() => document.removeEventListener('keydown', onKey));
</script>

<template>
  <div class="backdrop" @mousedown.self="emit('cancel')">
    <div
      ref="root"
      class="dialog dialog-wide"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="headingId"
    >
      <h2 :id="headingId">{{ title }}</h2>
      <form class="stack" @submit.prevent="emit('submit')">
        <slot />
        <div class="cluster">
          <span class="spacer" />
          <button type="button" :disabled="busy" @click="emit('cancel')">Cancel</button>
          <button type="submit" :class="{ primary }" :disabled="busy">
            {{ submitLabel ?? 'Save' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
