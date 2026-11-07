import { onMounted, onUnmounted } from 'vue';

export function useInterval(fn: () => void, ms: number): void {
  let id = 0;
  onMounted(() => {
    id = window.setInterval(fn, ms);
  });
  onUnmounted(() => {
    window.clearInterval(id);
  });
}
