import type { WindowInfo } from "@shared/contracts/events.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getWindowContext = vi.hoisted(() => vi.fn());
const listWindows = vi.hoisted(() => vi.fn());

vi.mock("@/lib/ipc/window-ipc.ts", () => ({
  getWindowContext,
  listWindows,
}));

function info(id: string, lastFocusedAt = 0, title?: string): WindowInfo {
  return {
    focused: false,
    id,
    lastFocusedAt,
    recordId: `record-${id}`,
    ...(title ? { title } : {}),
  };
}

describe("listOtherWindows", () => {
  beforeEach(() => {
    getWindowContext.mockReset();
    listWindows.mockReset();
    getWindowContext.mockResolvedValue({ windowId: "w-1" });
  });

  it("does not fetch panel snapshots when there is at most one other window", async () => {
    const { listOtherWindows } = await import(
      "@/components/workspace/transfer/pick-window.ts"
    );
    listWindows.mockResolvedValue([info("w-1")]);
    await expect(listOtherWindows()).resolves.toEqual([]);

    listWindows.mockResolvedValue([info("w-1"), info("w-2", 10, "codex")]);
    const options = await listOtherWindows();
    expect(options).toEqual([
      {
        id: "w-2",
        label: "codex",
        menuLabel: "codex",
        recordId: "record-w-2",
      },
    ]);
  });

  it("does not fall back to recordId when a title is missing", async () => {
    const { listOtherWindows } = await import(
      "@/components/workspace/transfer/pick-window.ts"
    );
    listWindows.mockResolvedValue([info("w-1"), info("w-2", 10)]);
    const options = await listOtherWindows();
    expect(options).toEqual([
      {
        id: "w-2",
        label: "",
        menuLabel: "",
        recordId: "record-w-2",
      },
    ]);
  });

  it("uses WindowInfo.title for two or more other windows", async () => {
    listWindows.mockResolvedValue([
      info("w-1"),
      info("w-2", 20, "pier · main"),
      info("w-3", 10, "codex"),
    ]);
    const { listOtherWindows } = await import(
      "@/components/workspace/transfer/pick-window.ts"
    );
    const options = await listOtherWindows();
    expect(options.map((option) => option.id)).toEqual(["w-2", "w-3"]);
    expect(options.map((option) => option.menuLabel)).toEqual([
      "pier · main",
      "codex",
    ]);
  });
});
