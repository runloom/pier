import type {
  TerminalHostSnapshot,
  TerminalNativeApplyResult,
} from "@shared/contracts/terminal.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalFocusCoordinator } from "../../../src/main/ipc/terminal-focus-coordinator.ts";
import { isTerminalHostSnapshot } from "../../../src/main/ipc/terminal-host-snapshot-validation.ts";
import type { NativeAddon } from "../../../src/main/ipc/terminal-native-addon.ts";
import type { AppWindow } from "../../../src/main/windows/app-window.ts";

function createWindow(id = 1, focused = true) {
  let windowFocused = focused;
  let destroyed = false;
  const webFocus = vi.fn();
  const win = {
    getNativeWindowHandle: () => Buffer.from([id]),
    id,
    isDestroyed: () => destroyed,
    isFocused: () => windowFocused,
    webContents: {
      focus: webFocus,
      isDestroyed: () => destroyed,
    },
  } as unknown as AppWindow;
  return {
    destroy: () => {
      destroyed = true;
    },
    setFocused: (value: boolean) => {
      windowFocused = value;
    },
    webFocus,
    win,
  };
}

function createAddon(
  result: TerminalNativeApplyResult = { status: "applied" }
) {
  const applyTerminalWindowState = vi.fn(() => result);
  return {
    addon: { applyTerminalWindowState } as unknown as NativeAddon,
    applyTerminalWindowState,
  };
}

function terminalSnapshot(
  rendererSequence = 1,
  overrides: Partial<TerminalHostSnapshot> = {}
): TerminalHostSnapshot {
  return {
    activePanelId: "terminal-1",
    activeTerminalPanelId: "terminal-1",
    basePanel: { kind: "terminal", panelId: "terminal-1" },
    focusDisabledPanelIds: [],
    hasMaximizedGroup: false,
    reason: "dockview-active-panel",
    rendererSequence,
    terminals: [
      {
        frame: { height: 100, width: 200, x: 0, y: 0 },
        panelId: "terminal-1",
        visible: true,
      },
    ],
    webOverlayRects: [],
    webRequestCount: 0,
    ...overrides,
  };
}

describe("isTerminalHostSnapshot", () => {
  it("accepts a consistent complete host snapshot", () => {
    expect(isTerminalHostSnapshot(terminalSnapshot())).toBe(true);
  });

  it.each([
    ["negative web request count", { webRequestCount: -1 }],
    [
      "duplicate terminal ids",
      {
        terminals: [
          ...terminalSnapshot().terminals,
          ...terminalSnapshot().terminals,
        ],
      },
    ],
    [
      "non-finite frame",
      {
        terminals: [
          {
            ...terminalSnapshot().terminals[0],
            frame: { height: 1, width: Number.NaN, x: 0, y: 0 },
          },
        ],
      },
    ],
    ["inconsistent active terminal", { activePanelId: "web-1" }],
    ["web base with active terminal", { basePanel: { kind: "web" } }],
    [
      "duplicate focus-disabled ids",
      { focusDisabledPanelIds: ["terminal-1", "terminal-1"] },
    ],
    [
      "non-array focus-disabled ids",
      { focusDisabledPanelIds: "terminal-1" as unknown as string[] },
    ],
  ])("rejects %s", (_name, overrides) => {
    expect(
      isTerminalHostSnapshot({ ...terminalSnapshot(), ...overrides })
    ).toBe(false);
  });
});

describe("TerminalFocusCoordinator", () => {
  let coordinator: TerminalFocusCoordinator;

  beforeEach(() => {
    coordinator = new TerminalFocusCoordinator();
  });

  it("rejects stale and conflicting snapshots without native apply or ACK", () => {
    const { win } = createWindow();
    const { addon, applyTerminalWindowState } = createAddon();
    coordinator.configureNativeAddon(addon);
    coordinator.surfaceCreated(win, "terminal-1");

    const applied = coordinator.acceptRendererSnapshot(
      win,
      terminalSnapshot(2)
    );
    expect(applied).toMatchObject({ status: "applied", shouldAck: true });
    applyTerminalWindowState.mockClear();

    expect(
      coordinator.acceptRendererSnapshot(win, terminalSnapshot(1))
    ).toMatchObject({
      status: "stale",
      shouldAck: false,
    });
    expect(
      coordinator.acceptRendererSnapshot(
        win,
        terminalSnapshot(2, { hasMaximizedGroup: true })
      )
    ).toMatchObject({ status: "conflict", shouldAck: false });
    expect(applyTerminalWindowState).not.toHaveBeenCalled();
  });

  it("ACKs an identical successful sequence without reapplying native state", () => {
    const { win } = createWindow();
    const { addon, applyTerminalWindowState } = createAddon();
    coordinator.configureNativeAddon(addon);
    coordinator.surfaceCreated(win, "terminal-1");
    coordinator.acceptRendererSnapshot(win, terminalSnapshot(3));
    applyTerminalWindowState.mockClear();

    expect(
      coordinator.acceptRendererSnapshot(win, terminalSnapshot(3))
    ).toMatchObject({
      status: "unchanged",
      shouldAck: true,
    });
    expect(applyTerminalWindowState).not.toHaveBeenCalled();
  });

  it("keeps terminal intent pending until focused ready visible geometry exists", () => {
    const { win } = createWindow();
    const { addon } = createAddon();
    coordinator.configureNativeAddon(addon);

    const unavailable = coordinator.acceptRendererSnapshot(
      win,
      terminalSnapshot()
    );
    expect(unavailable.effective?.keyboardTarget).toEqual({ kind: "web" });
    expect(coordinator.readDebug(win).desired?.basePanel).toEqual({
      kind: "terminal",
      panelId: "terminal-1",
    });

    const repaired = coordinator.surfaceCreated(win, "terminal-1");
    expect(repaired.effective?.keyboardTarget).toEqual({
      kind: "terminal",
      panelId: "1::terminal-1",
    });
  });

  it("forces web keyboard and marks focus-disabled panels for native cursor hide", () => {
    const { win } = createWindow();
    const { addon, applyTerminalWindowState } = createAddon();
    coordinator.configureNativeAddon(addon);
    coordinator.surfaceCreated(win, "terminal-1");

    coordinator.acceptRendererSnapshot(
      win,
      terminalSnapshot(1, { focusDisabledPanelIds: ["terminal-1"] })
    );

    expect(applyTerminalWindowState).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({
        focusDisabledPanelIds: ["1::terminal-1"],
        keyboardTarget: { kind: "web" },
      })
    );

    applyTerminalWindowState.mockClear();
    coordinator.acceptRendererSnapshot(
      win,
      terminalSnapshot(2, { focusDisabledPanelIds: [] })
    );

    expect(applyTerminalWindowState).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({
        focusDisabledPanelIds: [],
        keyboardTarget: {
          kind: "terminal",
          panelId: "1::terminal-1",
        },
      })
    );
  });

  it("requires visibility and frame before honoring a ready terminal", () => {
    const { win } = createWindow();
    const { addon } = createAddon();
    coordinator.configureNativeAddon(addon);
    coordinator.surfaceCreated(win, "terminal-1");

    const hidden = coordinator.acceptRendererSnapshot(
      win,
      terminalSnapshot(1, {
        terminals: [{ frame: null, panelId: "terminal-1", visible: false }],
      })
    );
    expect(hidden.effective?.keyboardTarget).toEqual({ kind: "web" });

    const visible = coordinator.acceptRendererSnapshot(
      win,
      terminalSnapshot(2)
    );
    expect(visible.effective?.keyboardTarget).toEqual({
      kind: "terminal",
      panelId: "1::terminal-1",
    });
  });

  it("revokes a closing surface and transfers after the successor snapshot", () => {
    const { win } = createWindow();
    const { addon } = createAddon();
    coordinator.configureNativeAddon(addon);
    coordinator.surfaceCreated(win, "terminal-1");
    coordinator.surfaceCreated(win, "terminal-2");
    coordinator.acceptRendererSnapshot(win, terminalSnapshot());

    expect(
      coordinator.surfaceWillClose(win, "terminal-1").effective?.keyboardTarget
    ).toEqual({ kind: "web" });
    expect(
      coordinator.acceptRendererSnapshot(
        win,
        terminalSnapshot(2, {
          activePanelId: "terminal-2",
          activeTerminalPanelId: "terminal-2",
          basePanel: { kind: "terminal", panelId: "terminal-2" },
          terminals: [
            { ...terminalSnapshot().terminals[0]!, panelId: "terminal-2" },
          ],
        })
      ).effective?.keyboardTarget
    ).toEqual({ kind: "terminal", panelId: "1::terminal-2" });
  });

  it("preserves terminal intent across blur and replays it on focus", () => {
    const { win } = createWindow();
    const { addon } = createAddon();
    coordinator.configureNativeAddon(addon);
    coordinator.surfaceCreated(win, "terminal-1");
    coordinator.acceptRendererSnapshot(win, terminalSnapshot());

    expect(
      coordinator.setWindowFocused(win, false, "window-blur").effective
        ?.keyboardTarget
    ).toEqual({ kind: "web" });
    expect(coordinator.readDebug(win).desired?.basePanel).toEqual({
      kind: "terminal",
      panelId: "terminal-1",
    });
    expect(
      coordinator.setWindowFocused(win, true, "window-focus").effective
        ?.keyboardTarget
    ).toEqual({ kind: "terminal", panelId: "1::terminal-1" });
  });

  it("keeps native errors dirty and retries without ACK", () => {
    const { win } = createWindow();
    const outcomes: TerminalNativeApplyResult[] = [
      { status: "error", error: "failed" },
      { status: "applied" },
    ];
    const applyTerminalWindowState = vi.fn(
      () => outcomes.shift() ?? { status: "applied" }
    );
    coordinator.configureNativeAddon({
      applyTerminalWindowState,
    } as unknown as NativeAddon);
    coordinator.surfaceCreated(win, "terminal-1");

    expect(
      coordinator.acceptRendererSnapshot(win, terminalSnapshot())
    ).toMatchObject({
      status: "error",
      shouldAck: false,
    });
    expect(coordinator.readDebug(win)).toMatchObject({
      dirty: true,
      lastError: "failed",
    });
    expect(coordinator.replay(win, "surface-created")).toMatchObject({
      status: "applied",
      shouldAck: true,
    });
  });

  it("ACKs native unchanged only for an already successful renderer sequence", () => {
    const { win, webFocus } = createWindow();
    const firstAddon = createAddon();
    coordinator.configureNativeAddon(firstAddon.addon);
    coordinator.acceptRendererSnapshot(
      win,
      terminalSnapshot(1, {
        activePanelId: "web-1",
        activeTerminalPanelId: null,
        basePanel: { kind: "web" },
        terminals: [],
      })
    );
    expect(webFocus).toHaveBeenCalledTimes(1);

    const unchangedAddon = createAddon({ status: "unchanged" });
    coordinator.configureNativeAddon(unchangedAddon.addon);
    expect(coordinator.replay(win, "anchor-resize")).toMatchObject({
      nativeStatus: "unchanged",
      shouldAck: true,
      status: "unchanged",
    });
    expect(webFocus).toHaveBeenCalledTimes(1);
  });

  it("isolates identical raw panel ids across windows and validates native intents", () => {
    const first = createWindow(1);
    const second = createWindow(2);
    const { addon } = createAddon();
    coordinator.configureNativeAddon(addon);
    coordinator.surfaceCreated(first.win, "terminal-1");
    coordinator.surfaceCreated(second.win, "terminal-1");
    coordinator.acceptRendererSnapshot(first.win, terminalSnapshot());
    coordinator.acceptRendererSnapshot(second.win, terminalSnapshot());

    expect(coordinator.readDebug(first.win).effective?.keyboardTarget).toEqual({
      kind: "terminal",
      panelId: "1::terminal-1",
    });
    expect(coordinator.readDebug(second.win).effective?.keyboardTarget).toEqual(
      { kind: "terminal", panelId: "2::terminal-1" }
    );
    expect(
      coordinator.acceptNativeFocusIntent(first.win, "1::terminal-1")
    ).toEqual({ ok: true, panelId: "terminal-1" });
    expect(
      coordinator.acceptNativeFocusIntent(first.win, "2::terminal-1")
    ).toEqual({ ok: false, reason: "cross-window" });
  });

  it("records a first invalid snapshot without installing desired state", () => {
    const { win } = createWindow();
    const { addon, applyTerminalWindowState } = createAddon();
    coordinator.configureNativeAddon(addon);

    expect(
      coordinator.acceptRendererSnapshot(win, {
        ...terminalSnapshot(),
        webRequestCount: -1,
      })
    ).toMatchObject({ status: "error", shouldAck: false });

    expect(coordinator.readDebug(win)).toMatchObject({
      desired: null,
      lastError: "invalid-host-snapshot",
    });
    expect(applyTerminalWindowState).not.toHaveBeenCalled();
  });

  it("rejects invalid snapshots and destroyed windows without replacing desired state", () => {
    const { win, destroy } = createWindow();
    const { addon, applyTerminalWindowState } = createAddon();
    coordinator.configureNativeAddon(addon);
    coordinator.acceptRendererSnapshot(win, terminalSnapshot());
    applyTerminalWindowState.mockClear();

    expect(
      coordinator.acceptRendererSnapshot(win, {
        ...terminalSnapshot(2),
        webRequestCount: -1,
      })
    ).toMatchObject({ status: "error", shouldAck: false });
    expect(coordinator.readDebug(win).desired?.rendererSequence).toBe(1);
    destroy();
    expect(coordinator.replay(win, "surface-created")).toMatchObject({
      status: "unavailable",
    });
    expect(applyTerminalWindowState).not.toHaveBeenCalled();
  });
});
