import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CALLBACKS_PATH = join(
  process.cwd(),
  "native/Vendor/libghostty-spm/Sources/GhosttyTerminal/Controller/TerminalController+Callbacks.swift"
);
const APP_TERMINAL_INPUT_PATH = join(
  process.cwd(),
  "native/Vendor/libghostty-spm/Sources/GhosttyTerminal/Platform/AppKit/AppTerminalView+Input.swift"
);

function readCallbacksSource(): string {
  return readFileSync(CALLBACKS_PATH, "utf8");
}

function readTerminalInputSource(): string {
  return readFileSync(APP_TERMINAL_INPUT_PATH, "utf8");
}

describe("native terminal clipboard image paste", () => {
  it("keeps text clipboard data as the first-class paste source", () => {
    const source = readCallbacksSource();
    const textReadIndex = source.indexOf("pasteboard.string(forType: .string)");
    const imageFallbackIndex = source.indexOf(
      "terminalPasteImagePathFromPasteboard(pasteboard)"
    );

    expect(textReadIndex).toBeGreaterThan(-1);
    expect(imageFallbackIndex).toBeGreaterThan(textReadIndex);
  });

  it("materializes image-only clipboard data as a temporary PNG path", () => {
    const source = readCallbacksSource();

    expect(source).toContain("terminalPasteImagePathFromPasteboard");
    expect(source).toContain("terminalPastePngData");
    expect(source).toContain("pasteboard.data(forType: .png)");
    expect(source).toContain("NSBitmapImageRep");
    expect(source).toContain("representation(using: .png");
    expect(source).toContain('"pier-terminal-pastes"');
    expect(source).toContain("clipboard-\\(UUID().uuidString).png");
  });

  it("returns the materialized image path through Ghostty's normal clipboard request", () => {
    const source = readCallbacksSource();

    expect(source).toContain(
      "ghostty_surface_complete_clipboard_request(surface, cString, opaquePtr, false)"
    );
    expect(source).toContain("clipboard image paste materialized path=");
  });

  it("continues to route Cmd+V and menu Paste through Ghostty paste binding", () => {
    const source = readTerminalInputSource();

    expect(source).toContain(
      'surface?.performBindingAction("paste_from_clipboard")'
    );
    expect(source).not.toContain("terminalPasteImagePathFromPasteboard");
  });
});
