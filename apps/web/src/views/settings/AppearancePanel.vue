<script setup lang="ts">
import { ref } from 'vue';
import { THEMES, loadTheme, saveTheme, type ThemeId } from '../../lib/themes';

const current = ref<ThemeId>(loadTheme());

function choose(id: ThemeId) {
  current.value = id;
  saveTheme(id);
}
</script>

<template>
  <section id="appearance" class="stack">
    <h2>Appearance</h2>
    <p class="hint">Color themes stay on this browser. They are the colors of an old library, not a new product site.</p>
    <div class="theme-grid" role="radiogroup" aria-label="Color theme">
      <button
        v-for="theme in THEMES"
        :key="theme.id"
        type="button"
        class="theme-card"
        role="radio"
        :aria-checked="current === theme.id"
        @click="choose(theme.id)"
      >
        <span class="theme-preview" :data-theme="theme.id" aria-hidden="true">
          <i class="bg" />
          <i class="surface" />
          <i class="brass" />
          <i class="ink" />
        </span>
        <strong>{{ theme.name }}</strong>
        <span class="hint">{{ theme.description }}</span>
      </button>
    </div>
  </section>
</template>
