import {
  broadcastPreferencesChanged,
  handlePreferencesChangedForWindows,
} from "@main/preferences-broadcast.ts";
import { projectPreferencesSchema } from "@shared/contracts/preferences.ts";
import { describe, expect, it, vi } from "vitest";

function createWindow(calls: string[], destroyed = false) {
  return {
    webContents: {
      isDestroyed: vi.fn(() => destroyed),
      send: vi.fn((channel: string) => {
        calls.push(channel);
      }),
    },
  };
}

describe("preferences broadcast", () => {
  it("broadcasts preference changes to every live window", () => {
    const calls: string[] = [];
    const live = createWindow(calls);
    const destroyed = createWindow(calls, true);
    const snapshot = projectPreferencesSchema.parse({ windowZoomLevel: 2 });

    broadcastPreferencesChanged([live, destroyed], snapshot);

    expect(live.webContents.send).toHaveBeenCalledWith(
      "pier:preferences:changed",
      snapshot
    );
    expect(destroyed.webContents.send).not.toHaveBeenCalled();
  });

  it("sends preference changes before applying window zoom when zoom changed", () => {
    const calls: string[] = [];
    const win = createWindow(calls);
    const snapshot = projectPreferencesSchema.parse({ windowZoomLevel: 2 });

    handlePreferencesChangedForWindows({
      applyZoomLevel: (level) => {
        calls.push(`zoom:${level}`);
      },
      changedKeys: ["windowZoomLevel"],
      listWindows: () => [win],
      snapshot,
    });

    expect(calls).toEqual(["pier:preferences:changed", "zoom:2"]);
  });

  it("does not apply window zoom when unrelated preferences changed", () => {
    const calls: string[] = [];
    const win = createWindow(calls);
    const snapshot = projectPreferencesSchema.parse({
      theme: "dark",
      windowZoomLevel: 2,
    });

    handlePreferencesChangedForWindows({
      applyZoomLevel: (level) => {
        calls.push(`zoom:${level}`);
      },
      changedKeys: ["theme"],
      listWindows: () => [win],
      snapshot,
    });

    expect(calls).toEqual(["pier:preferences:changed"]);
  });
});
