import { computed, inject } from 'vue';
import { storageContextKey } from './context';

export function useStorageContext() {
  const ctx = inject(storageContextKey);
  if (!ctx) throw new Error('Storage context is missing');
  const pools = computed(() => ctx.pools.value);
  const settings = computed(() => ctx.settings.value);
  const loading = computed(() => ctx.loading.value);
  return { ctx, pools, settings, loading };
}
