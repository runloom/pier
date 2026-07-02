import type { TerminalStatusBarPrefs } from "@shared/contracts/terminal-status-bar.ts";
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
  const setItemOverride = vi.fn(
    (itemId: string, override: TerminalStatusBarPrefs["items"][string]) => {
      remote = prefsOf({ ...remote.items, [itemId]: override });
      return Promise.resolve(remote);
    }
  );
  const resetItem = vi.fn((itemId: string) => {
    const { [itemId]: _removed, ...items } = remote.items;
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
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        terminalStatusBarPrefs: {
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

  it("patchItemOverride 合成完整覆盖并在 resolve 路径同步 set", async () => {
    const { initTerminalStatusBarPrefs, useTerminalStatusBarPrefsStore } =
      await import("@/stores/terminal-status-bar-prefs.store.ts");
    await initTerminalStatusBarPrefs();
    const store = useTerminalStatusBarPrefsStore.getState();
    await store.patchItemOverride("a.b", { hidden: true });
    await useTerminalStatusBarPrefsStore
      .getState()
      .patchItemOverride("a.b", { order: 20 });
    // patch 语义:第二次保留 hidden 且叠加 order
    expect(setItemOverride).toHaveBeenLastCalledWith("a.b", {
      hidden: true,
      order: 20,
    });
    expect(
      useTerminalStatusBarPrefsStore.getState().prefs.items["a.b"]
    ).toEqual({ hidden: true, order: 20 });
  });

  it("patch 清空全部字段时改走 resetItem", async () => {
    const { initTerminalStatusBarPrefs, useTerminalStatusBarPrefsStore } =
      await import("@/stores/terminal-status-bar-prefs.store.ts");
    await initTerminalStatusBarPrefs();
    await useTerminalStatusBarPrefsStore
      .getState()
      .patchItemOverride("a.b", { hidden: true });
    await useTerminalStatusBarPrefsStore
      .getState()
      .patchItemOverride("a.b", { hidden: null });
    expect(resetItem).toHaveBeenCalledWith("a.b");
    expect(
      useTerminalStatusBarPrefsStore.getState().prefs.items["a.b"]
    ).toBeUndefined();
  });
});
