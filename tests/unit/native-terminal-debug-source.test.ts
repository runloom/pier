import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const GHOSTTY_BRIDGE_PATH = join(
  process.cwd(),
  "native/Sources/GhosttyBridge/GhosttyBridge.swift"
);
const ADDON_PATH = join(process.cwd(), "native/src/addon.mm");

describe("native terminal debug bridge source", () => {
  it("exports a native debug snapshot through Swift and N-API", () => {
    const swift = readFileSync(GHOSTTY_BRIDGE_PATH, "utf8");
    const addon = readFileSync(ADDON_PATH, "utf8");

    expect(swift).toContain("func debugSnapshot(parent: NSWindow) -> String");
    expect(swift).toContain('@_cdecl("ghostty_bridge_debug_snapshot")');
    expect(swift).toContain('@_cdecl("ghostty_bridge_free_string")');
    expect(addon).toContain("ghostty_bridge_debug_snapshot");
    expect(addon).toContain('exports.Set("debugSnapshot"');
  });

  it("exports and applies terminal presentation through one native path", () => {
    const swift = readFileSync(GHOSTTY_BRIDGE_PATH, "utf8");
    const addon = readFileSync(ADDON_PATH, "utf8");

    expect(swift).toContain("func applyPresentation(parent: NSWindow");
    expect(swift).toContain('@_cdecl("ghostty_bridge_apply_presentation")');
    expect(swift).toContain("lastAppliedNativeApplySequence");
    expect(swift).toContain("staleDiscardCount");
    expect(swift).toContain("rememberLayout(");
    expect(swift).toContain("terminalView.setSurfaceVisible(entry.visible)");
    expect(swift).toContain("container.isHidden = true");
    expect(addon).toContain("ghostty_bridge_apply_presentation");
    expect(addon).toContain("JsApplyTerminalPresentation");
    expect(addon).toContain('exports.Set("applyTerminalPresentation"');
  });

  it("exposes terminal surface visibility in the native debug snapshot", () => {
    const swift = readFileSync(GHOSTTY_BRIDGE_PATH, "utf8");

    expect(swift).toContain('"surfaceVisible"');
    expect(swift).toContain("term.surfaceVisible");
  });
});
