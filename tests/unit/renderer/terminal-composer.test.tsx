import type {
  TerminalComposerPathsResult,
  TerminalComposerPickResult,
  TerminalOperationResult,
} from "@shared/contracts/terminal.ts";
import { APPKIT_KEYCODE, GHOSTTY_MODS } from "@shared/terminal-appkit-keys.ts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { resetComposerEditorsForTests } from "@/panel-kits/terminal/structured-composer/structured-composer-test-registry.ts";
import {
  resetTerminalComposerDraftsForTests,
  TerminalComposer,
} from "@/panel-kits/terminal/terminal-composer.tsx";
import { resetTerminalComposerAttachmentsForTests } from "@/panel-kits/terminal/use-terminal-composer-attachments.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
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
} from "./terminal-composer-test-utils.ts";

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
const pickComposerFiles = vi.fn<() => Promise<TerminalComposerPickResult>>();
const resolveComposerPaths =
  vi.fn<(paths: string[]) => Promise<TerminalComposerPathsResult>>();

function installTerminalApi(): void {
  Object.defineProperty(window, "pier", {
    configurable: true,
    value: {
      terminal: {
        pickComposerFiles,
        resolveComposerPaths,
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
  pickComposerFiles.mockReset();
  resolveComposerPaths.mockReset();
  vi.mocked(showAppAlert).mockClear();
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
  Reflect.deleteProperty(window, "pier");
});

function renderComposer(
  overrides: Partial<{
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

  it("surface takeover refocuses input, returns true, does NOT close", () => {
    const onClose = vi.fn();
    renderComposer({ onClose, panelId: "t-takeover" });

    const textarea = composerInput();
    setComposerDraftText("drafted");
    textarea.blur();
    useTerminalStore
      .getState()
      .deactivateOverlay("terminal-composer:t-takeover");
    expect(document.activeElement).not.toBe(textarea);

    // surface takeover refocuses composer and returns true (keep keyboard).
    expect(terminalComposerTakeoverFocus("t-takeover", "surface")).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(textarea);
    expect(readComposerDraftText()).toBe("drafted");
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

  it("surface takeover returns false when disabled and does NOT close", () => {
    const onClose = vi.fn();
    renderComposer({ disabled: true, onClose });

    const textarea = composerInput();
    expect(textarea.getAttribute("contenteditable")).toBe("false");
    textarea.blur();
    expect(document.activeElement).not.toBe(textarea);

    expect(terminalComposerTakeoverFocus("t-1", "surface")).toBe(false);
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
    expect(
      screen.getByTestId("terminal-composer-attachment-1")
    ).toHaveTextContent("#1");
  });
});
