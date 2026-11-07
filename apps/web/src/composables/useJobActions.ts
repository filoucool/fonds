import { ref } from 'vue';
import { api, errorMessage } from '../api/client';

export type JobActionName = 'pause' | 'resume' | 'cancel' | 'retry';

export function useJobActions(reload: () => Promise<void>) {
  const error = ref<string | null>(null);
  const busy = ref(false);
  const cancelId = ref<string | null>(null);

  async function run(id: string, action: JobActionName): Promise<void> {
    busy.value = true;
    error.value = null;
    try {
      if (action === 'pause') await api.pauseJob(id);
      else if (action === 'resume') await api.resumeJob(id);
      else if (action === 'cancel') await api.cancelJob(id);
      else await api.retryJob(id);
      cancelId.value = null;
      await reload();
    } catch (reason) {
      error.value = errorMessage(reason);
    } finally {
      busy.value = false;
    }
  }

  function request(id: string, action: JobActionName): void {
    if (action === 'cancel') cancelId.value = id;
    else void run(id, action);
  }

  return { error, busy, cancelId, run, request };
}
