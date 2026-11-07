<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';

const props = defineProps<{
  title: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  match?: string;
}>();
const emit = defineEmits<{ cancel: []; confirm: [] }>();

const typed = ref('');
const root = ref<HTMLElement | null>(null);
let serial = 0;
const headingId = `dlg-${++serial}-${Math.random().toString(36).slice(2, 7)}`;

const confirmDisabled = computed(() => {
  if (props.busy) return true;
  if (props.match != null && typed.value !== props.match) return true;
  return false;
});

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
      class="dialog"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="headingId"
    >
      <h2 :id="headingId">{{ title }}</h2>
      <div class="stack">
        <slot />
        <label v-if="match != null" class="field">
          <span class="lbl">Type {{ match }} to confirm</span>
          <input v-model="typed" type="text" autocomplete="off" />
        </label>
        <div class="cluster">
          <span class="spacer" />
          <button type="button" :disabled="busy" @click="emit('cancel')">Cancel</button>
          <button
            type="button"
            :class="{ danger }"
            :disabled="confirmDisabled"
            @click="emit('confirm')"
          >
            {{ confirmLabel }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
