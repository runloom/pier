import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * window-manager 在 BaseWindow / BrowserWindow 上挂的 blur/focus handler 是终端
 * 能否输入的关键. 用 source-level lock 替代行为测试 — window-manager.create 内部
 * 用 BaseWindow + WebContentsView 复杂建构, mock 成本极高且脆弱, 直接 grep 锁住
 * `window.host.on("blur")` 跟 `window.host.on("focus")` 两条 wiring 更稳.
 *
 * - blur → blurActivePanelFocus 让 swift state 切 web/null, Ghostty 库自身的
 *   windowDidResignKey 同时把每个 surface core.setFocus(false)
 * - focus → 先记录最后聚焦窗口, 再 restoreActivePanelFocus 让 main 重发 user
 *   期望的 active terminal panelId 给 swift, swift 重新 makeFirstResponder +
 *   强制 becomeFirstResponder, Ghostty surface core.setFocus(true) 被
 *   windowDidBecomeKey 的 firstResponder === self 分支命中, cursor 恢复实心、
 *   shell 重新接 stdin.
 *
 * 缺 focus handler 的实际表现:用户切到其他 app 再切回 Pier, 所有终端 cursor
 * 空心、无法输入.
 */
const SOURCE = readFileSync(
  resolve(import.meta.dirname, "../../../src/main/windows/window-manager.ts"),
  "utf8"
);

const BLUR_WIRING_RE =
  /window\.host\.on\("blur",\s*\(\)\s*=>\s*\{\s*blurActivePanelFocus\(window\);\s*\}\);/;
const FOCUS_WIRING_RE =
  /window\.host\.on\("focus",\s*\(\)\s*=>\s*\{\s*this\.rememberFocusedWindow\(id\);\s*restoreActivePanelFocus\(window\);[\s\S]{0,350}?this\.onFocusCallbacks/;

describe("window-manager focus / blur wiring", () => {
  it("attaches blur handler routing to blurActivePanelFocus", () => {
    expect(SOURCE).toMatch(BLUR_WIRING_RE);
  });

  it("attaches focus handler routing to restoreActivePanelFocus", () => {
    expect(SOURCE).toMatch(FOCUS_WIRING_RE);
  });
});
