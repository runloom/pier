import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const GHOSTTY_BRIDGE_PATH = join(
  process.cwd(),
  "native/Sources/GhosttyBridge/GhosttyBridge.swift"
);
const ADDON_PATH = join(process.cwd(), "native/src/addon.mm");
const RAW_CHARS_PAYLOAD_RE = /"chars":\s*chars/;

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

  it("records EventRouterView routing decisions in a ring buffer surfaced via debug snapshot", () => {
    const swift = readFileSync(GHOSTTY_BRIDGE_PATH, "utf8");

    expect(swift).toContain('recordDecision(kind: "hit-test"');
    expect(swift).toContain('recordDecision(kind: "key-down"');
    expect(swift).toContain('recordDecision(kind: "right-mouse"');
    // Ring buffer 出口到 debug snapshot: recordHitTest / recordRightMouse 覆盖三种
    // 路由决策 (web-overlay / terminal / miss), snapshotRecentDecisions 由
    // debugSnapshot 装进 recentRouterDecisions 字段.
    expect(swift).toContain("recordHitTest(");
    expect(swift).toContain("recordRightMouse(");
    expect(swift).toContain("snapshotRecentDecisions()");
    expect(swift).toContain('"recentRouterDecisions"');
  });

  it("redacts raw keystrokes and stamps decision records with a monotonic seq", () => {
    const swift = readFileSync(GHOSTTY_BRIDGE_PATH, "utf8");

    // Raw `chars` 绝不能进 payload — sudo 密码等敏感输入会随 debug snapshot 泄漏。
    expect(swift).toContain('"charsLen": chars.count');
    expect(swift).not.toMatch(RAW_CHARS_PAYLOAD_RE);
    // seq 单调递增, snapshot 出口暴露给 renderer 做稳定 React key。
    expect(swift).toContain("nextDecisionSeq");
    expect(swift).toContain("nextDecisionSeq &+= 1");
    expect(swift).toContain('"seq": Double(record.seq)');
  });

  it("guards non-finite coordinates and returns an error-tagged json string instead of empty '{}' when serialization fails", () => {
    const swift = readFileSync(GHOSTTY_BRIDGE_PATH, "utf8");

    // NaN / Infinity CGFloat 会让 JSONSerialization 拒绝整个 payload; 用有限性
    // sanitizer 拦一次, 让坏坐标以 -1 明显出现在 UI 而不是塌成 "{}".
    expect(swift).toContain("sanitizedCoordinate(");
    expect(swift).toContain("d.isFinite ? d : -1");
    // jsonString 失败时输出的兜底串必须带 error 字段, 供 normalize 识别。
    expect(swift).toContain(
      '{\\"error\\":\\"native snapshot json serialization failed\\"}'
    );
  });
});
