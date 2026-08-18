import {
  matchingWindows,
  resolveCommandWindow,
  windowInfoMatches,
} from "@main/app-core/window-routing.ts";
import type { WindowInfo } from "@shared/contracts/events.ts";
import { describe, expect, it } from "vitest";

function window(
  patch: Partial<WindowInfo> & Pick<WindowInfo, "id">
): WindowInfo {
  return {
    focused: false,
    recordId: `record-${patch.id}`,
    ...patch,
  };
}

describe("windowInfoMatches", () => {
  const main = window({
    electronWindowId: "1",
    id: "main",
    recordId: "record-main",
  });

  it("matches internal id, PIER_WINDOW_ID, and record UUID", () => {
    expect(windowInfoMatches(main, "main")).toBe(true);
    expect(windowInfoMatches(main, "1")).toBe(true);
    expect(windowInfoMatches(main, "record-main")).toBe(true);
    expect(windowInfoMatches(main, "9")).toBe(false);
  });
});

describe("resolveCommandWindow", () => {
  const services = {
    window: {
      list: () => [
        window({
          electronWindowId: "1",
          focused: true,
          id: "main",
          recordId: "record-main",
        }),
        window({
          electronWindowId: "2",
          id: "w-1",
          recordId: "record-w-1",
        }),
      ],
    },
  };

  it("resolves PIER_WINDOW_ID to the internal window", () => {
    expect(resolveCommandWindow("1", services).window?.id).toBe("main");
    expect(resolveCommandWindow("2", services).window?.id).toBe("w-1");
  });

  it("still resolves internal id and record UUID", () => {
    expect(resolveCommandWindow("main", services).window?.id).toBe("main");
    expect(resolveCommandWindow("record-w-1", services).window?.id).toBe("w-1");
  });

  it("rejects an unknown window id", () => {
    expect(resolveCommandWindow("9", services)).toEqual({
      error: "window not found: 9",
    });
  });

  it("filters listed windows by PIER_WINDOW_ID", () => {
    const listed = services.window.list();
    expect(matchingWindows(listed, "1").map((item) => item.id)).toEqual([
      "main",
    ]);
    expect(matchingWindows(listed, undefined)).toHaveLength(2);
  });
});
