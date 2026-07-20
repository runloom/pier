import type { TerminalOperationResult } from "@shared/contracts/terminal.ts";
import { APPKIT_KEYCODE, GHOSTTY_MODS } from "@shared/terminal-appkit-keys.ts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { TerminalComposer } from "@/panel-kits/terminal/terminal-composer.tsx";
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
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetTerminalStoreForTests();
  resetTerminalComposerTakeoverForTests();
  Reflect.deleteProperty(window, "pier");
});

function renderComposer(
  overrides: Partial<{
    bottomOffsetPx: number;
    disabled: boolean;
    isActive: boolean;
    onHeightChange: (heightPx: number) => void;
    panelId: string;
  }> = {}
) {
  const onHeightChange = overrides.onHeightChange ?? vi.fn();
  const view = render(
    <TerminalComposer
      bottomOffsetPx={overrides.bottomOffsetPx ?? 0}
      disabled={overrides.disabled ?? false}
      isActive={overrides.isActive ?? true}
      onHeightChange={onHeightChange}
      panelId={overrides.panelId ?? "t-1"}
    />
  );
  return { onHeightChange, view };
}

describe("TerminalComposer", () => {
  it("renders the expanded card immediately with no collapsed strip", () => {
    renderComposer();

    expect(screen.getByTestId("terminal-composer")).toBeInTheDocument();
    expect(
      screen.queryByTestId("terminal-composer-collapsed")
    ).not.toBeInTheDocument();
  });

  it("sends the typed text on Enter and clears the textarea on success", async () => {
    renderComposer();

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

  it("shows an alert and keeps the text when sendText resolves ok:false", async () => {
    sendText.mockResolvedValueOnce({ error: "boom", ok: false });
    renderComposer();

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
  });

  it("clears the draft when text was delivered but Return failed", async () => {
    sendText.mockResolvedValueOnce({
      error: "terminal surface not ready",
      ok: false,
      textDelivered: true,
    });
    renderComposer();

    const textarea = screen.getByTestId(
      "terminal-composer-input"
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "fix bug" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await vi.waitFor(() => {
      expect(textarea.value).toBe("");
      expect(showAppAlert).toHaveBeenCalled();
    });
  });

  it("passes through control keys via sendKeyPress, not sendText", async () => {
    renderComposer();

    const textarea = screen.getByTestId(
      "terminal-composer-input"
    ) as HTMLTextAreaElement;

    fireEvent.keyDown(textarea, { key: "ArrowDown" });
    await vi.waitFor(() => {
      expect(sendKeyPress).toHaveBeenCalledWith({
        keycode: APPKIT_KEYCODE.arrowDown,
        panelId: "t-1",
      });
    });
    expect(sendText).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: "Escape" });
    await vi.waitFor(() => {
      expect(sendKeyPress).toHaveBeenCalledWith({
        keycode: APPKIT_KEYCODE.escape,
        panelId: "t-1",
      });
    });

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
    expect(sendKeyPress).not.toHaveBeenCalled();
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
    renderComposer();

    const textarea = screen.getByTestId(
      "terminal-composer-input"
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "fix bug" } });
    fireEvent.keyDown(textarea, { isComposing: true, key: "Enter" });

    expect(sendText).not.toHaveBeenCalled();
    expect(sendKeyPress).not.toHaveBeenCalled();
  });

  it("disables the textarea and the send button when disabled", () => {
    renderComposer({ disabled: true });

    expect(screen.getByTestId("terminal-composer-input")).toBeDisabled();
    expect(screen.getByTestId("terminal-composer-send")).toBeDisabled();
  });

  it("releases the composer overlay when it becomes disabled while focused", () => {
    const { onHeightChange, view } = renderComposer();
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
        onHeightChange={onHeightChange}
        panelId="t-1"
      />
    );

    expect(useTerminalStore.getState().activeOverlayId).toBeNull();
  });

  it("preserves another overlay when the unfocused composer becomes disabled", () => {
    const { onHeightChange, view } = renderComposer();

    useTerminalStore.getState().activateOverlay("other");
    view.rerender(
      <TerminalComposer
        bottomOffsetPx={0}
        disabled
        isActive
        onHeightChange={onHeightChange}
        panelId="t-1"
      />
    );

    expect(useTerminalStore.getState().activeOverlayId).toBe("other");
  });

  it("registers a keyboard takeover that focuses the textarea and claims overlay", () => {
    renderComposer();

    const textarea = screen.getByTestId(
      "terminal-composer-input"
    ) as HTMLTextAreaElement;
    textarea.blur();
    useTerminalStore.getState().deactivateOverlay("terminal-composer:t-1");
    expect(document.activeElement).not.toBe(textarea);

    expect(terminalComposerTakeoverFocus("t-1")).toBe(true);
    expect(document.activeElement).toBe(textarea);
    expect(useTerminalStore.getState().activeOverlayId).toBe(
      "terminal-composer:t-1"
    );
  });

  it("takeover callback returns false and does not focus the textarea when disabled", () => {
    renderComposer({ disabled: true });

    const textarea = screen.getByTestId(
      "terminal-composer-input"
    ) as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);
    textarea.blur();
    expect(document.activeElement).not.toBe(textarea);

    expect(terminalComposerTakeoverFocus("t-1")).toBe(false);
    expect(document.activeElement).not.toBe(textarea);
  });

  it("takeover callback returns true and focuses the textarea when not disabled", () => {
    renderComposer({ disabled: false });

    const textarea = screen.getByTestId(
      "terminal-composer-input"
    ) as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(false);
    textarea.blur();
    expect(document.activeElement).not.toBe(textarea);

    expect(terminalComposerTakeoverFocus("t-1")).toBe(true);
    expect(document.activeElement).toBe(textarea);
  });

  it("releases the composer overlay when the panel becomes inactive", () => {
    const { onHeightChange, view } = renderComposer();
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
        onHeightChange={onHeightChange}
        panelId="t-1"
      />
    );

    expect(useTerminalStore.getState().activeOverlayId).toBeNull();
  });
});
