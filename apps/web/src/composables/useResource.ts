import { ref } from 'vue';
import { errorMessage } from '../api/client';

export function useResource<T>(loader: () => Promise<T>) {
  const data = ref<T | null>(null);
  const error = ref<string | null>(null);
  const loading = ref(false);
  const refreshing = ref(false);
  const loaded = ref(false);
  let token = 0;

  async function load(refresh = false): Promise<void> {
    const mine = ++token;
    if (refresh && loaded.value) refreshing.value = true;
    else loading.value = true;
    try {
      const result = await loader();
      if (mine !== token) return;
      data.value = result;
      error.value = null;
      loaded.value = true;
    } catch (reason) {
      if (mine !== token) return;
      error.value = errorMessage(reason);
    } finally {
      if (mine === token) {
        loading.value = false;
        refreshing.value = false;
      }
    }
  }

  return { data, error, loading, refreshing, loaded, load };
}
