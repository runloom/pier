import type {
  TerminalStatusBarItemOverridePatch,
  TerminalStatusBarOverridePatches,
  TerminalStatusBarPrefs,
} from "@shared/contracts/terminal-status-bar.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ChangedCb = (prefs: TerminalStatusBarPrefs) => void;

function prefsOf(
  items: TerminalStatusBarPrefs["items"]
): TerminalStatusBarPrefs {
  return { items, version: 1 };
}

describe("terminal status bar prefs mirror store", () => {
  let changedCb: ChangedCb | null = null;
  let remote: TerminalStatusBarPrefs;
  const getAll = vi.fn(async () => remote);
  // F7:main 是唯一合成方 —— mock 模拟 main 侧 withItemOverridePatch 语义,
  // renderer 侧的 store 不再本地合成,只透传 patch。
  const setItemOverride = vi.fn(
    (itemId: string, patch: TerminalStatusBarItemOverridePatch) => {
      const current = remote.items[itemId];
      const alignment =
        "alignment" in patch ? patch.alignment : current?.alignment;
      const hidden = "hidden" in patch ? patch.hidden : current?.hidden;
      const order = "order" in patch ? patch.order : current?.order;
      const next: TerminalStatusBarPrefs["items"][string] = {};
      if (alignment !== null && alignment !== undefined) {
        next.alignment = alignment;
      }
      if (hidden !== null && hidden !== undefined) {
        next.hidden = hidden;
      }
      if (order !== null && order !== undefined) {
        next.order = order;
      }
      if (Object.keys(next).length === 0) {
        const { [itemId]: _removed, ...items } = remote.items;
        remote = prefsOf(items);
      } else {
        remote = prefsOf({ ...remote.items, [itemId]: next });
      }
      return Promise.resolve(remote);
    }
  );
  const resetItem = vi.fn((itemId: string) => {
    const { [itemId]: _removed, ...items } = remote.items;
    remote = prefsOf(items);
    return Promise.resolve(remote);
  });
  const applyOverrides = vi.fn((patches: TerminalStatusBarOverridePatches) => {
    let items = remote.items;
    for (const [itemId, patch] of Object.entries(patches)) {
      const current = items[itemId];
      const alignment =
        "alignment" in patch ? patch.alignment : current?.alignment;
      const hidden = "hidden" in patch ? patch.hidden : current?.hidden;
      const order = "order" in patch ? patch.order : current?.order;
      const next: TerminalStatusBarPrefs["items"][string] = {};
      if (alignment !== null && alignment !== undefined) {
        next.alignment = alignment;
      }
      if (hidden !== null && hidden !== undefined) {
        next.hidden = hidden;
      }
      if (order !== null && order !== undefined) {
        next.order = order;
      }
      if (Object.keys(next).length === 0) {
        const { [itemId]: _removed, ...rest } = items;
        items = rest;
      } else {
        items = { ...items, [itemId]: next };
      }
    }
    remote = prefsOf(items);
    return Promise.resolve(remote);
  });

  beforeEach(() => {
    vi.resetModules();
    changedCb = null;
    remote = prefsOf({});
    getAll.mockClear();
    setItemOverride.mockClear();
    resetItem.mockClear();
    applyOverrides.mockClear();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        terminalStatusBarPrefs: {
          applyOverrides,
          getAll,
          onChanged: (cb: ChangedCb) => {
            changedCb = cb;
            return () => {
              changedCb = null;
            };
          },
          resetItem,
          setItemOverride,
        },
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("init 全量拉取并置 initialized", async () => {
    remote = prefsOf({ "a.b": { hidden: true } });
    const { initTerminalStatusBarPrefs, useTerminalStatusBarPrefsStore } =
      await import("@/stores/terminal-status-bar-prefs.store.ts");
    await initTerminalStatusBarPrefs();
    expect(useTerminalStatusBarPrefsStore.getState().initialized).toBe(true);
    expect(useTerminalStatusBarPrefsStore.getState().prefs).toEqual(
      prefsOf({ "a.b": { hidden: true } })
    );
  });

  it("广播更新镜像(其它窗口来源)", async () => {
    const { initTerminalStatusBarPrefs, useTerminalStatusBarPrefsStore } =
      await import("@/stores/terminal-status-bar-prefs.store.ts");
    await initTerminalStatusBarPrefs();
    changedCb?.(prefsOf({ "x.y": { alignment: "right" } }));
    expect(
      useTerminalStatusBarPrefsStore.getState().prefs.items["x.y"]
    ).toEqual({ alignment: "right" });
  });

  it("patchItemOverride 直传 patch(不再本地合成),交给 main 侧合成", async () => {
    const { initTerminalStatusBarPrefs, useTerminalStatusBarPrefsStore } =
      await import("@/stores/terminal-status-bar-prefs.store.ts");
    await initTerminalStatusBarPrefs();
    const store = useTerminalStatusBarPrefsStore.getState();
    await store.patchItemOverride("a.b", { hidden: true });
    await useTerminalStatusBarPrefsStore
      .getState()
      .patchItemOverride("a.b", { order: 20 });
    // F7:renderer 只透传本次 patch,不再读自身 prefs 合成完整覆盖后传下去。
    expect(setItemOverride).toHaveBeenNthCalledWith(1, "a.b", {
      hidden: true,
    });
    expect(setItemOverride).toHaveBeenNthCalledWith(2, "a.b", { order: 20 });
    // main mock 模拟合成结果:两个字段都应用到远端状态(不丢字段)。
    expect(
      useTerminalStatusBarPrefsStore.getState().prefs.items["a.b"]
    ).toEqual({ hidden: true, order: 20 });
  });

  it("patch { field: null } 原样透传(不在 renderer 侧判定是否清空改走 resetItem)", async () => {
    const { initTerminalStatusBarPrefs, useTerminalStatusBarPrefsStore } =
      await import("@/stores/terminal-status-bar-prefs.store.ts");
    await initTerminalStatusBarPrefs();
    await useTerminalStatusBarPrefsStore
      .getState()
      .patchItemOverride("a.b", { hidden: true });
    await useTerminalStatusBarPrefsStore
      .getState()
      .patchItemOverride("a.b", { hidden: null });
    expect(setItemOverride).toHaveBeenLastCalledWith("a.b", { hidden: null });
    expect(resetItem).not.toHaveBeenCalled();
    expect(
      useTerminalStatusBarPrefsStore.getState().prefs.items["a.b"]
    ).toBeUndefined();
  });

  it("patchItemOverride IPC 失败时置 error 且 rethrow、prefs 不变(F9)", async () => {
    const { initTerminalStatusBarPrefs, useTerminalStatusBarPrefsStore } =
      await import("@/stores/terminal-status-bar-prefs.store.ts");
    await initTerminalStatusBarPrefs();
    const prefsBefore = useTerminalStatusBarPrefsStore.getState().prefs;
    setItemOverride.mockImplementationOnce(() =>
      Promise.reject(new Error("ipc boom"))
    );
    await expect(
      useTerminalStatusBarPrefsStore
        .getState()
        .patchItemOverride("a.b", { hidden: true })
    ).rejects.toThrow("ipc boom");
    expect(useTerminalStatusBarPrefsStore.getState().error).toBe("ipc boom");
    expect(useTerminalStatusBarPrefsStore.getState().prefs).toBe(prefsBefore);
  });

  it("resetItem IPC 失败时置 error 且 rethrow(F9)", async () => {
    const { initTerminalStatusBarPrefs, useTerminalStatusBarPrefsStore } =
      await import("@/stores/terminal-status-bar-prefs.store.ts");
    await initTerminalStatusBarPrefs();
    resetItem.mockImplementationOnce(() =>
      Promise.reject(new Error("reset boom"))
    );
    await expect(
      useTerminalStatusBarPrefsStore.getState().resetItem("a.b")
    ).rejects.toThrow("reset boom");
    expect(useTerminalStatusBarPrefsStore.getState().error).toBe("reset boom");
  });

  it("失败后成功操作会清空 error", async () => {
    const { initTerminalStatusBarPrefs, useTerminalStatusBarPrefsStore } =
      await import("@/stores/terminal-status-bar-prefs.store.ts");
    await initTerminalStatusBarPrefs();
    setItemOverride.mockImplementationOnce(() =>
      Promise.reject(new Error("ipc boom"))
    );
    await expect(
      useTerminalStatusBarPrefsStore
        .getState()
        .patchItemOverride("a.b", { hidden: true })
    ).rejects.toThrow("ipc boom");
    expect(useTerminalStatusBarPrefsStore.getState().error).toBe("ipc boom");

    await useTerminalStatusBarPrefsStore
      .getState()
      .patchItemOverride("a.b", { hidden: true });
    expect(useTerminalStatusBarPrefsStore.getState().error).toBeNull();
    expect(
      useTerminalStatusBarPrefsStore.getState().prefs.items["a.b"]
    ).toEqual({ hidden: true });
  });

  describe("applyOverrides(F8:批量原子应用,单次 IPC)", () => {
    it("一次调用透传全部 patch,resolve 后同步 prefs", async () => {
      const { initTerminalStatusBarPrefs, useTerminalStatusBarPrefsStore } =
        await import("@/stores/terminal-status-bar-prefs.store.ts");
      await initTerminalStatusBarPrefs();
      await useTerminalStatusBarPrefsStore.getState().applyOverrides({
        "a.b": { order: 0 },
        "c.d": { order: 10 },
      });
      expect(applyOverrides).toHaveBeenCalledTimes(1);
      expect(applyOverrides).toHaveBeenCalledWith({
        "a.b": { order: 0 },
        "c.d": { order: 10 },
      });
      expect(useTerminalStatusBarPrefsStore.getState().prefs).toEqual(
        prefsOf({ "a.b": { order: 0 }, "c.d": { order: 10 } })
      );
    });

    it("IPC 失败时置 error 且 rethrow(F9)", async () => {
      const { initTerminalStatusBarPrefs, useTerminalStatusBarPrefsStore } =
        await import("@/stores/terminal-status-bar-prefs.store.ts");
      await initTerminalStatusBarPrefs();
      applyOverrides.mockImplementationOnce(() =>
        Promise.reject(new Error("batch boom"))
      );
      await expect(
        useTerminalStatusBarPrefsStore
          .getState()
          .applyOverrides({ "a.b": { order: 0 } })
      ).rejects.toThrow("batch boom");
      expect(useTerminalStatusBarPrefsStore.getState().error).toBe(
        "batch boom"
      );
    });
  });
});
