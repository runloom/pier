import type { TerminalOperationResult } from "@shared/contracts/terminal.ts";
import { APPKIT_KEYCODE, GHOSTTY_MODS } from "@shared/terminal-appkit-keys.ts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import {
  resetTerminalComposerDraftsForTests,
  TerminalComposer,
} from "@/panel-kits/terminal/terminal-composer.tsx";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import {
  resetTerminalStoreForTests,
  useTerminalStore,
} from "@/stores/terminal.store.ts";
import {
  resetTerminalComposerTakeoverForTests,
  terminalComposerTakeoverFocus,
} from "@/stores/terminal-composer-takeover.ts";

vi.mock("@/stores/app-dialog.store.ts", () => ({
  showAppAlert: vi.fn(async () => undefined),
}));

class TestResizeObserver {
  observe() {
    // Test no-op.
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

function installTerminalApi(): void {
  Object.defineProperty(window, "pier", {
    configurable: true,
    value: {
      terminal: {
        sendKeyPress,
        sendText,
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
  vi.mocked(showAppAlert).mockClear();
  resetTerminalComposerDraftsForTests();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetTerminalStoreForTests();
  resetTerminalComposerTakeoverForTests();
  resetTerminalComposerDraftsForTests();
  Reflect.deleteProperty(window, "pier");
});

function renderComposer(
  overrides: Partial<{
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

describe("TerminalComposer", () => {
  it("renders the expanded card immediately with no collapsed strip", () => {
    renderComposer();

    expect(screen.getByTestId("terminal-composer")).toBeInTheDocument();
    expect(
      screen.queryByTestId("terminal-composer-collapsed")
    ).not.toBeInTheDocument();
  });

  it("Esc closes with draft and never sendKeyPress Escape; remount restores draft", () => {
    const onClose = vi.fn();
    const { view } = renderComposer({ onClose, panelId: "t-draft" });

    const textarea = screen.getByTestId(
      "terminal-composer-input"
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "keep me" } });
    fireEvent.keyDown(textarea, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(sendKeyPress).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();

    view.unmount();
    renderComposer({ panelId: "t-draft" });

    expect(
      (screen.getByTestId("terminal-composer-input") as HTMLTextAreaElement)
        .value
    ).toBe("keep me");
  });

  it("sends typed text on Enter, clears textarea, and calls onClose on success", async () => {
    const onClose = vi.fn();
    renderComposer({ onClose });

    const textarea = screen.getByTestId(
      "terminal-composer-input"
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "fix bug" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(sendText).toHaveBeenCalledWith({
      panelId: "t-1",
      submit: true,
      text: "fix bug",
    });

    await vi.waitFor(() => {
      expect(textarea.value).toBe("");
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it("does not send on Shift+Enter", () => {
    renderComposer();

    const textarea = screen.getByTestId(
      "terminal-composer-input"
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "fix bug" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });

    expect(sendText).not.toHaveBeenCalled();
    expect(sendKeyPress).not.toHaveBeenCalled();
  });

  it("keeps open with text and alerts when sendText resolves ok:false without delivery", async () => {
    const onClose = vi.fn();
    sendText.mockResolvedValueOnce({ error: "boom", ok: false });
    renderComposer({ onClose });

    const textarea = screen.getByTestId(
      "terminal-composer-input"
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "fix bug" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await vi.waitFor(() => {
      expect(showAppAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          body: "boom",
          title: expect.any(String),
        })
      );
    });
    expect(textarea.value).toBe("fix bug");
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

    const textarea = screen.getByTestId(
      "terminal-composer-input"
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "fix bug" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await vi.waitFor(() => {
      expect(textarea.value).toBe("");
      expect(showAppAlert).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    cleanup();
    renderComposer({ panelId: "t-delivered" });
    expect(
      (screen.getByTestId("terminal-composer-input") as HTMLTextAreaElement)
        .value
    ).toBe("");
  });

  it("does not sendKeyPress empty navigation keys; only Ctrl+C passthroughs", async () => {
    renderComposer();

    const textarea = screen.getByTestId(
      "terminal-composer-input"
    ) as HTMLTextAreaElement;

    for (const key of [
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "Tab",
    ]) {
      fireEvent.keyDown(textarea, { key });
    }
    expect(sendKeyPress).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { ctrlKey: true, key: "c" });
    await vi.waitFor(() => {
      expect(sendKeyPress).toHaveBeenCalledWith({
        keycode: APPKIT_KEYCODE.c,
        mods: GHOSTTY_MODS.ctrl,
        panelId: "t-1",
      });
    });

    sendKeyPress.mockClear();
    fireEvent.change(textarea, { target: { value: "fix bug" } });
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

    const textarea = screen.getByTestId("terminal-composer-input");
    fireEvent.focus(textarea);
    expect(useTerminalStore.getState().activeOverlayId).toBe(
      "terminal-composer:t-1"
    );

    view.unmount();
    expect(onHeightChange).toHaveBeenLastCalledWith(0);
  });

  it("ignores Enter and does not pass through control keys while an IME composition is in progress", () => {
    const onClose = vi.fn();
    renderComposer({ onClose });

    const textarea = screen.getByTestId(
      "terminal-composer-input"
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "fix bug" } });
    fireEvent.keyDown(textarea, { isComposing: true, key: "Enter" });
    fireEvent.keyDown(textarea, { isComposing: true, key: "Escape" });

    expect(sendText).not.toHaveBeenCalled();
    expect(sendKeyPress).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("disables the textarea and the send button when disabled", () => {
    renderComposer({ disabled: true });

    expect(screen.getByTestId("terminal-composer-input")).toBeDisabled();
    expect(screen.getByTestId("terminal-composer-send")).toBeDisabled();
  });

  it("releases the composer overlay when it becomes disabled while focused", () => {
    const { onClose, onHeightChange, view } = renderComposer();
    const textarea = screen.getByTestId("terminal-composer-input");

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

  it("surface takeover persists draft, calls onClose, returns false, and does not focus textarea", () => {
    const onClose = vi.fn();
    const { view } = renderComposer({ onClose, panelId: "t-takeover" });

    const textarea = screen.getByTestId(
      "terminal-composer-input"
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "drafted" } });
    textarea.blur();
    useTerminalStore
      .getState()
      .deactivateOverlay("terminal-composer:t-takeover");
    expect(document.activeElement).not.toBe(textarea);

    expect(terminalComposerTakeoverFocus("t-takeover", "surface")).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).not.toBe(textarea);

    view.unmount();
    renderComposer({ panelId: "t-takeover" });
    expect(
      (screen.getByTestId("terminal-composer-input") as HTMLTextAreaElement)
        .value
    ).toBe("drafted");
  });

  it("activate takeover refocuses the textarea and does not close", () => {
    const onClose = vi.fn();
    renderComposer({ onClose, panelId: "t-activate" });

    const textarea = screen.getByTestId(
      "terminal-composer-input"
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "keep open" } });
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
    expect(textarea.value).toBe("keep open");
  });

  it("surface takeover still returns false when disabled and closes for TUI click-through", () => {
    const onClose = vi.fn();
    renderComposer({ disabled: true, onClose });

    const textarea = screen.getByTestId(
      "terminal-composer-input"
    ) as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);
    textarea.blur();
    expect(document.activeElement).not.toBe(textarea);

    expect(terminalComposerTakeoverFocus("t-1", "surface")).toBe(false);
    expect(document.activeElement).not.toBe(textarea);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("activate takeover returns false when disabled and does not close", () => {
    const onClose = vi.fn();
    renderComposer({ disabled: true, onClose });

    expect(terminalComposerTakeoverFocus("t-1", "activate")).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("releases the composer overlay when the panel becomes inactive", () => {
    const { onClose, onHeightChange, view } = renderComposer();
    const textarea = screen.getByTestId("terminal-composer-input");
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

    const textarea = screen.getByTestId(
      "terminal-composer-input"
    ) as HTMLTextAreaElement;
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
});
