import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * window-manager 在 BaseWindow / BrowserWindow 上挂的 blur/focus handler 是终端
 * 能否输入的关键。用 source-level lock 替代行为测试：window-manager.create 内部
 * 用 BaseWindow + WebContentsView 复杂建构，mock 成本极高且脆弱，直接锁住
 * `window.host.on("blur")` 跟 `window.host.on("focus")` 两条 wiring。
 *
 * blur/focus 都必须进入窗口级 TerminalFocusCoordinator。coordinator 保留 host
 * snapshot，在窗口恢复时重新派生并原子应用 keyboard owner 与 first responder。
 * 缺 focus replay 的实际表现：用户切到其他 app 再切回 Pier，终端 cursor 空心且
 * shell 无法继续接收 stdin。
 */
const SOURCE = readFileSync(
  resolve(import.meta.dirname, "../../../src/main/windows/window-manager.ts"),
  "utf8"
);

const BLUR_WIRING_RE =
  /window\.host\.on\("blur",\s*\(\)\s*=>\s*\{\s*terminalFocusCoordinator\.setWindowFocused\(window, false, "window-blur"\);\s*\}\);/;
const FOCUS_WIRING_RE =
  /window\.host\.on\("focus",\s*\(\)\s*=>\s*\{\s*this\.rememberFocusedWindow\(id\);\s*terminalFocusCoordinator\.setWindowFocused\(window, true, "window-focus"\);[\s\S]{0,350}?this\.onFocusCallbacks/;

describe("window-manager focus / blur wiring", () => {
  it("routes window blur through the focus coordinator", () => {
    expect(SOURCE).toMatch(BLUR_WIRING_RE);
  });

  it("routes window focus replay through the focus coordinator", () => {
    expect(SOURCE).toMatch(FOCUS_WIRING_RE);
  });
});
