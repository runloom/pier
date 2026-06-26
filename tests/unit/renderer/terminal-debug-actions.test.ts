import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("terminal debug actions", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
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
      const action = actionRegistry.get("pier.terminal.toggleDebugOverlay");

      expect(action).toBeDefined();
      expect(action?.surfaces).toEqual([]);

      action?.handler();

      expect(window.pier.terminal.openDebugWindow).toHaveBeenCalledOnce();
    } finally {
      dispose();
    }
  });
});
