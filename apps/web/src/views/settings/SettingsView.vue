<script setup lang="ts">
import PageHeader from '../../components/PageHeader.vue';
import AppearancePanel from './AppearancePanel.vue';
import ArchivalProfilesPanel from './ArchivalProfilesPanel.vue';
import CategoriesPanel from './CategoriesPanel.vue';
import CollectionsPanel from './CollectionsPanel.vue';
import CredentialsPanel from './CredentialsPanel.vue';
import NetworkPanel from './NetworkPanel.vue';
import PlacementPanel from './PlacementPanel.vue';
import QueuePanel from './QueuePanel.vue';
import SyncProfilesPanel from './SyncProfilesPanel.vue';
import TagsPanel from './TagsPanel.vue';
import AccessPanel from './AccessPanel.vue';
import GitAccessCredentialsPanel from './GitAccessCredentialsPanel.vue';
</script>

<template>
  <PageHeader
    title="Settings"
    lede="Color, archival policy, schedules, credentials, network limits, queue, and placement."
  />
  <nav class="subnav" aria-label="Settings sections">
    <a href="#appearance">Appearance</a>
    <a href="#profiles">Archival profiles</a>
    <a href="#sync">Sync profiles</a>
    <a href="#credentials">Credentials</a>
    <a href="#access">Access &amp; Git</a>
    <a href="#git-access">Git credentials</a>
    <a href="#network">Network</a>
    <a href="#queue">Queue</a>
    <a href="#placement">Placement</a>
    <a href="#categories">Categories</a>
    <a href="#tags">Tags</a>
    <a href="#collections">Collections</a>
    <RouterLink to="/inventory">Inventory</RouterLink>
  </nav>
  <div class="stack">
    <AppearancePanel />
    <ArchivalProfilesPanel />
    <SyncProfilesPanel />
    <CredentialsPanel />
    <AccessPanel />
    <GitAccessCredentialsPanel />
    <NetworkPanel />
    <QueuePanel />
    <PlacementPanel />
    <CategoriesPanel />
    <TagsPanel />
    <CollectionsPanel />
  </div>
</template>
