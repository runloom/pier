import type {
  TerminalComposerPathsResult,
  TerminalComposerPickResult,
  TerminalOperationResult,
} from "@shared/contracts/terminal.ts";
import { APPKIT_KEYCODE, GHOSTTY_MODS } from "@shared/terminal-appkit-keys.ts";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import i18next from "i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { TerminalComposer } from "@/panel-kits/terminal/composer.tsx";
import { resetTerminalComposerDraftsForTests } from "@/panel-kits/terminal/composer-helpers.ts";
import { resetTerminalEscapeShortcutForTests } from "@/panel-kits/terminal/escape-shortcut.ts";
import { resetTerminalComposerAttachmentsForTests } from "@/panel-kits/terminal/hooks/use-composer-attachments.ts";
import { resetComposerEditorsForTests } from "@/panel-kits/terminal/structured-composer/test-registry.ts";
import { resetTuiCursorSemanticsForTests } from "@/panel-kits/terminal/tui-cursor-semantics.ts";
import { resetTuiInputFocusForTests } from "@/panel-kits/terminal/tui-input-focus.ts";
import { showAppAlert, showAppConfirm } from "@/stores/app-dialog.store.ts";
import { useForegroundActivityStore } from "@/stores/foreground-activity.store.ts";
import {
  resetTerminalStoreForTests,
  useTerminalStore,
} from "@/stores/terminal.store.ts";
import {
  resetTerminalComposerTakeoverForTests,
  terminalComposerTakeoverFocus,
} from "@/stores/terminal-composer-takeover.ts";
import {
  composerInput,
  readComposerDraftText,
  setComposerDraftText,
  setComposerEditorTextLeavingReactDraft,
} from "./composer-test-utils.ts";

vi.mock("@/stores/app-dialog.store.ts", () => ({
  showAppAlert: vi.fn(async () => undefined),
  showAppConfirm: vi.fn(async () => false),
}));

const activeTerminalPanelIdMock = vi.fn(() => "t-1");
vi.mock("@/lib/actions/renderer-action-runtime.ts", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/lib/actions/renderer-action-runtime.ts")
    >();
  return {
    ...actual,
    activeTerminalPanelId: () => activeTerminalPanelIdMock(),
  };
});

function setAgentActivity(overrides: {
  agentId?: string;
  spawnedAt?: number;
  status?: string;
}): void {
  useForegroundActivityStore.setState({
    activities: {
      "t-1": {
        agentId: overrides.agentId ?? "crush",
        kind: "agent",
        panelId: "t-1",
        source: "hook",
        status: overrides.status ?? "ready",
        subagentCount: 0,
        spawnedAt: overrides.spawnedAt ?? 1,
        updatedAt: 1,
        windowId: "w-1",
      },
    },
  } as never);
}

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: vi.fn(),
  },
}));

class TestResizeObserver {
  observe() {
    // Test no-op.
  }
  unobserve() {
    // Test no-op (radix use-size cleanup).
  }
  disconnect() {
    // Test no-op.
  }
}

const sendText = vi.fn<(args: unknown) => Promise<TerminalOperationResult>>(
  async () => ({ ok: true })
);
const sendKeyPress = vi.fn<(args: unknown) => Promise<TerminalOperationResult>>(
  async () => ({ ok: true })
);
const cursorVisible = vi.fn<(panelId: string) => Promise<string>>(
  async () => "visible"
);
const pickComposerFiles = vi.fn<() => Promise<TerminalComposerPickResult>>();
const resolveComposerPaths =
  vi.fn<(paths: string[]) => Promise<TerminalComposerPathsResult>>();
const setAppShortcutKeys = vi.fn();
const keybindingOnForward =
  vi.fn<
    (
      cb: (payload: { chars: string; modifierFlags: number }) => void
    ) => () => void
  >();

const beginImageSuppress = vi.fn(async () => undefined);
const endImageSuppress = vi.fn(async () => undefined);

function installTerminalApi(): void {
  Object.defineProperty(window, "pier", {
    configurable: true,
    value: {
      clipboard: {
        beginImageSuppress,
        endImageSuppress,
        writeText: vi.fn(async () => undefined),
      },
      keybinding: {
        onForward: keybindingOnForward,
      },
      terminal: {
        cursorVisible,
        pickComposerFiles,
        resolveComposerPaths,
        sendKeyPress,
        sendText,
        setAppShortcutKeys,
      },
    },
  });
}

beforeEach(async () => {
  await initI18n();
  installTerminalApi();
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  sendText.mockClear();
  sendText.mockResolvedValue({ ok: true });
  sendKeyPress.mockClear();
  sendKeyPress.mockResolvedValue({ ok: true });
  pickComposerFiles.mockReset();
  resolveComposerPaths.mockReset();
  cursorVisible.mockReset();
  cursorVisible.mockResolvedValue("visible");
  setAppShortcutKeys.mockClear();
  keybindingOnForward.mockReset();
  keybindingOnForward.mockImplementation(() => () => undefined);
  beginImageSuppress.mockClear();
  endImageSuppress.mockClear();
  activeTerminalPanelIdMock.mockReturnValue("t-1");
  toastError.mockClear();
  useForegroundActivityStore.setState({ activities: {} });
  resetTuiInputFocusForTests();
  resetTuiCursorSemanticsForTests();
  resetTerminalEscapeShortcutForTests();
  vi.mocked(showAppAlert).mockClear();
  vi.mocked(showAppConfirm).mockClear();
  vi.mocked(showAppConfirm).mockResolvedValue(false);
  resetTerminalComposerDraftsForTests();
  resetTerminalComposerAttachmentsForTests();
  resetComposerEditorsForTests();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetTerminalStoreForTests();
  resetTerminalComposerTakeoverForTests();
  resetTerminalComposerDraftsForTests();
  resetTerminalComposerAttachmentsForTests();
  resetComposerEditorsForTests();
  resetTerminalEscapeShortcutForTests();
  Reflect.deleteProperty(window, "pier");
});

function renderComposer(
  overrides: Partial<{
    agentKind: string | null;
    attachRequest: number;
    bottomOffsetPx: number;
    disabled: boolean;
    focusRequest: number;
    isActive: boolean;
    onClose: () => void;
    onHeightChange: (heightPx: number) => void;
    panelId: string;
  }> = {}
) {
  const onClose = overrides.onClose ?? vi.fn();
  const onHeightChange = overrides.onHeightChange ?? vi.fn();
  const view = render(
    <TerminalComposer
      agentKind={overrides.agentKind ?? null}
      attachRequest={overrides.attachRequest ?? 0}
      bottomOffsetPx={overrides.bottomOffsetPx ?? 0}
      disabled={overrides.disabled ?? false}
      focusRequest={overrides.focusRequest ?? 0}
      isActive={overrides.isActive ?? true}
      onClose={onClose}
      onHeightChange={onHeightChange}
      panelId={overrides.panelId ?? "t-1"}
    />
  );
  return { onClose, onHeightChange, view };
}

/**
 * 会话观察（arming）：只有本会话读到过 visible，hidden 才显示风险提示。
 * 先给一轮 visible 让轮询 arm，再切 hidden 模拟可能失焦。
 */
async function armCursorGate(): Promise<void> {
  cursorVisible.mockResolvedValue("visible");
  await vi.waitFor(() => {
    expect(cursorVisible).toHaveBeenCalled();
  });
  cursorVisible.mockResolvedValue("hidden");
}

describe("TerminalComposer", () => {
  it("renders the expanded card immediately with no collapsed strip", () => {
    renderComposer();

    expect(screen.getByTestId("terminal-composer")).toBeInTheDocument();
    expect(
      screen.queryByTestId("terminal-composer-collapsed")
    ).not.toBeInTheDocument();
  });

  it("keeps product bg-background on the input pill chrome", () => {
    renderComposer({ panelId: "t-1" });
    const root = screen.getByTestId("terminal-composer");
    expect(root.className).toContain("bg-background");
  });

  it("opens the file picker once per attachRequest bump, not on remount at 0", async () => {
    pickComposerFiles.mockResolvedValue({ ok: false, error: "cancelled" });
    const { view } = renderComposer({ attachRequest: 1 });
    await vi.waitFor(() => {
      expect(pickComposerFiles).toHaveBeenCalledTimes(1);
    });

    view.unmount();
    pickComposerFiles.mockClear();
    renderComposer({ attachRequest: 0 });
    await new Promise((resolve) => {
      window.setTimeout(resolve, 20);
    });
    expect(pickComposerFiles).not.toHaveBeenCalled();
  });

  it("shows Send with Enter kbd and multiline hints once chrome expands", () => {
    renderComposer();

    setComposerDraftText("line1\nline2");

    const root = screen.getByTestId("terminal-composer");
    expect(root).toHaveAttribute("data-chrome", "expanded");
    const send = screen.getByTestId("terminal-composer-send");
    expect(send).toHaveTextContent(i18next.t("terminal.composer.send"));
    expect(send.querySelector("[data-slot=kbd]")).toHaveTextContent("⏎");
    expect(
      screen.getByText(/⇧⏎ newline · .+ attach · Esc close/)
    ).toBeInTheDocument();
  });

  it("Esc closes with draft and never sendKeyPress Escape; remount restores draft", () => {
    const onClose = vi.fn();
    const { view } = renderComposer({ onClose, panelId: "t-draft" });

    const textarea = composerInput();
    setComposerDraftText("keep me");
    fireEvent.keyDown(textarea, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(sendKeyPress).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();

    view.unmount();
    renderComposer({ panelId: "t-draft" });

    expect(readComposerDraftText()).toBe("keep me");
  });

  it("reopen places the caret at the end of the restored draft", async () => {
    const { view } = renderComposer({ panelId: "t-caret" });
    setComposerDraftText("keep me");
    view.unmount();

    renderComposer({ panelId: "t-caret" });
    await act(async () => {
      // Flush queueMicrotask + rAF from the focusRequest effect.
      const { promise, resolve } = Promise.withResolvers<void>();
      window.setTimeout(resolve, 0);
      await promise;
    });

    const input = composerInput();
    expect(document.activeElement).toBe(input);
    const selection = window.getSelection();
    expect(selection?.rangeCount).toBe(1);
    const range = selection?.getRangeAt(0);
    expect(range?.collapsed).toBe(true);
    // Collapsed exactly at "end of contents" — same construction as
    // focusComposerInput (selectNodeContents + collapse(false)).
    const reference = document.createRange();
    reference.selectNodeContents(input);
    reference.collapse(false);
    expect(`${range?.endContainer.nodeName}#${range?.endOffset}`).toBe(
      `${reference.endContainer.nodeName}#${reference.endOffset}`
    );
  });

  it("Esc keeps the attachment rail so remount restores tiles and tokens", async () => {
    const onClose = vi.fn();
    pickComposerFiles.mockResolvedValue({
      ok: true,
      paths: ["/tmp/stale.png"],
    });
    resolveComposerPaths.mockResolvedValue({
      attachments: [
        {
          id: "img-stale",
          kind: "image",
          name: "stale.png",
          path: "/tmp/stale.png",
        },
      ],
      failures: [],
    });

    const { view } = renderComposer({ onClose, panelId: "t-esc-att" });
    fireEvent.click(screen.getByTestId("terminal-composer-attach"));
    await vi.waitFor(() => {
      expect(screen.getByTestId("terminal-composer-attachment-1")).toBeTruthy();
    });

    fireEvent.keyDown(composerInput(), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    view.unmount();
    renderComposer({ panelId: "t-esc-att" });
    expect(
      screen.getByTestId("terminal-composer-attachment-1")
    ).toBeInTheDocument();
  });

  it("panel-level Esc closes when focus is outside the editor", () => {
    activeTerminalPanelIdMock.mockReturnValue("t-1");
    setAgentActivity({ status: "ready" });
    const onClose = vi.fn();
    renderComposer({ onClose, panelId: "t-1" });

    setComposerDraftText("draft while open");
    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(sendKeyPress).not.toHaveBeenCalled();
  });
  it("sends typed text on Enter, clears textarea, and calls onClose on success", async () => {
    const onClose = vi.fn();
    renderComposer({ onClose });

    const textarea = composerInput();
    setComposerDraftText("fix bug");
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(sendText).toHaveBeenCalledWith({
      panelId: "t-1",
      submit: true,
      text: "fix bug",
    });

    await vi.waitFor(() => {
      expect(readComposerDraftText()).toBe("");
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it("FA waiting 不单独门禁：光标 visible 时可正常发送", async () => {
    const onClose = vi.fn();
    setAgentActivity({ status: "waiting" });
    cursorVisible.mockResolvedValue("visible");
    renderComposer({ onClose });

    setComposerDraftText("fix bug");
    // waiting 不再驱动门禁；有光标即可发。
    expect(
      screen.queryByTestId("terminal-composer-send-block")
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("terminal-composer-send")).toBeEnabled();

    fireEvent.keyDown(composerInput(), { key: "Enter" });
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledWith({
        panelId: "t-1",
        submit: true,
        text: "fix bug",
      });
    });
  });

  it("TUI 输入光标 hidden（已观察过 visible）：提示风险但保留发送入口", async () => {
    const onClose = vi.fn();
    setAgentActivity({ status: "ready" });
    renderComposer({ onClose });
    await armCursorGate();

    await vi.waitFor(() => {
      expect(
        screen.getByTestId("terminal-composer-send-block")
      ).toHaveTextContent(i18next.t("terminal.composer.blockedUnfocused"));
    });
    setComposerDraftText("fix bug");
    expect(screen.getByTestId("terminal-composer-send")).toBeEnabled();

    // 光标恢复 → 风险提示解除，发送入口始终保持可用。
    cursorVisible.mockResolvedValue("visible");
    await vi.waitFor(
      () => {
        expect(
          screen.queryByTestId("terminal-composer-send-block")
        ).not.toBeInTheDocument();
      },
      { timeout: 2000 }
    );
    expect(screen.getByTestId("terminal-composer-send")).toBeEnabled();

    fireEvent.keyDown(composerInput(), { key: "Enter" });
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledWith({
        panelId: "t-1",
        submit: true,
        text: "fix bug",
      });
    });
  });

  it("探针 unknown：不阻断 UI，也不弹确认，照常发送", async () => {
    const onClose = vi.fn();
    setAgentActivity({ status: "ready" });
    cursorVisible.mockResolvedValue("unknown");
    renderComposer({ onClose });

    await new Promise((resolve) => {
      window.setTimeout(resolve, 30);
    });
    expect(
      screen.queryByTestId("terminal-composer-send-block")
    ).not.toBeInTheDocument();

    setComposerDraftText("fix bug");
    fireEvent.keyDown(composerInput(), { key: "Enter" });
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledWith({
        panelId: "t-1",
        submit: true,
        text: "fix bug",
      });
    });
    expect(showAppConfirm).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("只读到 hidden、未见过 visible：不提示风险，照常发送", async () => {
    setAgentActivity({ status: "ready" });
    cursorVisible.mockResolvedValue("hidden");
    renderComposer();

    await new Promise((resolve) => {
      window.setTimeout(resolve, 30);
    });
    expect(
      screen.queryByTestId("terminal-composer-send-block")
    ).not.toBeInTheDocument();

    setComposerDraftText("fix bug");
    fireEvent.keyDown(composerInput(), { key: "Enter" });
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledWith({
        panelId: "t-1",
        submit: true,
        text: "fix bug",
      });
    });
  });

  it("光标 hidden 时空草稿 Enter 透传被截住", async () => {
    setAgentActivity({ status: "ready" });
    renderComposer();
    await armCursorGate();

    await vi.waitFor(() => {
      expect(
        screen.getByTestId("terminal-composer-send-block")
      ).toBeInTheDocument();
    });
    fireEvent.keyDown(composerInput(), { key: "Enter" });
    await new Promise((resolve) => {
      window.setTimeout(resolve, 30);
    });
    expect(sendKeyPress).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
  });

  it("未核实光标语义的 agent（claude）：hidden 不阻断，照常发送", async () => {
    setAgentActivity({ agentId: "claude", status: "ready" });
    cursorVisible.mockResolvedValue("hidden");
    renderComposer();

    setComposerDraftText("fix bug");
    await new Promise((resolve) => {
      window.setTimeout(resolve, 30);
    });
    // claude 自绘光标，全程 ?25l：探针对它无意义，不得据此禁用发送。
    expect(cursorVisible).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("terminal-composer-send-block")
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("terminal-composer-send")).toBeEnabled();

    fireEvent.keyDown(composerInput(), { key: "Enter" });
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledWith({
        panelId: "t-1",
        submit: true,
        text: "fix bug",
      });
    });
    expect(toastError).not.toHaveBeenCalled();
  });

  it("声明探针的 agent（crush）光标 hidden 时提示但不禁用发送", async () => {
    setAgentActivity({ agentId: "crush", status: "processing" });
    renderComposer();
    await armCursorGate();

    setComposerDraftText("fix bug");
    await vi.waitFor(() => {
      expect(
        screen.getByTestId("terminal-composer-send-block")
      ).toHaveTextContent(i18next.t("terminal.composer.blockedUnfocused"));
    });
    expect(screen.getByTestId("terminal-composer-send")).toBeEnabled();
  });

  it("同面板重启同一种 agent：立即清除上一会话的风险提示", async () => {
    setAgentActivity({ agentId: "crush", status: "ready" });
    renderComposer();
    await armCursorGate();
    await vi.waitFor(() => {
      expect(
        screen.getByTestId("terminal-composer-send-block")
      ).toBeInTheDocument();
    });

    setAgentActivity({ agentId: "crush", spawnedAt: 2, status: "ready" });
    await vi.waitFor(() => {
      expect(
        screen.queryByTestId("terminal-composer-send-block")
      ).not.toBeInTheDocument();
    });
  });

  it("声明探针的 agent（grok）光标 hidden 时取消确认会保留草稿", async () => {
    setAgentActivity({ agentId: "grok", status: "ready" });
    renderComposer();
    await armCursorGate();

    setComposerDraftText("你好");
    await vi.waitFor(() => {
      expect(
        screen.getByTestId("terminal-composer-send-block")
      ).toHaveTextContent(i18next.t("terminal.composer.blockedUnfocused"));
    });
    expect(screen.getByTestId("terminal-composer-send")).toBeEnabled();
    fireEvent.keyDown(composerInput(), { key: "Enter" });
    await vi.waitFor(() => {
      expect(showAppConfirm).toHaveBeenCalledWith({
        body: i18next.t("terminal.composer.blockedUnfocusedBody"),
        confirmLabel: i18next.t("terminal.composer.sendAnyway"),
        intent: "default",
        title: i18next.t("terminal.composer.blockedUnfocusedTitle"),
      });
    });
    expect(sendText).not.toHaveBeenCalled();
    expect(readComposerDraftText()).toBe("你好");
  });

  it("声明探针的 agent（grok）光标 hidden 时确认后仍可发送", async () => {
    vi.mocked(showAppConfirm).mockResolvedValue(true);
    setAgentActivity({ agentId: "grok", status: "ready" });
    const onClose = vi.fn();
    renderComposer({ onClose });
    await armCursorGate();

    setComposerDraftText("继续发送");
    await vi.waitFor(() => {
      expect(
        screen.getByTestId("terminal-composer-send-block")
      ).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("terminal-composer-send"));

    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledWith({
        panelId: "t-1",
        submit: true,
        text: "继续发送",
      });
    });
    expect(showAppConfirm).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it("settle 窗口内双击发送只提交一次（in-flight 守卫）", async () => {
    renderComposer();

    const textarea = composerInput();
    setComposerDraftText("fix bug");
    fireEvent.keyDown(textarea, { key: "Enter" });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });
  });

  it("inserts a newline on Shift+Enter and Mod+Shift+Enter without sending", () => {
    renderComposer();

    const textarea = composerInput();
    setComposerDraftText("fix bug");
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });

    expect(sendText).not.toHaveBeenCalled();
    expect(sendKeyPress).not.toHaveBeenCalled();

    setComposerDraftText("line");
    fireEvent.keyDown(textarea, {
      key: "Enter",
      metaKey: true,
      shiftKey: true,
    });

    expect(sendText).not.toHaveBeenCalled();
    expect(readComposerDraftText()).toBe("line");
  });

  it("keeps open with text and alerts when sendText resolves ok:false without delivery", async () => {
    const onClose = vi.fn();
    sendText.mockResolvedValueOnce({ error: "boom", ok: false });
    renderComposer({ onClose });

    const textarea = composerInput();
    setComposerDraftText("fix bug");
    fireEvent.keyDown(textarea, { key: "Enter" });

    await vi.waitFor(() => {
      expect(showAppAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          body: "boom",
          title: expect.any(String),
        })
      );
    });
    expect(readComposerDraftText()).toBe("fix bug");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("clears draft, alerts, and closes when textDelivered but Return failed", async () => {
    const onClose = vi.fn();
    sendText.mockResolvedValueOnce({
      error: "terminal surface not ready",
      ok: false,
      textDelivered: true,
    });
    renderComposer({ onClose, panelId: "t-delivered" });

    const textarea = composerInput();
    setComposerDraftText("fix bug");
    fireEvent.keyDown(textarea, { key: "Enter" });

    await vi.waitFor(() => {
      expect(readComposerDraftText()).toBe("");
      expect(showAppAlert).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    cleanup();
    renderComposer({ panelId: "t-delivered" });
    expect(readComposerDraftText()).toBe("");
  });

  it("passthroughs empty-draft navigation keys and always Ctrl+C", async () => {
    renderComposer();

    const textarea = composerInput();

    fireEvent.keyDown(textarea, { key: "ArrowDown" });
    await vi.waitFor(() => {
      expect(sendKeyPress).toHaveBeenCalledWith({
        keycode: APPKIT_KEYCODE.arrowDown,
        panelId: "t-1",
      });
    });

    sendKeyPress.mockClear();
    fireEvent.keyDown(textarea, { key: "Tab", shiftKey: true });
    await vi.waitFor(() => {
      expect(sendKeyPress).toHaveBeenCalledWith({
        keycode: APPKIT_KEYCODE.tab,
        mods: GHOSTTY_MODS.shift,
        panelId: "t-1",
      });
    });

    sendKeyPress.mockClear();
    fireEvent.keyDown(textarea, { ctrlKey: true, key: "c" });
    await vi.waitFor(() => {
      expect(sendKeyPress).toHaveBeenCalledWith({
        keycode: APPKIT_KEYCODE.c,
        mods: GHOSTTY_MODS.ctrl,
        panelId: "t-1",
      });
    });

    sendKeyPress.mockClear();
    setComposerDraftText("fix bug");
    fireEvent.keyDown(textarea, { key: "ArrowDown" });
    fireEvent.keyDown(textarea, { ctrlKey: true, key: "c" });
    await vi.waitFor(() => {
      expect(sendKeyPress).toHaveBeenCalledTimes(1);
      expect(sendKeyPress).toHaveBeenCalledWith({
        keycode: APPKIT_KEYCODE.c,
        mods: GHOSTTY_MODS.ctrl,
        panelId: "t-1",
      });
    });
  });

  it("activates the overlay on focus and reports height 0 after unmount", () => {
    const onHeightChange = vi.fn();
    const { view } = renderComposer({ onHeightChange });

    const textarea = composerInput();
    fireEvent.focus(textarea);
    expect(useTerminalStore.getState().activeOverlayId).toBe(
      "terminal-composer:t-1"
    );

    view.unmount();
    expect(onHeightChange).toHaveBeenLastCalledWith(0);
  });

  it("focuses the textarea when clicking empty chrome (not controls)", () => {
    renderComposer({});
    const textarea = composerInput();
    expect(document.activeElement).not.toBe(textarea);

    fireEvent.mouseDown(screen.getByTestId("terminal-composer"));
    expect(document.activeElement).toBe(textarea);
    expect(useTerminalStore.getState().activeOverlayId).toBe(
      "terminal-composer:t-1"
    );
  });

  it("focuses the textarea when clicking empty attachment-rail space", async () => {
    pickComposerFiles.mockResolvedValue({
      ok: true,
      paths: ["/tmp/shot.png"],
    });
    resolveComposerPaths.mockResolvedValue({
      attachments: [
        {
          id: "att-img",
          kind: "image",
          name: "shot.png",
          path: "/tmp/shot.png",
          previewDataUrl: "data:image/png;base64,xx",
        },
      ],
      failures: [],
    });

    renderComposer({});
    fireEvent.click(screen.getByTestId("terminal-composer-attach"));
    await vi.waitFor(() => {
      expect(
        screen.getByTestId("terminal-composer-attachment-rail")
      ).toBeTruthy();
    });

    const textarea = composerInput();
    textarea.blur();
    expect(document.activeElement).not.toBe(textarea);

    fireEvent.mouseDown(
      screen.getByTestId("terminal-composer-attachment-rail")
    );
    expect(document.activeElement).toBe(textarea);
  });

  it("ignores Enter and does not pass through control keys while an IME composition is in progress", () => {
    const onClose = vi.fn();
    renderComposer({ onClose });

    const textarea = composerInput();
    setComposerDraftText("fix bug");
    fireEvent.keyDown(textarea, { isComposing: true, key: "Enter" });
    fireEvent.keyDown(textarea, { isComposing: true, key: "Escape" });

    expect(sendText).not.toHaveBeenCalled();
    expect(sendKeyPress).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not send or insert a linebreak when Enter is the IME confirm key (keyCode 229)", () => {
    renderComposer();
    setComposerDraftText("实");
    const allowed = fireEvent.keyDown(composerInput(), {
      isComposing: false,
      key: "Enter",
      keyCode: 229,
      which: 229,
    });
    expect(allowed).toBe(true);
    expect(sendText).not.toHaveBeenCalled();
    expect(readComposerDraftText()).toBe("实");
  });

  it("sends on the next real Enter after an IME confirm key (composingRef does not stick)", async () => {
    renderComposer();
    setComposerDraftText("实现");
    fireEvent.keyDown(composerInput(), {
      isComposing: false,
      key: "Enter",
      keyCode: 229,
      which: 229,
    });
    expect(sendText).not.toHaveBeenCalled();
    fireEvent.keyDown(composerInput(), { key: "Enter" });
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledWith({
        panelId: "t-1",
        submit: true,
        text: "实现",
      });
    });
  });

  it("sends CJK from the live editor when the React draft is stale", async () => {
    renderComposer();
    setComposerDraftText("实");
    setComposerEditorTextLeavingReactDraft("实现");
    expect(readComposerDraftText()).toBe("实现");
    fireEvent.keyDown(composerInput(), { key: "Enter" });
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledWith({
        panelId: "t-1",
        submit: true,
        text: "实现",
      });
    });
  });

  it("disables the textarea and the send button when disabled", () => {
    renderComposer({ disabled: true });

    expect(composerInput().getAttribute("contenteditable")).toBe("false");
    expect(screen.getByTestId("terminal-composer-send")).toBeDisabled();
  });

  it("releases the composer overlay when it becomes disabled while focused", () => {
    const { onClose, onHeightChange, view } = renderComposer();
    const textarea = composerInput();

    fireEvent.focus(textarea);
    expect(useTerminalStore.getState().activeOverlayId).toBe(
      "terminal-composer:t-1"
    );

    view.rerender(
      <TerminalComposer
        bottomOffsetPx={0}
        disabled
        isActive
        onClose={onClose}
        onHeightChange={onHeightChange}
        panelId="t-1"
      />
    );

    expect(useTerminalStore.getState().activeOverlayId).toBeNull();
  });

  it("preserves another overlay when the unfocused composer becomes disabled", () => {
    const { onClose, onHeightChange, view } = renderComposer();

    useTerminalStore.getState().activateOverlay("other");
    view.rerender(
      <TerminalComposer
        bottomOffsetPx={0}
        disabled
        isActive
        onClose={onClose}
        onHeightChange={onHeightChange}
        panelId="t-1"
      />
    );

    expect(useTerminalStore.getState().activeOverlayId).toBe("other");
  });

  it("surface takeover swallows focus-request: no close, no steal, keeps composer", () => {
    const onClose = vi.fn();
    renderComposer({ onClose, panelId: "t-takeover" });

    setComposerDraftText("drafted");
    useTerminalStore
      .getState()
      .deactivateOverlay("terminal-composer:t-takeover");

    // 点终端：吞掉归还（true），不关卡片、不抢编辑器焦点。
    expect(terminalComposerTakeoverFocus("t-takeover", "surface")).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    expect(readComposerDraftText()).toBe("drafted");
  });

  it("surface click re-probes cursor so the focus warning clears immediately", async () => {
    setAgentActivity({ status: "ready" });
    const onClose = vi.fn();
    renderComposer({ onClose, panelId: "t-1" });
    await armCursorGate();

    setComposerDraftText("fix bug");
    await vi.waitFor(() => {
      expect(
        screen.getByTestId("terminal-composer-send-block")
      ).toBeInTheDocument();
    });
    expect(screen.getByTestId("terminal-composer-send")).toBeEnabled();

    // 用户点终端输入区 → TUI 聚焦 → 立刻重探
    cursorVisible.mockResolvedValue("visible");
    expect(terminalComposerTakeoverFocus("t-1", "surface")).toBe(true);
    expect(onClose).not.toHaveBeenCalled();

    await vi.waitFor(() => {
      expect(
        screen.queryByTestId("terminal-composer-send-block")
      ).not.toBeInTheDocument();
    });
  });

  it("activate takeover refocuses the textarea and does not close", () => {
    const onClose = vi.fn();
    renderComposer({ onClose, panelId: "t-activate" });

    const textarea = composerInput();
    setComposerDraftText("keep open");
    textarea.blur();
    useTerminalStore
      .getState()
      .deactivateOverlay("terminal-composer:t-activate");
    expect(document.activeElement).not.toBe(textarea);

    expect(terminalComposerTakeoverFocus("t-activate", "activate")).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(textarea);
    expect(useTerminalStore.getState().activeOverlayId).toBe(
      "terminal-composer:t-activate"
    );
    expect(readComposerDraftText()).toBe("keep open");
  });

  it("surface takeover still swallows when disabled and does NOT close", () => {
    const onClose = vi.fn();
    renderComposer({ disabled: true, onClose });

    const textarea = composerInput();
    expect(textarea.getAttribute("contenteditable")).toBe("false");
    textarea.blur();
    expect(document.activeElement).not.toBe(textarea);

    expect(terminalComposerTakeoverFocus("t-1", "surface")).toBe(true);
    expect(document.activeElement).not.toBe(textarea);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("activate takeover returns false when disabled and does not close", () => {
    const onClose = vi.fn();
    renderComposer({ disabled: true, onClose });

    expect(terminalComposerTakeoverFocus("t-1", "activate")).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("releases the composer overlay when the panel becomes inactive", () => {
    const { onClose, onHeightChange, view } = renderComposer();
    const textarea = composerInput();
    fireEvent.focus(textarea);
    expect(useTerminalStore.getState().activeOverlayId).toBe(
      "terminal-composer:t-1"
    );

    view.rerender(
      <TerminalComposer
        bottomOffsetPx={0}
        disabled={false}
        isActive={false}
        onClose={onClose}
        onHeightChange={onHeightChange}
        panelId="t-1"
      />
    );

    expect(useTerminalStore.getState().activeOverlayId).toBeNull();
  });

  it("bumped focusRequest refocuses an already-open composer", async () => {
    const onClose = vi.fn();
    const onHeightChange = vi.fn();
    const { view } = renderComposer({ onClose, onHeightChange });

    const textarea = composerInput();
    textarea.blur();
    useTerminalStore.getState().deactivateOverlay("terminal-composer:t-1");
    expect(document.activeElement).not.toBe(textarea);

    view.rerender(
      <TerminalComposer
        bottomOffsetPx={0}
        disabled={false}
        focusRequest={1}
        isActive
        onClose={onClose}
        onHeightChange={onHeightChange}
        panelId="t-1"
      />
    );

    await vi.waitFor(() => {
      expect(document.activeElement).toBe(textarea);
    });
    expect(useTerminalStore.getState().activeOverlayId).toBe(
      "terminal-composer:t-1"
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("attaches a file via paperclip and sends path once with body", async () => {
    const onClose = vi.fn();
    pickComposerFiles.mockResolvedValue({
      ok: true,
      paths: ["/tmp/note.pdf"],
    });
    resolveComposerPaths.mockResolvedValue({
      attachments: [
        {
          id: "att-1",
          kind: "file",
          name: "note.pdf",
          path: "/tmp/note.pdf",
        },
      ],
      failures: [],
    });

    renderComposer({ onClose });

    fireEvent.click(screen.getByTestId("terminal-composer-attach"));
    await vi.waitFor(() => {
      expect(screen.getByTestId("terminal-composer-attachment-1")).toBeTruthy();
      expect(readComposerDraftText()).toContain("/tmp/note.pdf");
      expect(readComposerDraftText()).not.toContain("[#");
    });

    setComposerDraftText(`${readComposerDraftText()} please review`);

    fireEvent.click(screen.getByTestId("terminal-composer-send"));

    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });
    expect(sendText).toHaveBeenCalledWith({
      panelId: "t-1",
      submit: true,
      text: expect.stringContaining("/tmp/note.pdf"),
    });
    await vi.waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(readComposerDraftText()).toBe("");
    });
    expect(
      screen.queryByTestId("terminal-composer-attachment-1")
    ).not.toBeInTheDocument();
  });

  it("enables send with only attachments and no typed body", async () => {
    const onClose = vi.fn();
    pickComposerFiles.mockResolvedValue({
      ok: true,
      paths: ["/tmp/only.png"],
    });
    resolveComposerPaths.mockResolvedValue({
      attachments: [
        {
          id: "img-1",
          kind: "image",
          name: "only.png",
          path: "/tmp/only.png",
        },
      ],
      failures: [],
    });

    renderComposer({ onClose });

    fireEvent.click(screen.getByTestId("terminal-composer-attach"));
    await vi.waitFor(() => {
      expect(screen.getByTestId("terminal-composer-attachment-1")).toBeTruthy();
    });

    // Body may hold the auto-inserted path chip; blank body still sends paths.
    setComposerDraftText("");

    const send = screen.getByTestId("terminal-composer-send");
    expect(send).not.toBeDisabled();

    fireEvent.click(send);
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });
    expect(sendText).toHaveBeenCalledWith({
      panelId: "t-1",
      submit: true,
      text: "/tmp/only.png",
    });
    await vi.waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it("agent panel: plain text send suppresses clipboard image probe window", async () => {
    setAgentActivity({ status: "ready" });
    const onClose = vi.fn();
    renderComposer({ onClose });
    setComposerDraftText("你好");
    fireEvent.keyDown(composerInput(), { key: "Enter" });

    await vi.waitFor(() => {
      expect(beginImageSuppress).toHaveBeenCalled();
      expect(sendText).toHaveBeenCalledWith({
        panelId: "t-1",
        submit: true,
        text: "你好",
      });
    });
    await vi.waitFor(() => {
      expect(endImageSuppress).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it("removes an attachment chip and updates the rail", async () => {
    pickComposerFiles.mockResolvedValue({
      ok: true,
      paths: ["/tmp/a.txt", "/tmp/b.txt"],
    });
    resolveComposerPaths.mockResolvedValue({
      attachments: [
        {
          id: "a",
          kind: "file",
          name: "a.txt",
          path: "/tmp/a.txt",
        },
        {
          id: "b",
          kind: "file",
          name: "b.txt",
          path: "/tmp/b.txt",
        },
      ],
      failures: [],
    });

    renderComposer();

    fireEvent.click(screen.getByTestId("terminal-composer-attach"));
    await vi.waitFor(() => {
      expect(screen.getByTestId("terminal-composer-attachment-1")).toBeTruthy();
      expect(screen.getByTestId("terminal-composer-attachment-2")).toBeTruthy();
    });

    fireEvent.click(
      screen.getByTestId("terminal-composer-attachment-remove-1")
    );

    await vi.waitFor(() => {
      expect(
        screen.queryByTestId("terminal-composer-attachment-2")
      ).not.toBeInTheDocument();
    });
    // Single remaining attachment: rail hides #n (only multi needs ordinal).
    expect(
      screen.getByTestId("terminal-composer-attachment-1")
    ).not.toHaveTextContent("#1");
  });

  it("keeps ordinal badges off attachment rail tiles", async () => {
    pickComposerFiles.mockResolvedValue({
      ok: true,
      paths: ["/tmp/a.txt", "/tmp/b.txt"],
    });
    resolveComposerPaths.mockResolvedValue({
      attachments: [
        {
          id: "a",
          kind: "file",
          name: "a.txt",
          path: "/tmp/a.txt",
        },
        {
          id: "b",
          kind: "file",
          name: "b.txt",
          path: "/tmp/b.txt",
        },
      ],
      failures: [],
    });

    renderComposer();

    fireEvent.click(screen.getByTestId("terminal-composer-attach"));
    await vi.waitFor(() => {
      expect(screen.getByTestId("terminal-composer-attachment-1")).toBeTruthy();
      expect(screen.getByTestId("terminal-composer-attachment-2")).toBeTruthy();
    });

    expect(
      screen.getByTestId("terminal-composer-attachment-1")
    ).not.toHaveTextContent("#");
    expect(
      screen.getByTestId("terminal-composer-attachment-2")
    ).not.toHaveTextContent("#");

    fireEvent.click(
      screen.getByTestId("terminal-composer-attachment-remove-2")
    );
    await vi.waitFor(() => {
      expect(
        screen.queryByTestId("terminal-composer-attachment-2")
      ).not.toBeInTheDocument();
    });
    expect(
      screen.getByTestId("terminal-composer-attachment-1")
    ).not.toHaveTextContent("#");
  });
  it("Esc with the skill/command list open dismisses only the list", () => {
    const onClose = vi.fn();
    renderComposer({ agentKind: "claude", onClose, panelId: "t-skill" });

    setComposerDraftText("/");
    expect(
      document.getElementById("terminal-composer-skill-listbox")
    ).not.toBeNull();

    // First Esc: Lexical cancels the suggest list; Rich Input stays open.
    fireEvent.keyDown(composerInput(), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(
      document.getElementById("terminal-composer-skill-listbox")
    ).toBeNull();

    // Second Esc (list already gone) closes Rich Input itself.
    fireEvent.keyDown(composerInput(), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("skill chip survives close/reopen via the editor snapshot", async () => {
    const { view } = renderComposer({
      agentKind: "claude",
      panelId: "t-chip",
    });

    setComposerDraftText("/");
    const item = screen.getByTestId("terminal-composer-skill-popup-item-0");
    await act(async () => {
      fireEvent.mouseDown(item);
    });
    const chip = document.querySelector(".composer-ref-chip");
    expect(chip).not.toBeNull();
    const draftAfterSelect = readComposerDraftText();
    expect(draftAfterSelect.length).toBeGreaterThan(0);

    // Toggle: unmount (close) and remount with the same panel id.
    view.unmount();
    renderComposer({ agentKind: "claude", panelId: "t-chip" });

    expect(document.querySelector(".composer-ref-chip")).not.toBeNull();
    expect(readComposerDraftText()).toBe(draftAfterSelect);
  });
});
