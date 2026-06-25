import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const VIEWPORT_DECLARATION_RE =
  /private static func terminalTargetRect\(viewport: NSRect\)/;
const LEGACY_FOR_NSRECT_RE = /terminalTargetRect\(for: NSRect\)/;
const LEGACY_FOR_FRAME_RE = /terminalTargetRect\(for: frame\)/;
const ALL_CALL_SITES_RE = /Self\.terminalTargetRect\(([^)]+)\)/g;
const COMPUTE_FRAME_FLIP_RE = /contentView\.bounds\.height - viewport\.minY/;

/**
 * 锁住 EventRouterView.targets[i].rect 用的坐标系是 viewport (top-left),
 * 不是 NSView frame (bottom-left). 这是上一次 hitTest 静默 miss bug 的根因.
 *
 * EventRouterView.isFlipped=true → top-left, 它的 hitTest 内 local 也是 top-left;
 * contentView (Electron 默认) isFlipped=false → bottom-left, NSView.frame 在它内部.
 * computeFrame 把 viewport (top-left) 翻成 frame (bottom-left) 喂给 containerView.frame,
 * 这是对的;但 EventRouterView.Target.rect 必须留 top-left, 否则跟 local 不同坐标系比对.
 *
 * 之前 panel 上下对称于 H/2 时 bottom-left/top-left 的 Y range 数字巧合相等,
 * 静默 work; drag 到非中央位置时 hitTest miss → click 落到 web 层但无 listener
 * → 用户感受"无法 click 终端 / 无法输入". 这条测试存在的全部意义就是不让人再写错.
 */
describe("EventRouter target rect uses viewport (top-left) coordinates", () => {
  const swiftPath = resolve(
    import.meta.dirname,
    "../../native/Sources/GhosttyBridge/GhosttyBridge.swift"
  );
  const source = readFileSync(swiftPath, "utf8");

  it("declares terminalTargetRect with viewport label, not frame label", () => {
    expect(source).toMatch(VIEWPORT_DECLARATION_RE);
    expect(source).not.toMatch(LEGACY_FOR_NSRECT_RE);
    expect(source).not.toMatch(LEGACY_FOR_FRAME_RE);
  });

  it("all call sites pass viewport (top-left), never the post-flip frame", () => {
    const allTargetRectCalls = [...source.matchAll(ALL_CALL_SITES_RE)];
    expect(allTargetRectCalls.length).toBeGreaterThanOrEqual(3); // createTerminal-reload, createTerminal-new, setFrame

    for (const match of allTargetRectCalls) {
      expect(match[1]).toBe("viewport: viewport");
    }
  });

  it("computeFrame still flips for NSView.frame (different coord space)", () => {
    // sanity check:确保我们没把 Y-flip 整个删掉. NSView.frame 是 contentView (bottom-left)
    // 坐标, viewport 是 web (top-left) 坐标. computeFrame 这个 flip 是对的, 不能删.
    expect(source).toMatch(COMPUTE_FRAME_FLIP_RE);
  });
});
