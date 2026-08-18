import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SURFACE_PATH = join(
  process.cwd(),
  "native/Vendor/libghostty-spm/Sources/GhosttyTerminal/Surface/TerminalSurface.swift"
);
const ADDON_PATH = join(process.cwd(), "native/src/addon.mm");
const BRIDGE_PATH = join(
  process.cwd(),
  "native/Sources/GhosttyBridge/GhosttyBridge.swift"
);
const PUBLIC_INPUT_PATH = join(
  process.cwd(),
  "native/Vendor/libghostty-spm/Sources/GhosttyTerminal/Platform/AppKit/AppTerminalView+PublicInput.swift"
);

describe("native sendText UTF-8 bytes", () => {
  it("passes N-API UTF-8 bytes plus length into ghostty_bridge_send_text", () => {
    const source = readFileSync(ADDON_PATH, "utf8");
    expect(source).toContain(
      "bool ghostty_bridge_send_text(const char* panelId, const uint8_t* bytes, long count)"
    );
    expect(source).toContain("static_cast<long>(text.size())");
    expect(source).not.toMatch(
      /ghostty_bridge_send_text\(\s*panelId\.c_str\(\),\s*text\.c_str\(\)\s*\)/u
    );
  });

  it("copies host bytes into Data and fails closed on a nil buffer with count > 0", () => {
    const source = readFileSync(BRIDGE_PATH, "utf8");
    expect(source).toContain("ghosttyBridgeSendText");
    expect(source).toContain("Data(bytes: bytes, count: count)");
    expect(source).toContain("term.terminalView.sendText(data)");
    expect(source).toContain("guard let bytes else { return false }");
    expect(source).not.toMatch(
      /sendText\(\s*panelId:\s*String\(cString:\s*panelId\),\s*text:\s*String\(cString:\s*text\)/u
    );
  });

  it("feeds ghostty_surface_text with Data byte count, not withCString+utf8.count", () => {
    const source = readFileSync(SURFACE_PATH, "utf8");
    const sendTextStart = source.indexOf("public func sendText(_ data: Data)");
    expect(sendTextStart).toBeGreaterThan(-1);
    const sendTextEnd = source.indexOf("func sendMouseButton", sendTextStart);
    const sendText = source.slice(sendTextStart, sendTextEnd);
    expect(sendText).toContain("ghostty_surface_text(s, base, count)");
    expect(sendText).toContain("return invoked && result");
    expect(sendText).not.toContain("withCString");
    expect(sendText).not.toContain("text.utf8.count");
  });

  it("feeds preedit and binding actions through the same Data byte count helper", () => {
    const source = readFileSync(SURFACE_PATH, "utf8");
    expect(source).toContain("ghostty_surface_preedit(s, base, count)");
    expect(source).toContain("ghostty_surface_binding_action(s, base, count)");
    const preeditStart = source.indexOf("func preedit(_ text: String)");
    const preeditEnd = source.indexOf("// MARK: - Actions", preeditStart);
    const preedit = source.slice(preeditStart, preeditEnd);
    expect(preedit).toContain("Data(text.utf8)");
    expect(preedit).toContain("ghostty_surface_preedit(s, nil, 0)");
    expect(preedit).not.toContain("withCString");
    expect(preedit).not.toContain("text.utf8.count");
    expect(preedit).not.toMatch(/if data\.isEmpty \{\s*return\s*\}/u);
  });

  it("passes sendKeyPress text as utf8CString, not withCString", () => {
    const source = readFileSync(PUBLIC_INPUT_PATH, "utf8");
    expect(source).toContain("text.utf8CString.withUnsafeBufferPointer");
    const pressStart = source.indexOf("public func sendKeyPress(");
    const pressEnd = source.indexOf("private static func unshiftedCodepoint");
    const press = source.slice(pressStart, pressEnd);
    expect(press).not.toContain("withCString");
  });

  it("passes N-API UTF-8 bytes plus length into ghostty_bridge_send_key_press", () => {
    const addon = readFileSync(ADDON_PATH, "utf8");
    const bridge = readFileSync(BRIDGE_PATH, "utf8");
    expect(addon).toContain("ghostty_bridge_send_key_press(");
    expect(addon).toContain("const uint8_t* bytes");
    const pressStart = bridge.indexOf("ghosttyBridgeSendKeyPress");
    const pressEnd = bridge.indexOf(
      "ghosttyBridgeReadSelectionText",
      pressStart
    );
    const press = bridge.slice(pressStart, pressEnd);
    expect(press).toContain("encoding: .utf8");
    expect(press).toContain("Data(bytes: bytes, count: count)");
    expect(press).toContain("text: textValue");
  });
});
