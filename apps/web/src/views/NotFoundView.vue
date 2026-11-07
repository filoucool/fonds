<script setup lang="ts">
import { RouterLink } from 'vue-router';
</script>

<template>
  <div class="empty">
    <p class="empty-title">Not found</p>
    <p class="muted">This page is not part of the archive console.</p>
    <p style="margin-top: 8px"><RouterLink to="/dashboard">Dashboard</RouterLink></p>
  </div>
</template>
