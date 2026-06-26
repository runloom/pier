import { render, waitFor } from "@testing-library/react";
import type { IDockviewPanelProps } from "dockview-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalPanel } from "@/panel-kits/terminal/terminal-panel.tsx";

const popupContextMenuAtMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@/lib/context-menu/use-context-menu.ts", () => ({
  popupContextMenuAt: popupContextMenuAtMock,
}));

class TestResizeObserver {
  static observeCount = 0;
  static instances: TestResizeObserver[] = [];
  private readonly cb: ResizeObserverCallback;

  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
    TestResizeObserver.instances.push(this);
  }

  observe() {
    TestResizeObserver.observeCount += 1;
  }
  disconnect() {
    // Test no-op.
  }
  emit() {
    this.cb([], this as unknown as ResizeObserver);
  }
}

interface TestPanelProps extends IDockviewPanelProps {
  emitActive(event: { isActive: boolean }): void;
  emitDimensions(event: { height: number; width: number }): void;
  emitGroupChange(): void;
  emitVisibility(event: { isVisible: boolean }): void;
}

function createPanelProps(
  options: {
    isActive?: boolean;
    isVisible?: boolean;
    params?: { cwd?: string };
  } = {}
): TestPanelProps {
  let isActive = options.isActive ?? true;
  let isVisible = options.isVisible ?? true;
  let onDidActiveChange: ((event: { isActive: boolean }) => void) | null = null;
  let onDidDimensionsChange:
    | ((event: { height: number; width: number }) => void)
    | null = null;
  let onDidGroupChange: (() => void) | null = null;
  let onDidVisibilityChange: ((event: { isVisible: boolean }) => void) | null =
    null;
  const props = {
    api: {
      height: 300,
      id: "terminal-1",
      get isActive() {
        return isActive;
      },
      get isVisible() {
        return isVisible;
      },
      onDidActiveChange: vi.fn(
        (listener: (event: { isActive: boolean }) => void) => {
          onDidActiveChange = listener;
          return { dispose: vi.fn() };
        }
      ),
      onDidDimensionsChange: vi.fn(
        (listener: (event: { height: number; width: number }) => void) => {
          onDidDimensionsChange = listener;
          return { dispose: vi.fn() };
        }
      ),
      onDidGroupChange: vi.fn((listener: () => void) => {
        onDidGroupChange = listener;
        return { dispose: vi.fn() };
      }),
      onDidVisibilityChange: vi.fn(
        (listener: (event: { isVisible: boolean }) => void) => {
          onDidVisibilityChange = listener;
          return { dispose: vi.fn() };
        }
      ),
      setActive: vi.fn(),
      setTitle: vi.fn(),
      width: 400,
    },
    containerApi: {},
    params: options.params ?? {},
    emitGroupChange() {
      onDidGroupChange?.();
    },
    emitActive(event: { isActive: boolean }) {
      isActive = event.isActive;
      onDidActiveChange?.(event);
    },
    emitDimensions(event: { height: number; width: number }) {
      onDidDimensionsChange?.(event);
    },
    emitVisibility(event: { isVisible: boolean }) {
      isVisible = event.isVisible;
      onDidVisibilityChange?.(event);
    },
  };
  return props as unknown as TestPanelProps;
}

describe("TerminalPanel lifecycle", () => {
  const originalGetBoundingClientRect =
    HTMLElement.prototype.getBoundingClientRect;
  let anchorFrame = {
    height: 300,
    width: 400,
    x: 10,
    y: 20,
  };
  let emitWindowLayoutPulse:
    | ((pulse: { reason: "resize" | "zoom" }) => void)
    | null = null;

  beforeEach(() => {
    anchorFrame = {
      height: 300,
      width: 400,
      x: 10,
      y: 20,
    };
    emitWindowLayoutPulse = null;
    TestResizeObserver.observeCount = 0;
    TestResizeObserver.instances = [];
    popupContextMenuAtMock.mockClear();
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
          bottom: anchorFrame.y + anchorFrame.height,
          height: anchorFrame.height,
          left: anchorFrame.x,
          right: anchorFrame.x + anchorFrame.width,
          top: anchorFrame.y,
          width: anchorFrame.width,
          x: anchorFrame.x,
          y: anchorFrame.y,
          toJSON: () => null,
        } as DOMRect;
      }
      return originalGetBoundingClientRect.call(this);
    };

    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        onWindowLayoutPulse: vi.fn(
          (cb: (pulse: { reason: "resize" | "zoom" }) => void) => {
            emitWindowLayoutPulse = cb;
            return vi.fn();
          }
        ),
        terminal: {
          close: vi.fn(),
          create: vi.fn(async () => ({ ok: true })),
          focus: vi.fn(),
          hide: vi.fn(),
          onContextMenuRequest: vi.fn(() => vi.fn()),
          onCwdChange: vi.fn(() => vi.fn()),
          onTitleChange: vi.fn(() => vi.fn()),
          readSession: vi.fn(async () => null),
          setActivePanelKind: vi.fn(),
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

  it("restores the saved tab descriptor before creating a hidden native terminal", async () => {
    vi.mocked(window.pier.terminal.readSession).mockResolvedValue({
      cwd: "/Users/xyz/ABC/pier",
      title: "Claude Code",
      updatedAt: "2026-06-25T00:00:00.000Z",
    });
    const props = createPanelProps({ isActive: false, isVisible: false });

    render(<TerminalPanel {...props} />);

    await waitFor(() => {
      expect(props.api.setTitle).toHaveBeenCalledWith("pier");
    });
    expect(props.api.setTitle).not.toHaveBeenCalledWith("Terminal");
    expect(window.pier.terminal.create).not.toHaveBeenCalled();

    props.emitVisibility({ isVisible: true });

    await waitFor(() => {
      expect(window.pier.terminal.create).toHaveBeenCalledWith(
        expect.objectContaining({ panelId: "terminal-1" })
      );
    });
  });

  it("creates a native terminal for a newly active terminal panel before visibility settles", async () => {
    const props = createPanelProps({ isActive: true, isVisible: false });

    render(<TerminalPanel {...props} />);

    await waitFor(() => {
      expect(window.pier.terminal.create).toHaveBeenCalledWith(
        expect.objectContaining({ panelId: "terminal-1" })
      );
    });
  });

  it("passes panel cwd params into native terminal creation", async () => {
    render(
      <TerminalPanel
        {...createPanelProps({ params: { cwd: "/Users/xyz/ABC/pier" } })}
      />
    );

    await waitFor(() => {
      expect(window.pier.terminal.create).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: "/Users/xyz/ABC/pier",
          panelId: "terminal-1",
        })
      );
    });
  });

  it("passes panel params cwd immediately and leaves saved cwd precedence to main", async () => {
    vi.mocked(window.pier.terminal.readSession).mockResolvedValue({
      cwd: "/Users/xyz/ABC/current-work",
      title: "Claude Code",
      updatedAt: "2026-06-25T00:00:00.000Z",
    });
    const props = createPanelProps({
      isActive: true,
      params: { cwd: "/Users/xyz/ABC/original-open" },
    });

    render(<TerminalPanel {...props} />);

    await waitFor(() => {
      expect(window.pier.terminal.create).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: "/Users/xyz/ABC/original-open",
          panelId: "terminal-1",
        })
      );
    });
  });

  it("shows a terminal-colored placeholder until the native terminal is ready", async () => {
    let resolveCreate!: (value: { ok: true }) => void;
    vi.mocked(window.pier.terminal.create).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        })
    );
    const props = createPanelProps();

    const { container } = render(<TerminalPanel {...props} />);

    const root = container.querySelector('[data-testid="terminal-panel-root"]');
    const placeholder = container.querySelector(
      '[data-testid="terminal-placeholder"]'
    );
    expect(root?.getAttribute("style") ?? "").not.toContain(
      "--terminal-background"
    );
    expect(placeholder).not.toBeNull();
    expect(placeholder?.getAttribute("style")).toContain(
      "--terminal-background"
    );

    await waitFor(() => {
      expect(window.pier.terminal.create).toHaveBeenCalledWith(
        expect.objectContaining({ panelId: "terminal-1" })
      );
    });
    resolveCreate({ ok: true });

    await waitFor(() => {
      expect(
        container.querySelector('[data-testid="terminal-placeholder"]')
      ).toBeNull();
    });
  });

  it("keeps terminal create failures on the terminal-colored surface", async () => {
    vi.mocked(window.pier.terminal.create).mockResolvedValueOnce({
      error: "终端创建失败",
      ok: false,
    });
    const props = createPanelProps();

    const { container, findByText } = render(<TerminalPanel {...props} />);

    const errorText = await findByText("终端创建失败");
    const root = container.querySelector('[data-testid="terminal-panel-root"]');
    expect(root?.getAttribute("style") ?? "").not.toContain(
      "--terminal-background"
    );
    expect(errorText.parentElement?.getAttribute("style")).toContain(
      "--terminal-background"
    );
  });

  it("uses dockview dimension events and anchor resize observations for terminal frame updates", async () => {
    const props = createPanelProps();

    render(<TerminalPanel {...props} />);

    await waitFor(() => {
      expect(window.pier.terminal.create).toHaveBeenCalledWith(
        expect.objectContaining({ panelId: "terminal-1" })
      );
    });
    await waitFor(() => {
      expect(TestResizeObserver.observeCount).toBe(1);
    });
    vi.mocked(window.pier.terminal.setFrame).mockClear();

    props.emitDimensions({ height: 340, width: 460 });

    await waitFor(() => {
      expect(window.pier.terminal.setFrame).toHaveBeenCalledWith(
        "terminal-1",
        expect.objectContaining({
          height: 300,
          width: 400,
          x: 10,
          y: 20,
        })
      );
    });
    vi.mocked(window.pier.terminal.setFrame).mockClear();
    anchorFrame = {
      height: 340,
      width: 460,
      x: 10,
      y: 20,
    };
    TestResizeObserver.instances[0]?.emit();

    await waitFor(() => {
      expect(window.pier.terminal.setFrame).toHaveBeenCalledWith(
        "terminal-1",
        expect.objectContaining({
          height: 340,
          width: 460,
          x: 10,
          y: 20,
        })
      );
    });
  });

  it("sends a trailing native frame after window layout pulses settle", async () => {
    render(<TerminalPanel {...createPanelProps()} />);

    await waitFor(() => {
      expect(window.pier.terminal.create).toHaveBeenCalledWith(
        expect.objectContaining({ panelId: "terminal-1" })
      );
    });
    vi.mocked(window.pier.terminal.setFrame).mockClear();

    emitWindowLayoutPulse?.({ reason: "zoom" });
    anchorFrame = {
      height: 620,
      width: 900,
      x: 10,
      y: 20,
    };

    await waitFor(() => {
      expect(window.pier.terminal.setFrame).toHaveBeenCalledWith(
        "terminal-1",
        expect.objectContaining({
          height: 620,
          width: 900,
          x: 10,
          y: 20,
        })
      );
    });
  });

  it("refocuses an active native terminal when dockview shows it after tab drag", async () => {
    const props = createPanelProps({ isActive: true });
    render(<TerminalPanel {...props} />);

    await waitFor(() => {
      expect(window.pier.terminal.create).toHaveBeenCalledWith(
        expect.objectContaining({ panelId: "terminal-1" })
      );
    });
    vi.mocked(window.pier.terminal.focus).mockClear();

    props.emitVisibility({ isVisible: false });
    props.emitVisibility({ isVisible: true });

    await waitFor(() => {
      expect(window.pier.terminal.show).toHaveBeenCalledWith("terminal-1");
      expect(window.pier.terminal.focus).toHaveBeenCalledWith("terminal-1");
    });
  });

  it("refocuses an active native terminal when dockview moves it to another group", async () => {
    const props = createPanelProps({ isActive: true });
    render(<TerminalPanel {...props} />);

    await waitFor(() => {
      expect(window.pier.terminal.create).toHaveBeenCalledWith(
        expect.objectContaining({ panelId: "terminal-1" })
      );
    });
    vi.mocked(window.pier.terminal.focus).mockClear();

    props.emitGroupChange();

    await waitFor(() => {
      expect(window.pier.terminal.focus).toHaveBeenCalledWith("terminal-1");
    });
  });

  it("does not focus a terminal that becomes visible while inactive", async () => {
    const props = createPanelProps({ isActive: false });
    render(<TerminalPanel {...props} />);

    await waitFor(() => {
      expect(window.pier.terminal.create).toHaveBeenCalledWith(
        expect.objectContaining({ panelId: "terminal-1" })
      );
    });
    vi.mocked(window.pier.terminal.focus).mockClear();

    props.emitVisibility({ isVisible: false });
    props.emitVisibility({ isVisible: true });

    await waitFor(() => {
      expect(window.pier.terminal.show).toHaveBeenCalledWith("terminal-1");
    });
    expect(window.pier.terminal.focus).not.toHaveBeenCalled();
  });

  it("does not focus a terminal moved between groups while hidden", async () => {
    const props = createPanelProps({ isActive: true, isVisible: false });
    render(<TerminalPanel {...props} />);

    await waitFor(() => {
      expect(window.pier.terminal.create).toHaveBeenCalledWith(
        expect.objectContaining({ panelId: "terminal-1" })
      );
    });
    vi.mocked(window.pier.terminal.focus).mockClear();

    props.emitGroupChange();

    expect(window.pier.terminal.focus).not.toHaveBeenCalled();
  });

  it("activates the terminal panel before opening a native context menu", async () => {
    let emitContextMenuRequest: (req: {
      panelId: string;
      x: number;
      y: number;
    }) => void = () => {
      throw new Error("context menu listener was not registered");
    };
    vi.mocked(window.pier.terminal.onContextMenuRequest).mockImplementation(
      (cb) => {
        emitContextMenuRequest = cb;
        return vi.fn();
      }
    );
    const props = createPanelProps();

    render(<TerminalPanel {...props} />);

    emitContextMenuRequest({ panelId: "terminal-1", x: 12, y: 24 });

    await waitFor(() => {
      expect(popupContextMenuAtMock).toHaveBeenCalledWith("terminal/content", {
        x: 12,
        y: 24,
      });
    });
    expect(props.api.setActive).toHaveBeenCalledOnce();
    expect(window.pier.terminal.setActivePanelKind).toHaveBeenCalledWith(
      "terminal",
      "terminal-1"
    );
  });
});
