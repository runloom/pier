import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentComposer } from "@/panel-kits/terminal/use-agent-composer.ts";

const openListeners = vi.hoisted(() => ({
  onAttach: null as null | (() => void),
  onClose: null as null | (() => void),
  onToggle: null as null | (() => void),
}));

vi.mock("@/panel-kits/terminal/use-terminal-composer-open.ts", () => ({
  useTerminalComposerOpen: (args: {
    onAttach: () => void;
    onClose: () => void;
    onToggle: () => void;
  }) => {
    openListeners.onAttach = args.onAttach;
    openListeners.onClose = args.onClose;
    openListeners.onToggle = args.onToggle;
  },
}));

vi.mock("@/stores/terminal-input-routing-slice.ts", () => ({
  requestTerminalFocusIntent: vi.fn(),
  setTerminalNativeFocusDisabled: vi.fn(),
}));

vi.mock("@/panel-kits/terminal/terminal-layout-coordinator.ts", () => ({
  pulseTerminalSurfaceSuppression: vi.fn(),
}));

describe("useAgentComposer attachRequest", () => {
  beforeEach(() => {
    openListeners.onAttach = null;
    openListeners.onClose = null;
    openListeners.onToggle = null;
  });

  function setup() {
    return renderHook(() =>
      useAgentComposer({
        activityKind: "agent",
        api: { isActive: true, setActive: vi.fn() } as never,
        hasStatusBar: false,
        panelId: "p-1",
        restored: false,
      })
    );
  }

  it("resets attachRequest when the composer is closed via toggle", () => {
    const hook = setup();
    act(() => {
      openListeners.onAttach?.();
    });
    expect(hook.result.current.attachRequest).toBe(1);
    expect(hook.result.current.composerMounted).toBe(true);

    act(() => {
      openListeners.onToggle?.();
    });
    expect(hook.result.current.composerMounted).toBe(false);
    expect(hook.result.current.attachRequest).toBe(0);
  });

  it("resets attachRequest when the composer is closed via Esc path", () => {
    const hook = setup();
    act(() => {
      openListeners.onAttach?.();
    });
    expect(hook.result.current.attachRequest).toBe(1);

    act(() => {
      openListeners.onClose?.();
    });
    expect(hook.result.current.attachRequest).toBe(0);
  });

  it("does not bump attachRequest when reopening with toggle alone", () => {
    const hook = setup();
    act(() => {
      openListeners.onAttach?.();
    });
    act(() => {
      openListeners.onToggle?.();
    });
    act(() => {
      openListeners.onToggle?.();
    });
    expect(hook.result.current.composerMounted).toBe(true);
    expect(hook.result.current.attachRequest).toBe(0);
  });
});
