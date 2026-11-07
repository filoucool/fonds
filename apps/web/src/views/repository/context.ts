import { inject, type InjectionKey, type Ref } from 'vue';
import type { RepositoryDetail } from '../../api/types';

export interface RepositoryContext {
  repo: Ref<RepositoryDetail | null>;
  loading: Ref<boolean>;
  error: Ref<string | null>;
  reload: () => Promise<void>;
}

export const repositoryContextKey: InjectionKey<RepositoryContext> = Symbol('repository');

export function useRepositoryContext(): RepositoryContext {
  const context = inject(repositoryContextKey);
  if (!context) throw new Error('Repository view is missing its parent layout');
  return context;
}
