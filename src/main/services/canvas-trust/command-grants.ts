import { join } from "node:path";
import {
  type CanvasCommandGrantStore,
  canvasCommandGrantStoreSchema,
  emptyCanvasCommandGrantStore,
} from "@shared/contracts/canvas-command.ts";
import { debouncedJsonStore } from "../../state/debounced-store.ts";

export function canvasCommandGrantStorePath(userDataDir: string): string {
  return join(userDataDir, "canvas-command-grants.json");
}

export interface CanvasCommandGrantKey {
  canvasPath: string;
  commandHash: string;
  key: string;
  projectRootPath: string;
}

export interface CanvasCommandGrantService {
  flush(): Promise<void>;
  matches(input: CanvasCommandGrantKey): Promise<boolean>;
  remember(input: CanvasCommandGrantKey): Promise<void>;
}

function grantId(
  projectRootKey: string,
  canvasPath: string,
  key: string
): string {
  return `${projectRootKey}\0${canvasPath}\0${key}`;
}

export function createCanvasCommandGrantService(options: {
  canonicalizeProjectRootKey: (
    projectRootPath: string
  ) => Promise<string | null>;
  now?: () => Date;
  userDataDir: string;
}): CanvasCommandGrantService {
  const canonicalize = options.canonicalizeProjectRootKey;
  const now = options.now ?? (() => new Date());
  const store = debouncedJsonStore<CanvasCommandGrantStore>({
    defaults: emptyCanvasCommandGrantStore(),
    filePath: canvasCommandGrantStorePath(options.userDataDir),
  });

  const ensureStore = async (): Promise<CanvasCommandGrantStore> => {
    const loaded = await store.init();
    const parsed = canvasCommandGrantStoreSchema.safeParse(loaded);
    if (parsed.success) {
      return parsed.data;
    }
    return store.replace(emptyCanvasCommandGrantStore());
  };

  return {
    async matches(input) {
      const state = await ensureStore();
      const rootKey = await canonicalize(input.projectRootPath);
      if (!rootKey) {
        return false;
      }
      const entry = state.grants[grantId(rootKey, input.canvasPath, input.key)];
      return entry?.commandHash === input.commandHash;
    },

    async remember(input) {
      await ensureStore();
      const rootKey = await canonicalize(input.projectRootPath);
      if (!rootKey) {
        throw new Error("canvas command: project root could not be resolved");
      }
      const id = grantId(rootKey, input.canvasPath, input.key);
      store.mutate((current) => ({
        ...current,
        grants: {
          ...current.grants,
          [id]: {
            commandHash: input.commandHash,
            grantedAt: now().toISOString(),
          },
        },
      }));
    },

    async flush() {
      await store.flush();
    },
  };
}
