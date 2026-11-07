<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { api, errorMessage } from '../../api/client';
import type { ComponentKey, ProfileOverrides } from '../../api/types';
import BannerNote from '../../components/BannerNote.vue';
import { COMPONENT_KEYS, componentLabel } from '../../lib/labels';
import { parseByteLimit } from '../../lib/profile';
import { lines } from '../../lib/format';
import { useRepositoryContext } from './context';

type Mode = 'inherit' | 'on' | 'off';
type LimitMode = 'inherit' | 'unlimited' | 'limit';
type LimitKey = 'maxRepositoryBytes' | 'maxAssetBytes' | 'maxComponentBytes';

const limitKeys: LimitKey[] = ['maxRepositoryBytes', 'maxAssetBytes', 'maxComponentBytes'];
const limitLabels: Record<LimitKey, string> = {
  maxRepositoryBytes: 'Max repository bytes',
  maxAssetBytes: 'Max asset bytes',
  maxComponentBytes: 'Max component bytes',
};

const { repo, reload } = useRepositoryContext();
const modes = reactive<Record<ComponentKey, Mode>>(Object.fromEntries(COMPONENT_KEYS.map((key) => [key, 'inherit'])) as Record<ComponentKey, Mode>);
const limitModes = reactive<Record<LimitKey, LimitMode>>({
  maxRepositoryBytes: 'inherit',
  maxAssetBytes: 'inherit',
  maxComponentBytes: 'inherit',
});
const limitText = reactive<Record<LimitKey, string>>({
  maxRepositoryBytes: '',
  maxAssetBytes: '',
  maxComponentBytes: '',
});
const overrideExclusions = ref(false);
const exclusionText = ref('');
const error = ref<string | null>(null);
const notice = ref('');
const busy = ref(false);

function apply(overrides: ProfileOverrides | null | undefined) {
  for (const key of COMPONENT_KEYS) {
    const value = overrides?.components?.[key];
    modes[key] = value === true ? 'on' : value === false ? 'off' : 'inherit';
  }
  for (const key of limitKeys) {
    const limits = overrides?.limits;
    if (!limits || !(key in limits)) {
      limitModes[key] = 'inherit';
      limitText[key] = '';
    } else if (limits[key] == null) {
      limitModes[key] = 'unlimited';
      limitText[key] = '';
    } else {
      limitModes[key] = 'limit';
      limitText[key] = String(limits[key]);
    }
  }
  overrideExclusions.value = Array.isArray(overrides?.exclusions);
  exclusionText.value = (overrides?.exclusions ?? []).join('\n');
}

watch(repo, (value) => apply(value?.profile?.overrides), { immediate: true });

function build(): ProfileOverrides {
  const components: ProfileOverrides['components'] = {};
  for (const key of COMPONENT_KEYS) {
    if (modes[key] === 'on') components[key] = true;
    if (modes[key] === 'off') components[key] = false;
  }
  const limits: NonNullable<ProfileOverrides['limits']> = {};
  for (const key of limitKeys) {
    if (limitModes[key] === 'unlimited') limits[key] = null;
    if (limitModes[key] === 'limit') limits[key] = parseByteLimit(limitText[key], limitLabels[key]);
  }
  const overrides: ProfileOverrides = {};
  if (Object.keys(components).length) overrides.components = components;
  if (Object.keys(limits).length) overrides.limits = limits;
  if (overrideExclusions.value) overrides.exclusions = lines(exclusionText.value);
  return overrides;
}

async function save() {
  if (!repo.value) return;
  error.value = null;
  notice.value = '';
  busy.value = true;
  try {
    const next = build();
    const empty = !next.components && !next.limits && !next.exclusions;
    await api.updateRepository(repo.value.id, { overrides: empty ? null : next });
    notice.value = empty ? 'Overrides cleared.' : 'Overrides saved.';
    await reload();
  } catch (reason) {
    error.value = errorMessage(reason);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <form v-if="repo" class="panel stack" @submit.prevent="save">
    <h2>Overrides</h2>
    <p class="muted">
      Inherit follows the archival profile. On forces a component into the archive. Off leaves it out.
      Saving with every control set to inherit removes repository overrides.
    </p>
    <div class="table-wrap">
      <table class="data fit">
        <caption class="sr-only">Component overrides</caption>
        <thead>
          <tr><th>Component</th><th>Override</th></tr>
        </thead>
        <tbody>
          <tr v-for="key in COMPONENT_KEYS" :key="key">
            <td>{{ componentLabel(key) }}</td>
            <td>
              <select v-model="modes[key]">
                <option value="inherit">Inherit</option>
                <option value="on">On</option>
                <option value="off">Off</option>
              </select>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="form-grid">
      <div v-for="key in limitKeys" :key="key" class="stack">
        <label class="field">
          <span class="lbl">{{ limitLabels[key] }}</span>
          <select v-model="limitModes[key]">
            <option value="inherit">Inherit</option>
            <option value="unlimited">No limit</option>
            <option value="limit">Limit</option>
          </select>
        </label>
        <label v-if="limitModes[key] === 'limit'" class="field">
          <span class="lbl">Bytes</span>
          <input v-model="limitText[key]" type="text" inputmode="numeric" />
        </label>
      </div>
    </div>
    <label class="choice">
      <input v-model="overrideExclusions" type="checkbox" />
      <span>Override exclusions</span>
    </label>
    <label v-if="overrideExclusions" class="field">
      <span class="lbl">Exclusion globs</span>
      <textarea v-model="exclusionText" rows="4" spellcheck="false" />
      <span class="hint">One glob per line. An empty list clears profile exclusions for this repository.</span>
    </label>
    <div><button type="submit" :disabled="busy">Save overrides</button></div>
    <BannerNote v-if="error" tone="danger">{{ error }}</BannerNote>
    <BannerNote v-if="notice" tone="ok">{{ notice }}</BannerNote>
  </form>
</template>
