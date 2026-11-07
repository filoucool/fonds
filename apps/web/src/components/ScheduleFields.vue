<script setup lang="ts">
import { ref } from 'vue';
import type { Schedule } from '../api/types';
import { requireInt } from '../lib/profile';

const props = defineProps<{ initial: Schedule }>();
const kind = ref<Schedule['kind']>(props.initial.kind);
const everySeconds = ref(props.initial.kind === 'interval' ? String(props.initial.everySeconds) : '86400');
const hour = ref('hour' in props.initial ? String(props.initial.hour) : '3');
const minute = ref('minute' in props.initial ? String(props.initial.minute) : '0');
const weekday = ref(props.initial.kind === 'weekly' ? String(props.initial.weekday) : '0');
const day = ref(props.initial.kind === 'monthly' ? String(props.initial.day) : '1');

const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function build(): Schedule {
  if (kind.value === 'manual') return { kind: 'manual' };
  if (kind.value === 'interval') {
    return { kind: 'interval', everySeconds: requireInt(everySeconds.value, 'Interval', 1) };
  }
  const hourValue = requireInt(hour.value, 'Hour', 0, 23);
  const minuteValue = requireInt(minute.value, 'Minute', 0, 59);
  if (kind.value === 'daily') return { kind: 'daily', hour: hourValue, minute: minuteValue };
  if (kind.value === 'weekly') {
    return {
      kind: 'weekly',
      weekday: requireInt(weekday.value, 'Weekday', 0, 6),
      hour: hourValue,
      minute: minuteValue,
    };
  }
  return {
    kind: 'monthly',
    day: requireInt(day.value, 'Day', 1, 31),
    hour: hourValue,
    minute: minuteValue,
  };
}

defineExpose({ build });
</script>

<template>
  <div class="stack">
    <label class="field">
      <span class="lbl">Schedule</span>
      <select v-model="kind">
        <option value="manual">Manual</option>
        <option value="interval">Interval</option>
        <option value="daily">Daily</option>
        <option value="weekly">Weekly</option>
        <option value="monthly">Monthly</option>
      </select>
    </label>
    <label v-if="kind === 'interval'" class="field">
      <span class="lbl">Every seconds</span>
      <input v-model="everySeconds" type="text" inputmode="numeric" />
    </label>
    <div v-if="kind === 'daily' || kind === 'weekly' || kind === 'monthly'" class="form-grid">
      <label v-if="kind === 'weekly'" class="field">
        <span class="lbl">Weekday</span>
        <select v-model="weekday">
          <option v-for="(name, index) in weekdays" :key="name" :value="String(index)">{{ name }}</option>
        </select>
        <span class="hint">Sunday is 0.</span>
      </label>
      <label v-if="kind === 'monthly'" class="field">
        <span class="lbl">Day of month</span>
        <input v-model="day" type="text" inputmode="numeric" />
      </label>
      <label class="field">
        <span class="lbl">Hour</span>
        <input v-model="hour" type="text" inputmode="numeric" />
        <span class="hint">0–23 in the profile timezone.</span>
      </label>
      <label class="field">
        <span class="lbl">Minute</span>
        <input v-model="minute" type="text" inputmode="numeric" />
      </label>
    </div>
  </div>
</template>
