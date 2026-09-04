import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppWindow } from "../../../../src/main/windows/app-window.ts";
import {
  forgetWindowOsTitle,
  guardWindowPageTitle,
  installWindowOsTitle,
  refreshWindowOsTitles,
  reportWindowDisplayDraft,
  resetWindowOsTitleForTests,
  setWindowOsTitleLocale,
  windowOsTitleOf,
} from "../../../../src/main/windows/os-title.ts";

function fakeWindow(id: number): AppWindow {
  return {
    appView: null,
    close: vi.fn(),
    destroy: vi.fn(),
    focus: vi.fn(),
    getNativeWindowHandle: () => Buffer.from("w"),
    getTitle: vi.fn(() => ""),
    host: {} as AppWindow["host"],
    id,
    isDestroyed: () => false,
    isFocused: () => false,
    isMinimized: () => false,
    moveTop: vi.fn(),
    restore: vi.fn(),
    setBackgroundColor: vi.fn(),
    setTitle: vi.fn(),
    webContents: {
      isDestroyed: () => false,
      on: vi.fn(),
      send: vi.fn(),
    } as unknown as AppWindow["webContents"],
  };
}

describe("window os title", () => {
  afterEach(() => {
    resetWindowOsTitleForTests();
  });

  it("assigns empty-window names instead of Pier", () => {
    const one = fakeWindow(1);
    const windows = new Map<string, AppWindow>([["w-1", one]]);
    installWindowOsTitle({
      getWindow: (id) => windows.get(id),
      listWindows: () => [{ id: "w-1", recordId: "r1" }],
    });
    guardWindowPageTitle(one);
    refreshWindowOsTitles();
    expect(windowOsTitleOf("w-1")).toBe("Window 1");
    expect(one.setTitle).toHaveBeenCalledWith("Window 1");
  });

  it("localizes empty-window names when the UI language changes", () => {
    const one = fakeWindow(1);
    const windows = new Map<string, AppWindow>([["w-1", one]]);
    installWindowOsTitle({
      getWindow: (id) => windows.get(id),
      listWindows: () => [{ id: "w-1", recordId: "r1" }],
    });
    refreshWindowOsTitles();
    setWindowOsTitleLocale("zh-CN");
    expect(windowOsTitleOf("w-1")).toBe("窗口 1");
    expect(one.setTitle).toHaveBeenCalledWith("窗口 1");
  });

  it("prevents page-title-updated from changing the OS title", () => {
    const one = fakeWindow(1);
    installWindowOsTitle({
      getWindow: (id) => (id === "w-1" ? one : undefined),
      listWindows: () => [{ id: "w-1", recordId: "r1" }],
    });
    guardWindowPageTitle(one);
    refreshWindowOsTitles();
    const on = one.webContents.on as ReturnType<typeof vi.fn>;
    const listener = on.mock.calls.find(
      (call) => call[0] === "page-title-updated"
    )?.[1] as ((event: { preventDefault: () => void }) => void) | undefined;
    expect(listener).toBeTypeOf("function");
    const preventDefault = vi.fn();
    listener?.({ preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(windowOsTitleOf("w-1")).toBe("Window 1");
  });

  it("qualifies colliding leaves with distinct branches", () => {
    const a = fakeWindow(1);
    const b = fakeWindow(2);
    const windows = new Map<string, AppWindow>([
      ["w-1", a],
      ["w-2", b],
    ]);
    installWindowOsTitle({
      getWindow: (id) => windows.get(id),
      listWindows: () => [
        { id: "w-1", recordId: "r1" },
        { id: "w-2", recordId: "r2" },
      ],
    });
    reportWindowDisplayDraft("w-1", "r1", {
      baseLabel: "pier",
      branch: "main",
      projectPath: "/repo/pier",
    });
    reportWindowDisplayDraft("w-2", "r2", {
      baseLabel: "pier",
      branch: "feat-a",
      projectPath: "/repo/pier",
    });
    expect(windowOsTitleOf("w-1")).toBe("pier · main");
    expect(windowOsTitleOf("w-2")).toBe("pier · feat-a");
    expect(a.setTitle).toHaveBeenCalledWith("pier · main");
    expect(b.setTitle).toHaveBeenCalledWith("pier · feat-a");
  });

  it("drops the qualifier when the colliding window closes", () => {
    const a = fakeWindow(1);
    const windows = new Map<string, AppWindow>([["w-1", a]]);
    const listed = [
      { id: "w-1", recordId: "r1" },
      { id: "w-2", recordId: "r2" },
    ];
    installWindowOsTitle({
      getWindow: (id) => windows.get(id),
      listWindows: () => listed,
    });
    reportWindowDisplayDraft("w-1", "r1", {
      baseLabel: "pier",
      branch: "main",
    });
    reportWindowDisplayDraft("w-2", "r2", {
      baseLabel: "pier",
      branch: "feat-a",
    });
    listed.splice(1, 1);
    forgetWindowOsTitle("w-2");
    expect(windowOsTitleOf("w-1")).toBe("pier");
  });
});
