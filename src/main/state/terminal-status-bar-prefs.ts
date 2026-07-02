import { join } from "node:path";
import {
  emptyTerminalStatusBarPrefs,
  type TerminalStatusBarItemOverride,
  type TerminalStatusBarPrefs,
  terminalStatusBarItemOverrideSchema,
  terminalStatusBarPrefsSchema,
} from "@shared/contracts/terminal-status-bar.ts";
import { app } from "electron";
import {
  type DebouncedJsonStore,
  debouncedJsonStore,
} from "./debounced-store.ts";

export interface TerminalStatusBarPrefsStore {
  flush(): Promise<void>;
  getAll(): Promise<TerminalStatusBarPrefs>;
  resetItem(itemId: string): Promise<TerminalStatusBarPrefs>;
  setItemOverride(
    itemId: string,
    override: TerminalStatusBarItemOverride
  ): Promise<TerminalStatusBarPrefs>;
}

function removeItem(
  state: TerminalStatusBarPrefs,
  itemId: string
): TerminalStatusBarPrefs {
  if (!(itemId in state.items)) {
    return state;
  }
  const { [itemId]: _removed, ...items } = state.items;
  return { ...state, items };
}

/**
 * 工厂按 filePath 建 store —— 单测直接注入临时路径;生产走下方默认单例
 * (userData/terminal-status-bar-prefs.json)。ensureStore 包装照抄
 * plugin-state.ts:zod 校验,损坏/不合法即重置默认。
 */
export function createTerminalStatusBarPrefsStore(
  filePath: string
): TerminalStatusBarPrefsStore {
  let store: DebouncedJsonStore<TerminalStatusBarPrefs> | undefined;

  function getStore(): DebouncedJsonStore<TerminalStatusBarPrefs> {
    if (!store) {
      store = debouncedJsonStore<TerminalStatusBarPrefs>({
        debounceMs: 500,
        defaults: emptyTerminalStatusBarPrefs(),
        filePath,
      });
    }
    return store;
  }

  async function ensureStore(): Promise<
    DebouncedJsonStore<TerminalStatusBarPrefs>
  > {
    const s = getStore();
    try {
      const raw = await s.init();
      const parsed = terminalStatusBarPrefsSchema.parse(raw);
      if (JSON.stringify(raw) !== JSON.stringify(parsed)) {
        s.replace(parsed);
      }
    } catch (err) {
      console.warn(
        "[terminal-status-bar-prefs] parse failed, resetting to defaults:",
        err
      );
      await s.clear();
      await s.init();
    }
    return s;
  }

  return {
    flush: async () => {
      const s = await ensureStore();
      await s.flush();
    },
    getAll: async () => {
      const s = await ensureStore();
      return structuredClone(s.get());
    },
    resetItem: async (itemId) => {
      const s = await ensureStore();
      return structuredClone(s.mutate((state) => removeItem(state, itemId)));
    },
    setItemOverride: async (itemId, override) => {
      const parsed = terminalStatusBarItemOverrideSchema.parse(override);
      const s = await ensureStore();
      const isEmpty =
        parsed.alignment === undefined &&
        parsed.hidden === undefined &&
        parsed.order === undefined;
      return structuredClone(
        s.mutate((state) =>
          isEmpty
            ? removeItem(state, itemId)
            : { ...state, items: { ...state.items, [itemId]: parsed } }
        )
      );
    },
  };
}

let defaultStore: TerminalStatusBarPrefsStore | undefined;

function getDefaultStore(): TerminalStatusBarPrefsStore {
  if (!defaultStore) {
    defaultStore = createTerminalStatusBarPrefsStore(
      join(app.getPath("userData"), "terminal-status-bar-prefs.json")
    );
  }
  return defaultStore;
}

export function readTerminalStatusBarPrefs(): Promise<TerminalStatusBarPrefs> {
  return getDefaultStore().getAll();
}

export function setTerminalStatusBarItemOverride(
  itemId: string,
  override: TerminalStatusBarItemOverride
): Promise<TerminalStatusBarPrefs> {
  return getDefaultStore().setItemOverride(itemId, override);
}

export function resetTerminalStatusBarItem(
  itemId: string
): Promise<TerminalStatusBarPrefs> {
  return getDefaultStore().resetItem(itemId);
}

export function flushTerminalStatusBarPrefs(): Promise<void> {
  return getDefaultStore().flush();
}
