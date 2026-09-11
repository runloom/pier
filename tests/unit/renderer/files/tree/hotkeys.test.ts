import { handleFilesTreeKeyDown } from "@plugins/builtin/files/renderer/tree/hotkeys.ts";
import { describe, expect, it, vi } from "vitest";

describe("files tree hotkeys", () => {
  it("does not delete while a shadow rename input is focused", () => {
    const input = document.createElement("input");
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Backspace",
    });
    Object.defineProperty(event, "composedPath", {
      value: () => [input],
    });
    handleFilesTreeKeyDown(event, {
      context: {
        actions: { register: () => () => undefined },
        dialogs: { alert: vi.fn() },
        files: { trash: vi.fn() },
        i18n: {
          t: (_key: string, _values?: unknown, fallback?: string) =>
            fallback ?? _key,
        },
        notifications: { error: vi.fn(), success: vi.fn() },
        panels: { listInstances: () => [] },
      } as never,
      controller: {} as never,
      entriesByPath: new Map([
        ["a.ts", { kind: "file", path: "a.ts", root: "/repo" }],
      ]),
      instanceId: "tree-1",
      root: "/repo",
      selectedPaths: ["a.ts"],
      t: (_key, fallback) => fallback ?? _key,
    });
    expect(event.defaultPrevented).toBe(false);
  });

  it("ignores key repeat", () => {
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Backspace",
      repeat: true,
    });
    handleFilesTreeKeyDown(event, {
      context: {
        actions: { register: () => () => undefined },
        dialogs: { alert: vi.fn() },
        files: { trash: vi.fn() },
        i18n: {
          t: (_key: string, _values?: unknown, fallback?: string) =>
            fallback ?? _key,
        },
        notifications: { error: vi.fn(), success: vi.fn() },
        panels: { listInstances: () => [] },
      } as never,
      controller: {} as never,
      entriesByPath: new Map([
        ["a.ts", { kind: "file", path: "a.ts", root: "/repo" }],
      ]),
      instanceId: "tree-1",
      root: "/repo",
      selectedPaths: ["a.ts"],
      t: (_key, fallback) => fallback ?? _key,
    });
    expect(event.defaultPrevented).toBe(false);
  });
});
