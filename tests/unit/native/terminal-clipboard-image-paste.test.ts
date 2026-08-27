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

function readHostSource(filename: string): string {
  return readFileSync(
    join(
      process.cwd(),
      "native/Vendor/libghostty-spm/Sources/GhosttyTerminal/Host",
      filename
    ),
    "utf8"
  );
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

function extractFunctionBody(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start).toBeGreaterThan(-1);
  const braceStart = source.indexOf("{", start);
  expect(braceStart).toBeGreaterThan(-1);

  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(braceStart + 1, i);
      }
    }
  }
  throw new Error(`unclosed ${signature} body`);
}

describe("native terminal paste confirm", () => {
  it("owns clipboard state before confirm_read_clipboard returns and hops only present", () => {
    const body = extractFunctionBody(
      readCallbacksSource(),
      "static func confirmReadClipboard("
    );

    const storeAt = body.indexOf("clipboardConfirmInFlight.store");
    const adoptAt = body.indexOf("adoptClipboardConfirmation");
    const syncAt = body.indexOf("terminalRunOnMainSync");
    const asyncAt = body.indexOf("terminalRunOnMainAsync");
    const presentAt = body.indexOf("presentClipboardConfirmIfNeeded");

    expect(storeAt).toBeGreaterThan(-1);
    expect(storeAt).toBeLessThan(syncAt);
    expect(adoptAt).toBeGreaterThan(syncAt);
    expect(asyncAt).toBeGreaterThan(adoptAt);
    expect(presentAt).toBeGreaterThan(asyncAt);
    expect(body).not.toContain("ghostty_surface_complete_clipboard_request");
    expect(body).not.toContain("confirmUnsafePaste");
    expect(body).not.toContain("runModal");
  });

  it("does not present from adopt so the libghostty stack can unwind", () => {
    const host = readHostSource("ClipboardConfirmHost.swift");
    const adoptBody = extractFunctionBody(
      host,
      "func adoptClipboardConfirmation("
    );

    expect(adoptBody).toContain("pendingClipboardConfirmation = request");
    expect(adoptBody).toContain("ClipboardConfirmTargets");
    expect(adoptBody).not.toContain("presentClipboardConfirmIfNeeded");
    expect(adoptBody).not.toContain("[weak self]");
    expect(adoptBody).toContain("ClipboardConfirmCompletion.complete");
  });

  it("completes confirms with confirmed=true and empty cancel payload", () => {
    const request = readHostSource("ClipboardConfirmRequest.swift");

    expect(request).toContain('let text = payload ?? ""');
    expect(request).toMatch(
      /ghostty_surface_complete_clipboard_request\(\s*surface,\s*cString,\s*opaquePtr,\s*true\s*\)/
    );
    expect(request).not.toMatch(
      /ghostty_surface_complete_clipboard_request\([^)]*confirmed\s*\)/
    );
  });

  it("consumes clipboard state once so teardown and adopt cannot double-complete", () => {
    const request = readHostSource("ClipboardConfirmRequest.swift");

    expect(request).toContain("func take() -> UnsafeMutableRawPointer?");
    expect(request).toContain("class ClipboardConfirmInFlightSlot");
  });

  it("defers unresolved request cancellation off the creating callback stack", () => {
    const request = readHostSource("ClipboardConfirmRequest.swift");

    expect(request).toContain("deinit");
    expect(request).toContain("DispatchQueue.main.async");
    expect(request).toContain("ClipboardFinishBox");
    expect(request).toContain("box.call(nil)");
  });

  it("cancels pending then in-flight clipboard confirmation before freeing the surface", () => {
    const coordinator = readFileSync(
      join(
        process.cwd(),
        "native/Vendor/libghostty-spm/Sources/GhosttyTerminal/Surface/TerminalSurfaceCoordinator.swift"
      ),
      "utf8"
    );
    const cancelAt = coordinator.indexOf(
      "previousBridge?.cancelPendingClipboardConfirmation()"
    );
    const inFlightAt = coordinator.indexOf(
      "previousBridge?.completeInFlightClipboardConfirmIfNeeded()"
    );
    const nilSurfaceAt = coordinator.indexOf(
      "previousBridge?.rawSurface = nil"
    );
    const freeAt = coordinator.indexOf("surface?.free()");

    expect(cancelAt).toBeGreaterThan(-1);
    expect(inFlightAt).toBeGreaterThan(cancelAt);
    expect(nilSurfaceAt).toBeGreaterThan(inFlightAt);
    expect(freeAt).toBeGreaterThan(nilSurfaceAt);
  });

  it("replaces an in-flight confirm and treats unmatched abort as cancel", () => {
    const host = readHostSource("ClipboardConfirmHost.swift");
    const alert = readHostSource("ClipboardConfirmAlert.swift");
    const presentBody = extractFunctionBody(
      host,
      "func presentClipboardConfirmIfNeeded()"
    );

    expect(host).toContain("previous?.cancel()");
    expect(host).toContain("abortPresentedClipboardConfirmIfNeeded");
    expect(host).toContain("NSApp.abortModal()");
    expect(presentBody).toContain("ClipboardConfirmAlert.action");
    expect(presentBody).toContain("pendingClipboardConfirmation === request");
    expect(alert).toContain("case .cancel, .aborted:");
    expect(alert).toContain("return .finishCancel");
    expect(alert).toContain("return .presentNext");
    expect(presentBody).not.toMatch(/case \.aborted:\s*continue/);
  });
});
