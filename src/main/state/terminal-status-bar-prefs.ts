import { join } from "node:path";
import {
  emptyTerminalStatusBarPrefs,
  type TerminalStatusBarItemOverride,
  type TerminalStatusBarItemOverridePatch,
  type TerminalStatusBarOverridePatches,
  type TerminalStatusBarPrefs,
  terminalStatusBarItemOverrideSchema,
  terminalStatusBarOverridePatchesSchema,
  terminalStatusBarPrefsSchema,
  withItemOverridePatch,
} from "@shared/contracts/terminal-status-bar.ts";
import { app } from "electron";
import {
  type DebouncedJsonStore,
  debouncedJsonStore,
} from "./debounced-store.ts";

export interface TerminalStatusBarPrefsStore {
  /**
   * F7:main 侧单线程合成 —— 读自身当前值 → withItemOverridePatch 合成 →
   * 存储/删除,全程同步在一次 DebouncedJsonStore.mutate() 回调内完成,
   * 串行 IPC 处理下天然消除 renderer 端 read-modify-write 竞态(lost update)。
   */
  applyItemOverridePatch(
    itemId: string,
    patch: TerminalStatusBarItemOverridePatch
  ): Promise<TerminalStatusBarPrefs>;
  /** F8:一次 mutate 应用全部 patch,保证批量写入原子性(全部落盘或维持原状)。 */
  applyItemOverridePatches(
    patches: TerminalStatusBarOverridePatches
  ): Promise<TerminalStatusBarPrefs>;
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

/** 单项 patch 合成:withItemOverridePatch 结果为 null 时改走删除该 key。 */
function applyPatchToState(
  state: TerminalStatusBarPrefs,
  itemId: string,
  patch: TerminalStatusBarItemOverridePatch
): TerminalStatusBarPrefs {
  const next = withItemOverridePatch(state.items[itemId], patch);
  return next === null
    ? removeItem(state, itemId)
    : { ...state, items: { ...state.items, [itemId]: next } };
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
    applyItemOverridePatch: async (itemId, patch) => {
      const s = await ensureStore();
      // s.mutate() 的回调同步执行在内存态上,await ensureStore() 之后不再有
      // 任何 await —— 两个几乎同时发起的 patch 请求在 main 单线程 IPC 处理下
      // 严格串行落到这里,天然消除 renderer 侧本地合成整体覆盖导致的
      // read-modify-write 竞态(F7)。
      return structuredClone(
        s.mutate((state) => applyPatchToState(state, itemId, patch))
      );
    },
    applyItemOverridePatches: async (patches) => {
      const parsed = terminalStatusBarOverridePatchesSchema.parse(patches);
      const s = await ensureStore();
      return structuredClone(
        s.mutate((state) => {
          let next = state;
          for (const [itemId, patch] of Object.entries(parsed)) {
            next = applyPatchToState(next, itemId, patch);
          }
          return next;
        })
      );
    },
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

export function applyTerminalStatusBarItemOverridePatch(
  itemId: string,
  patch: TerminalStatusBarItemOverridePatch
): Promise<TerminalStatusBarPrefs> {
  return getDefaultStore().applyItemOverridePatch(itemId, patch);
}

export function applyTerminalStatusBarItemOverridePatches(
  patches: TerminalStatusBarOverridePatches
): Promise<TerminalStatusBarPrefs> {
  return getDefaultStore().applyItemOverridePatches(patches);
}

export function resetTerminalStatusBarItem(
  itemId: string
): Promise<TerminalStatusBarPrefs> {
  return getDefaultStore().resetItem(itemId);
}

export function flushTerminalStatusBarPrefs(): Promise<void> {
  return getDefaultStore().flush();
}
