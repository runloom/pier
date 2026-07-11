import i18next from "i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";

const dialogMock = vi.hoisted(() => ({ showAppAlert: vi.fn() }));

vi.mock("@/stores/app-dialog.store.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/stores/app-dialog.store.ts")>()),
  showAppAlert: dialogMock.showAppAlert,
}));

describe("terminal debug actions", () => {
  beforeEach(async () => {
    vi.resetModules();
    await initI18n();
    await i18next.changeLanguage("en");
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await i18next.changeLanguage("en");
    Reflect.deleteProperty(window, "pier");
  });

  it("registers a shortcut-only action that opens the debug window", async () => {
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        terminal: {
          openDebugWindow: vi.fn(async () => ({ ok: true })),
        },
      },
    });
    const { registerTerminalDebugActions } = await import(
      "@/lib/actions/terminal-debug-actions.ts"
    );
    const { actionRegistry } = await import("@/lib/actions/registry.ts");

    const dispose = registerTerminalDebugActions();
    try {
      const action = actionRegistry.get("pier.terminal.openDebugWindow");

      expect(action).toBeDefined();
      expect(action?.surfaces).toEqual([]);
      expect(action?.title()).toBe("Open Terminal Debug Window");

      await action?.handler();

      expect(window.pier.terminal.openDebugWindow).toHaveBeenCalledOnce();
    } finally {
      dispose();
    }
  });

  it("shows localized feedback when opening resolves with a failure", async () => {
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        terminal: {
          openDebugWindow: vi.fn(async () => ({
            error: "target window not found",
            ok: false,
          })),
        },
      },
    });
    const { registerTerminalDebugActions } = await import(
      "@/lib/actions/terminal-debug-actions.ts"
    );
    const { actionRegistry } = await import("@/lib/actions/registry.ts");
    const dispose = registerTerminalDebugActions();

    try {
      await actionRegistry.get("pier.terminal.openDebugWindow")?.handler();

      expect(dialogMock.showAppAlert).toHaveBeenCalledWith({
        body: "target window not found",
        title: "Unable to Open Terminal Debug Window",
      });
    } finally {
      dispose();
    }
  });

  it("uses the localized debug window title", async () => {
    await i18next.changeLanguage("zh-CN");
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        terminal: {
          openDebugWindow: vi.fn(async () => ({ ok: true })),
        },
      },
    });
    const { registerTerminalDebugActions } = await import(
      "@/lib/actions/terminal-debug-actions.ts"
    );
    const { actionRegistry } = await import("@/lib/actions/registry.ts");

    const dispose = registerTerminalDebugActions();
    try {
      expect(actionRegistry.get("pier.terminal.openDebugWindow")?.title()).toBe(
        "打开终端调试窗口"
      );
    } finally {
      dispose();
    }
  });
});
