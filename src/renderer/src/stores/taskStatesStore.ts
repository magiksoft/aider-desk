import { createWithEqualityFn } from 'zustand/traditional';
import { devtools } from 'zustand/middleware';
import { shallow } from 'zustand/vanilla/shallow';
import { TaskStateDefinition } from '@common/types';
import { ExtensionDisplayAPI } from '@common/api';

interface TaskStatesStore {
  definitions: Map<string | undefined, TaskStateDefinition[]>;
  requests: Map<string | undefined, symbol>;
  load: (api: Pick<ExtensionDisplayAPI, 'getTaskStateDefinitions'>, projectDir?: string, force?: boolean) => Promise<void>;
}

export const useTaskStatesStore = createWithEqualityFn<TaskStatesStore>()(
  devtools(
    (set, get) => ({
      definitions: new Map(),
      requests: new Map(),
      load: async (api, projectDir, force = false) => {
        if (!force && (get().definitions.has(projectDir) || get().requests.has(projectDir))) {
          return;
        }
        const request = Symbol();
        set((state) => ({ requests: new Map(state.requests).set(projectDir, request) }));
        try {
          const definitions = await api.getTaskStateDefinitions(projectDir);
          if (get().requests.get(projectDir) === request) {
            set((state) => ({ definitions: new Map(state.definitions).set(projectDir, definitions) }));
          }
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error('Failed to load task-state definitions:', error);
        } finally {
          if (get().requests.get(projectDir) === request) {
            set((state) => {
              const requests = new Map(state.requests);
              requests.delete(projectDir);
              return { requests };
            });
          }
        }
      },
    }),
    { name: 'TaskStatesStore', enabled: import.meta.env.DEV },
  ),
  shallow,
);
