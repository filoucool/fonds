import { computed, ref, type Ref } from 'vue';
import { errorMessage } from '../api/client';
import type { Page } from '../api/types';

export function useCursorPager<T>(loader: (cursor: string | undefined) => Promise<Page<T>>) {
  const items = ref([]) as Ref<T[]>;
  const nextCursor = ref<string | null>(null);
  const cursor = ref<string | undefined>(undefined);
  const stack = ref<(string | undefined)[]>([]);
  const loading = ref(false);
  const refreshing = ref(false);
  const error = ref<string | null>(null);
  let token = 0;

  async function load(): Promise<boolean> {
    const mine = ++token;
    if (items.value.length) refreshing.value = true;
    else loading.value = true;
    error.value = null;
    try {
      const page = await loader(cursor.value);
      if (mine !== token) return false;
      items.value = page.items;
      nextCursor.value = page.nextCursor;
      return true;
    } catch (reason) {
      if (mine !== token) return false;
      error.value = errorMessage(reason);
      return false;
    } finally {
      if (mine === token) {
        loading.value = false;
        refreshing.value = false;
      }
    }
  }

  async function reset(): Promise<void> {
    cursor.value = undefined;
    stack.value = [];
    items.value = [];
    nextCursor.value = null;
    await load();
  }

  async function next(): Promise<void> {
    if (!nextCursor.value) return;
    const previous = cursor.value;
    stack.value.push(previous);
    cursor.value = nextCursor.value;
    const ok = await load();
    if (!ok) {
      stack.value.pop();
      cursor.value = previous;
    }
  }

  async function prev(): Promise<void> {
    if (!stack.value.length) return;
    const forward = cursor.value;
    const back = stack.value.pop();
    cursor.value = back;
    const ok = await load();
    if (!ok) {
      stack.value.push(back);
      cursor.value = forward;
    }
  }

  const hasPrev = computed(() => stack.value.length > 0);
  const hasNext = computed(() => nextCursor.value != null);

  return {
    items,
    nextCursor,
    loading,
    refreshing,
    error,
    load,
    reset,
    next,
    prev,
    hasPrev,
    hasNext,
  };
}
