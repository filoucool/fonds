import type { InjectionKey, Ref } from 'vue';
import type { Pool, Settings } from '../../api/types';

export interface StorageContext {
  pools: Ref<Pool[]>;
  settings: Ref<Settings | null>;
  loading: Ref<boolean>;
  error: Ref<string | null>;
  actionError: Ref<string | null>;
  notice: Ref<string>;
  busy: Ref<boolean>;
  jobId: Ref<string>;
  reload: () => Promise<void>;
  setNotice: (text: string) => void;
  setActionError: (text: string | null) => void;
  setJobId: (id: string) => void;
}

export const storageContextKey: InjectionKey<StorageContext> = Symbol('storage');
