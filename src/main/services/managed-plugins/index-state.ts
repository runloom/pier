import { existsSync } from "node:fs";
import { copyFile, readFile } from "node:fs/promises";
import {
  type ManagedPluginInstallIndex,
  managedPluginInstallIndexSchema,
} from "@shared/contracts/managed-plugin.ts";
import {
  type DebouncedJsonStore,
  debouncedJsonStore,
} from "../../state/debounced-store.ts";

/**
 * Persistent store for `{userData}/plugins/index.json`. Truth source for
 * managed plugin install/enable/tombstone state (design §4.3).
 *
 * The index is only written from the Electron main process; the underlying
 * `debouncedJsonStore` provides in-memory read + debounced atomic write
 * following the same pattern as `agent-accounts-state.ts` /
 * `terminal-status-bar-prefs.ts`.
 */

const DEFAULTS: ManagedPluginInstallIndex = {
  version: 1,
  plugins: {},
};

export interface ManagedPluginIndexStore {
  flush(): Promise<void>;
  get(): ManagedPluginInstallIndex;
  init(): Promise<ManagedPluginInstallIndex>;
  mutate(
    fn: (state: ManagedPluginInstallIndex) => ManagedPluginInstallIndex
  ): ManagedPluginInstallIndex;
}

export function createManagedPluginIndexStore(
  filePath: string
): ManagedPluginIndexStore {
  const store: DebouncedJsonStore<ManagedPluginInstallIndex> =
    debouncedJsonStore({
      defaults: DEFAULTS,
      filePath,
    });

  return {
    async init(): Promise<ManagedPluginInstallIndex> {
      if (existsSync(filePath)) {
        try {
          JSON.parse(await readFile(filePath, "utf8"));
        } catch (error) {
          const backupPath = `${filePath}.invalid-backup`;
          await copyFile(filePath, backupPath).catch(() => undefined);
          throw new Error(
            `managed plugin index JSON is invalid; original preserved at ${backupPath}`,
            { cause: error }
          );
        }
      }
      const raw = await store.init();
      const result = managedPluginInstallIndexSchema.safeParse(raw);
      if (!result.success) {
        const backupPath = `${filePath}.invalid-backup`;
        await copyFile(filePath, backupPath).catch(() => undefined);
        throw new Error(
          `managed plugin index schema validation failed; original preserved at ${backupPath}: ${result.error.message}`
        );
      }
      return result.data;
    },
    get: () => store.get(),
    mutate: (fn) => store.mutate(fn),
    flush: () => store.flush(),
  };
}
