import { render, waitFor } from "@testing-library/react";
import type { IDockviewPanelProps } from "dockview-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalPanel } from "@/panel-kits/terminal/terminal-panel.tsx";

class TestResizeObserver {
  observe() {
    // Test no-op.
  }
  disconnect() {
    // Test no-op.
  }
}

function createPanelProps(): IDockviewPanelProps {
  return {
    api: {
      id: "terminal-1",
      onDidActiveChange: vi.fn(() => ({ dispose: vi.fn() })),
      onDidVisibilityChange: vi.fn(() => ({ dispose: vi.fn() })),
      setTitle: vi.fn(),
    },
    containerApi: {},
  } as unknown as IDockviewPanelProps;
}

describe("TerminalPanel lifecycle", () => {
  const originalGetBoundingClientRect =
    HTMLElement.prototype.getBoundingClientRect;

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
      window.setTimeout(() => cb(performance.now()), 0)
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      window.clearTimeout(id)
    );

    HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.classList.contains("terminal-anchor")) {
        return {
          bottom: 320,
          height: 300,
          left: 10,
          right: 410,
          top: 20,
          width: 400,
          x: 10,
          y: 20,
          toJSON: () => null,
        } as DOMRect;
      }
      return originalGetBoundingClientRect.call(this);
    };

    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        terminal: {
          close: vi.fn(),
          create: vi.fn(async () => ({ ok: true })),
          focus: vi.fn(),
          hide: vi.fn(),
          onContextMenuRequest: vi.fn(() => vi.fn()),
          onCwdChange: vi.fn(() => vi.fn()),
          onTitleChange: vi.fn(() => vi.fn()),
          setFont: vi.fn(),
          setFrame: vi.fn(),
          show: vi.fn(),
        },
      },
    });
  });

  afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps the native terminal alive when React unmounts during renderer reload", async () => {
    const { unmount } = render(<TerminalPanel {...createPanelProps()} />);

    await waitFor(() => {
      expect(window.pier.terminal.create).toHaveBeenCalledWith(
        expect.objectContaining({ panelId: "terminal-1" })
      );
    });

    unmount();

    expect(window.pier.terminal.close).not.toHaveBeenCalled();
  });
});
