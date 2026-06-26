import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Swift 端跨 setupWindow / focus / show / close / blur 多条路径上的状态不变量,
 * 源文件层 invariant lock 防回归. 这里测试**代码结构**而不是行为, 因为:
 * - swift 端状态 (terminals dict / state.activeTerminalPanelId /
 *   windowToBrowserWindowId) 是 process-local, TS 测试拿不到
 * - 行为已经被 IPC 边界的 tests/unit/main/terminal-state-consistency.test.ts 间接覆盖
 *
 * 这条文件保护几条关键不变量:
 * 1. 多 BrowserWindow 路由 (#16) — windowToBrowserWindowId map 必须在 setupWindow
 *    建立、detachWindow 清理, 否则跨 window 事件路由错乱
 * 2. panel id 跨 window 重复 (#30) — TerminalEventDelegate 必须自持 browserWindowId,
 *    不能靠 panelId 全局反查 (注释明确说 default layout 都用 "terminal-1")
 * 3. close 必须清 stale state.activeTerminalPanelId (#28) — 否则后续 applyFirstResponder
 *    会去 access 已删除的 terminalView
 * 4. 多 panel hitTest 区分 (#27) — targets dict 用 panelId 做 key, hit 时遍历找命中
 */
const SWIFT_PATH = resolve(
  import.meta.dirname,
  "../../native/Sources/GhosttyBridge/GhosttyBridge.swift"
);
const SOURCE = readFileSync(SWIFT_PATH, "utf8");

const WINDOW_TO_BROWSER_ID_DECL_RE =
  /windowToBrowserWindowId: \[ObjectIdentifier: Int\]/;
const SETUP_WINDOW_REMEMBERS_RE =
  /windowToBrowserWindowId\[windowId\] = browserWindowId/;
const DETACH_FORGETS_RE =
  /windowToBrowserWindowId\.removeValue\(forKey: windowId\)/;

const EVENT_DELEGATE_HOLDS_BROWSER_ID_RE = /let browserWindowId: Int/;
const EVENT_DELEGATE_INIT_RE = /init\(panelId: String, browserWindowId: Int\)/;

const CLOSE_CLEARS_STALE_STATE_RE =
  /if state\.activeTerminalPanelId == panelId \{\s*state\.activeTerminalPanelId = nil/;

const TARGETS_DICT_RE = /var targets: \[String: Target\]/;
const HIT_ITERATES_TARGETS_RE =
  /for \(_, target\) in targets \{[\s\S]*?target\.rect\.contains/;
const FORBIDDEN_HIDE_GUARD_RE =
  /guard panelId != activePanelId else \{ return \}/;
const FORBIDDEN_GLOBAL_ACTIVE_PANEL_ID_RE =
  /private var activePanelId: String\?/;
const LOCAL_FOCUS_BEFORE_FORWARD_RE =
  /GhosttyBridgeImpl\.shared\.focus\(panelId: panelId\)[\s\S]*?Self\.forwardFocusRequestCallback\?\(browserWindowId, panelId\)/;
const OTHER_MOUSE_DOWN_FOCUSES_BEFORE_FORWARD_RE =
  /override func otherMouseDown\(with event: NSEvent\) \{[\s\S]*?capturedTerminalMouseButton = \.other[\s\S]*?activateFocusIntent\(\)[\s\S]*?terminalView\.otherMouseDown\(with: event\)/;

describe("Swift state invariants (source-level lock)", () => {
  it("windowToBrowserWindowId is set up in setupWindow + torn down in detachWindow", () => {
    expect(SOURCE).toMatch(WINDOW_TO_BROWSER_ID_DECL_RE);
    expect(SOURCE).toMatch(SETUP_WINDOW_REMEMBERS_RE);
    expect(SOURCE).toMatch(DETACH_FORGETS_RE);
  });

  it("TerminalEventDelegate holds browserWindowId as instance state", () => {
    // 防回归:不能改成全局反查 panelId→window. panel id 跨 window 可能重复
    // (default layout 都用 "terminal-1"), 全局反查会被后建立的同名 panel 覆盖,
    // 事件路由到错窗口.
    expect(SOURCE).toMatch(EVENT_DELEGATE_HOLDS_BROWSER_ID_RE);
    expect(SOURCE).toMatch(EVENT_DELEGATE_INIT_RE);
  });

  it("close clears state.activeTerminalPanelId to avoid use-after-free in applyFirstResponder", () => {
    // close 后 NSView removeFromSuperview, 但如果 state.activeTerminalPanelId
    // 还指向它, 下次 applyFirstResponder 调 terminals[id] 会拿 nil, makeFirstResponder
    // 路径走不通. 必须主动 clear.
    expect(SOURCE).toMatch(CLOSE_CLEARS_STALE_STATE_RE);
  });

  it("EventRouterView.targets is keyed by panelId, hit-tested by iterating", () => {
    // 多 panel hitTest 区分:dict keyed by panelId, hitTest 遍历找第一个 rect 命中
    // 的 target. dict 保证不同 panel 独立, 遍历保证一个 hit point 只命中一个.
    expect(SOURCE).toMatch(TARGETS_DICT_RE);
    expect(SOURCE).toMatch(HIT_ITERATES_TARGETS_RE);
  });

  it("does not contain the bug-prone hide guard against activePanelId", () => {
    // 历史 bug:hide 内 `guard panelId != activePanelId else { return }` 在 tab
    // switch 场景下错误地保护了旧 active panel 不被 hide, 新 panel addSubview
    // 落底层被旧的遮住. 已删除, 不能加回去.
    expect(SOURCE).not.toMatch(FORBIDDEN_HIDE_GUARD_RE);
  });

  it("does not keep a separate global activePanelId alongside per-window state", () => {
    expect(SOURCE).not.toMatch(FORBIDDEN_GLOBAL_ACTIVE_PANEL_ID_RE);
  });

  it("locally focuses a clicked terminal before forwarding renderer focus intent", () => {
    const scrollContainerSource = readFileSync(
      resolve(
        import.meta.dirname,
        "../../native/Sources/GhosttyBridge/TerminalScrollContainer.swift"
      ),
      "utf8"
    );
    expect(scrollContainerSource).toMatch(LOCAL_FOCUS_BEFORE_FORWARD_RE);
  });

  it("locally focuses a terminal before forwarding auxiliary mouse input", () => {
    const scrollContainerSource = readFileSync(
      resolve(
        import.meta.dirname,
        "../../native/Sources/GhosttyBridge/TerminalScrollContainer.swift"
      ),
      "utf8"
    );
    expect(scrollContainerSource).toMatch(
      OTHER_MOUSE_DOWN_FOCUSES_BEFORE_FORWARD_RE
    );
  });
});
