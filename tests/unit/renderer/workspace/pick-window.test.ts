import type { WindowInfo } from "@shared/contracts/events.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getWindowContext = vi.hoisted(() => vi.fn());
const listWindows = vi.hoisted(() => vi.fn());
const panelsList = vi.hoisted(() => vi.fn());

vi.mock("i18next", () => ({
  default: {
    t: (key: string, options?: { n?: number }) => {
      if (key === "workspace.panelTransfer.windowLabel") {
        return `Window ${options?.n}`;
      }
      if (key === "workspace.panelTransfer.emptyWindowDescription") {
        return "Empty window";
      }
      if (key === "workspace.panelTransfer.sameNameIndex") {
        return ` · ${options?.n}`;
      }
      return key;
    },
  },
}));

vi.mock("@/lib/ipc/window-ipc.ts", () => ({
  getWindowContext,
  listWindows,
}));

function info(id: string, lastFocusedAt = 0): WindowInfo {
  return {
    focused: false,
    id,
    lastFocusedAt,
    recordId: `record-${id}`,
  };
}

describe("listOtherWindows", () => {
  beforeEach(() => {
    getWindowContext.mockReset();
    listWindows.mockReset();
    panelsList.mockReset();
    getWindowContext.mockResolvedValue({ windowId: "w-1" });
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        panels: { list: panelsList },
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not fetch panel snapshots when there is at most one other window", async () => {
    const { listOtherWindows } = await import(
      "@/components/workspace/transfer/pick-window.ts"
    );
    listWindows.mockResolvedValue([info("w-1")]);
    await expect(listOtherWindows()).resolves.toEqual([]);
    expect(panelsList).not.toHaveBeenCalled();

    listWindows.mockResolvedValue([info("w-1"), info("w-2", 10)]);
    const options = await listOtherWindows();
    expect(options).toEqual([
      {
        id: "w-2",
        label: "record-w-2",
        menuLabel: "record-w-2",
        recordId: "record-w-2",
      },
    ]);
    expect(panelsList).not.toHaveBeenCalled();
  });

  it("fetches panel snapshots only when two or more other windows exist", async () => {
    panelsList.mockResolvedValue({ panels: [] });
    listWindows.mockResolvedValue([
      info("w-1"),
      info("w-2", 20),
      info("w-3", 10),
    ]);
    const { listOtherWindows } = await import(
      "@/components/workspace/transfer/pick-window.ts"
    );
    const options = await listOtherWindows();
    expect(panelsList).toHaveBeenCalledOnce();
    expect(options.map((option) => option.id)).toEqual(["w-2", "w-3"]);
    expect(options.map((option) => option.menuLabel)).toEqual([
      "Window 1",
      "Window 2",
    ]);
  });

  it("falls back to numbered labels when panel listing fails", async () => {
    panelsList.mockRejectedValue(new Error("ipc down"));
    listWindows.mockResolvedValue([
      info("w-1"),
      info("w-2", 20),
      info("w-3", 10),
    ]);
    const { listOtherWindows } = await import(
      "@/components/workspace/transfer/pick-window.ts"
    );
    const options = await listOtherWindows();
    expect(options.map((option) => option.menuLabel)).toEqual([
      "Window 1",
      "Window 2",
    ]);
  });

  it("falls back to numbered labels when panel listing exceeds the budget", async () => {
    vi.useFakeTimers();
    panelsList.mockImplementation(() => new Promise(() => undefined));
    listWindows.mockResolvedValue([
      info("w-1"),
      info("w-2", 20),
      info("w-3", 10),
    ]);
    const { listOtherWindows, OTHER_WINDOW_PANEL_LABEL_TIMEOUT_MS } =
      await import("@/components/workspace/transfer/pick-window.ts");
    const pending = listOtherWindows();
    await vi.advanceTimersByTimeAsync(OTHER_WINDOW_PANEL_LABEL_TIMEOUT_MS);
    const options = await pending;
    expect(options.map((option) => option.menuLabel)).toEqual([
      "Window 1",
      "Window 2",
    ]);
  });
});
