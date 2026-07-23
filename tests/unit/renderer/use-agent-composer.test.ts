import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  TERMINAL_COMPOSER_GAP_PX,
  TERMINAL_COMPOSER_RESERVE_HEIGHT_PX,
} from "@/panel-kits/terminal/terminal-composer-helpers.ts";
import { pulseTerminalSurfaceSuppression } from "@/panel-kits/terminal/terminal-layout-coordinator.ts";
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

describe("useAgentComposer inset reserve", () => {
  beforeEach(() => {
    openListeners.onAttach = null;
    openListeners.onClose = null;
    openListeners.onToggle = null;
  });

  it("reserves compact h-9 height so top/bottom gaps stay equal before measure", () => {
    // compact chrome is h-9 (36px); reserve must not exceed it or the
    // pre-measure top gap looks larger than the bottom GAP.
    expect(TERMINAL_COMPOSER_RESERVE_HEIGHT_PX).toBe(36);
    const hook = renderHook(() =>
      useAgentComposer({
        activityKind: "agent",
        api: { isActive: true, setActive: vi.fn() } as never,
        hasStatusBar: true,
        panelId: "p-1",
        restored: false,
      })
    );
    act(() => {
      openListeners.onToggle?.();
    });
    expect(hook.result.current.composerMounted).toBe(true);
    expect(hook.result.current.terminalContentBottomPx).toBe(
      28 + TERMINAL_COMPOSER_RESERVE_HEIGHT_PX + TERMINAL_COMPOSER_GAP_PX * 2
    );
  });
});

describe("useAgentComposer height pulse", () => {
  beforeEach(() => {
    vi.mocked(pulseTerminalSurfaceSuppression).mockClear();
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

  it("首次 report（mount）不触发 pulse", () => {
    const hook = setup();
    act(() => {
      openListeners.onToggle?.();
    });
    act(() => {
      hook.result.current.onComposerHeightChange(56);
    });
    expect(pulseTerminalSurfaceSuppression).not.toHaveBeenCalled();
  });

  it("unmount cleanup（heightPx=0）不触发 pulse", () => {
    const hook = setup();
    act(() => {
      openListeners.onToggle?.();
    });
    act(() => {
      hook.result.current.onComposerHeightChange(56);
    });
    act(() => {
      openListeners.onToggle?.();
    });
    expect(pulseTerminalSurfaceSuppression).not.toHaveBeenCalled();
  });

  it("unmount 上报 0 后再次 mount 的首次 measure 不 pulse", () => {
    const hook = setup();
    act(() => {
      openListeners.onToggle?.();
    });
    act(() => {
      hook.result.current.onComposerHeightChange(56);
    });
    // TerminalComposer cleanup reports 0 on unmount.
    act(() => {
      hook.result.current.onComposerHeightChange(0);
    });
    act(() => {
      openListeners.onToggle?.();
    });
    act(() => {
      hook.result.current.onComposerHeightChange(56);
    });
    expect(pulseTerminalSurfaceSuppression).not.toHaveBeenCalled();
  });

  it("已挂载期间高度跳变 ≥24px 触发 pulse 且带 panelId", () => {
    const hook = setup();
    act(() => {
      openListeners.onToggle?.();
    });
    act(() => {
      hook.result.current.onComposerHeightChange(56);
    });
    act(() => {
      hook.result.current.onComposerHeightChange(88);
    });
    expect(pulseTerminalSurfaceSuppression).toHaveBeenCalledTimes(1);
    expect(pulseTerminalSurfaceSuppression).toHaveBeenCalledWith(
      "composer-height:p-1",
      "p-1"
    );
  });

  it("已挂载期间高度跳变 <24px 不触发 pulse", () => {
    const hook = setup();
    act(() => {
      openListeners.onToggle?.();
    });
    act(() => {
      hook.result.current.onComposerHeightChange(56);
    });
    act(() => {
      hook.result.current.onComposerHeightChange(72);
    });
    expect(pulseTerminalSurfaceSuppression).not.toHaveBeenCalled();
  });
});
