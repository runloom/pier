import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Swift 端跨 setupWindow / focus / show / close / blur 多条路径上的状态不变量,
 * 源文件层 invariant lock 防回归. 这里测试**代码结构**而不是行为, 因为:
 * - swift 端状态 (terminals dict / state.keyboardFocusTarget /
 *   windowToBrowserWindowId) 是 process-local, TS 测试拿不到
 * - 行为已经被 IPC 边界的 tests/unit/main/terminal-state-consistency.test.ts 间接覆盖
 *
 * 这条文件保护几条关键不变量:
 * 1. 多 BrowserWindow 路由 (#16) — windowToBrowserWindowId map 必须在 setupWindow
 *    建立、detachWindow 清理, 否则跨 window 事件路由错乱
 * 2. panel id 跨 window 重复 (#30) — TerminalEventDelegate 必须自持 browserWindowId,
 *    不能靠 panelId 全局反查 (注释明确说 default layout 都用 "terminal-1")
 * 3. close 必须把 stale terminal keyboard target 清回 Web (#28) — 否则后续
 *    applyFirstResponder 会去 access 已删除的 terminalView
 * 4. 多 panel hitTest 区分 (#27) — targets dict 用 panelId 做 key, hit 时遍历找命中
 * 5. Web overlay rect 优先于 terminal target 命中, 右键也复用同一套规则
 */
const SWIFT_PATH = resolve(
  import.meta.dirname,
  "../../native/Sources/GhosttyBridge/GhosttyBridge.swift"
);
const SOURCE = readFileSync(SWIFT_PATH, "utf8");
const TERMINAL_SCROLL_CONTAINER_PATH = resolve(
  import.meta.dirname,
  "../../native/Sources/GhosttyBridge/TerminalScrollContainer.swift"
);
const SPM_APP_TERMINAL_SCROLL_VIEW_PATH = resolve(
  import.meta.dirname,
  "../../native/Vendor/libghostty-spm/Sources/GhosttyTerminal/Platform/AppKit/AppTerminalScrollView.swift"
);

const WINDOW_TO_BROWSER_ID_DECL_RE =
  /windowToBrowserWindowId: \[ObjectIdentifier: Int\]/;
const SETUP_WINDOW_REMEMBERS_RE =
  /windowToBrowserWindowId\[windowId\] = browserWindowId/;
const DETACH_FORGETS_RE =
  /windowToBrowserWindowId\.removeValue\(forKey: windowId\)/;

const EVENT_DELEGATE_HOLDS_BROWSER_ID_RE = /let browserWindowId: Int/;
const EVENT_DELEGATE_INIT_RE = /init\(panelId: String, browserWindowId: Int\)/;

const CLOSE_CLEARS_STALE_STATE_RE =
  /if state\.activeTerminalPanelId == panelId \{\s*state\.keyboardFocusTarget = \.web/;

const TARGETS_DICT_RE = /var targets: \[String: Target\]/;
const HIT_ITERATES_TARGETS_RE =
  /for \(panelId, target\) in targets \{[\s\S]*?target\.rect\.contains/;
const HIT_TEST_WEB_OVERLAY_FIRST_RE =
  /if containsWebOverlay\(local\) \{[\s\S]{0,80}?return nil[\s\S]{0,160}?terminalTarget\(at: local\)/;
const RIGHT_MOUSE_WEB_OVERLAY_FIRST_RE =
  /if containsWebOverlay\(local\) \{[\s\S]{0,80}?return event[\s\S]{0,160}?terminalTarget\(at: local\)/;
const FORBIDDEN_HIDE_GUARD_RE =
  /guard panelId != activePanelId else \{ return \}/;
const FORBIDDEN_GLOBAL_ACTIVE_PANEL_ID_RE =
  /private var activePanelId: String\?/;
const FOCUS_INTENT_FORWARDS_ONLY_RE =
  /private func activateFocusIntent\(\) \{\s*Self\.forwardFocusRequestCallback\?\(browserWindowId, panelId\)\s*\}/;
const OTHER_MOUSE_DOWN_FOCUSES_BEFORE_FORWARD_RE =
  /override func otherMouseDown\(with event: NSEvent\) \{[\s\S]*?capturedTerminalMouseButton = \.other[\s\S]*?activateFocusIntent\(\)[\s\S]*?terminalView\.otherMouseDown\(with: event\)/;
const FORBIDDEN_NATIVE_FOCUS_MUTATION_RE =
  /GhosttyBridgeImpl\.shared\.focus\(panelId:|func focus\(panelId: String\)|state\.keyboardFocusTarget = \.terminal\(panelId\)/;
const TERMINAL_VIEW_MOUSE_FOCUS_POLICY_DECL_RE =
  /open var focusesOnMouseDown = true/;
const TERMINAL_VIEW_HOST_KEYBOARD_POLICY_DECL_RE =
  /open var hostKeyboardActive = true[\s\S]*?synchronizeHostFocusState\(\)/;
const TERMINAL_VIEW_MOUSE_FOCUS_POLICY_GUARD_RE =
  /if focusesOnMouseDown \{\s*window\?\.makeFirstResponder\(self\)\s*\}/g;
const BRIDGE_DISABLES_TERMINAL_VIEW_MOUSE_FOCUS_RE =
  /let terminalView = TerminalView\(frame: \.zero\)\s*terminalView\.focusesOnMouseDown = false\s*terminalView\.hostKeyboardActive = false/;
const FORBIDDEN_INPUT_ROUTING_RUNTIME_CURSOR_CONFIG_RE =
  /applyInputRouting\([\s\S]*?applyTerminalRuntimeConfiguration\(window: parent\)/;
const FORBIDDEN_TERMINAL_CURSOR_VISIBILITY_CONFIG_RE =
  /terminalCursorVisible|terminalCursorOpacity|terminalCursorBlink|withCursorOpacity/;
const APPKIT_FOCUS_GATED_BY_HOST_RE =
  /override open func becomeFirstResponder\(\) -> Bool \{[\s\S]*?synchronizeHostFocusState\(\)[\s\S]*?\}/;
const APPKIT_FORBIDS_UNCONDITIONAL_SURFACE_FOCUS_RE =
  /override open func becomeFirstResponder\(\) -> Bool \{[\s\S]*?core\.setFocus\(true\)[\s\S]*?\}/;
const INPUT_ROUTING_APPLIES_HOST_FOCUS_RE =
  /term\.terminalView\.hostKeyboardActive = hostKeyboardActive[\s\S]*?term\.terminalView\.synchronizeHostFocusState\(\)/;
const APPKIT_COMMANDS_GATED_BY_HOST_RE =
  /override open func doCommand\(by selector: Selector\) \{\s*guard hostKeyboardActive else \{ return \}/;
const APPKIT_COPY_GATED_BY_HOST_RE =
  /@IBAction open func copy\(_:\s*Any\?\) \{\s*guard hostKeyboardActive else \{ return \}/;
const APPKIT_PASTE_GATED_BY_HOST_RE =
  /@IBAction func paste\(_:\s*Any\?\) \{\s*guard hostKeyboardActive else \{ return \}/;
const APPKIT_SELECT_ALL_GATED_BY_HOST_RE =
  /@IBAction override open func selectAll\(_:\s*Any\?\) \{\s*guard hostKeyboardActive else \{ return \}/;
const FORBIDDEN_TERMINAL_OVERLAY_SCROLLBAR_RE =
  /TerminalScrollbarOverlayView|thumbRect|scrollbarPaintedWidth|scroll_page_lines/;
const SPM_SCROLL_VIEW_CLASS_RE =
  /public final class AppTerminalScrollView: NSView/;
const SPM_OWNS_NATIVE_SCROLL_VIEW_RE =
  /private let scrollView = FocusNotifyingScrollView\(\)[\s\S]*?private final class FocusNotifyingScrollView: NSScrollView/;
const SPM_LIVE_SCROLL_RE =
  /NSScrollView\.didLiveScrollNotification[\s\S]*?scroll_to_row/;
const SPM_MOUSE_MOVED_METHOD_RE =
  /public override func mouseMoved\(with event: NSEvent\) \{(?<body>[\s\S]*?)\n {8}\}/;

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

  it("close clears stale terminal keyboard target to avoid use-after-free in applyFirstResponder", () => {
    // close 后 NSView removeFromSuperview, 但如果 state.activeTerminalPanelId
    // 还指向它, 下次 applyFirstResponder 调 terminals[id] 会拿 nil. 必须主动回到 Web.
    expect(SOURCE).toMatch(CLOSE_CLEARS_STALE_STATE_RE);
  });

  it("EventRouterView.targets is keyed by panelId, hit-tested by iterating", () => {
    // 多 panel hitTest 区分:dict keyed by panelId, hitTest 遍历找第一个 rect 命中
    // 的 target. dict 保证不同 panel 独立, 遍历保证一个 hit point 只命中一个.
    expect(SOURCE).toMatch(TARGETS_DICT_RE);
    expect(SOURCE).toMatch(HIT_ITERATES_TARGETS_RE);
  });

  it("routes Web overlay rects before terminal targets for hitTest and right click", () => {
    expect(SOURCE).toMatch(HIT_TEST_WEB_OVERLAY_FIRST_RE);
    expect(SOURCE).toMatch(RIGHT_MOUSE_WEB_OVERLAY_FIRST_RE);
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

  it("only forwards terminal focus intent instead of mutating native keyboard target", () => {
    const scrollContainerSource = readFileSync(
      TERMINAL_SCROLL_CONTAINER_PATH,
      "utf8"
    );
    expect(scrollContainerSource).toMatch(FOCUS_INTENT_FORWARDS_ONLY_RE);
    expect(scrollContainerSource).not.toMatch(
      FORBIDDEN_NATIVE_FOCUS_MUTATION_RE
    );
    expect(SOURCE).not.toMatch(FORBIDDEN_NATIVE_FOCUS_MUTATION_RE);
  });

  it("disables Ghostty mouse-down first responder changes for Pier terminals", () => {
    const appTerminalViewSource = readFileSync(
      resolve(
        import.meta.dirname,
        "../../native/Vendor/libghostty-spm/Sources/GhosttyTerminal/Platform/AppKit/AppTerminalView.swift"
      ),
      "utf8"
    );
    const appTerminalInputSource = readFileSync(
      resolve(
        import.meta.dirname,
        "../../native/Vendor/libghostty-spm/Sources/GhosttyTerminal/Platform/AppKit/AppTerminalView+Input.swift"
      ),
      "utf8"
    );
    expect(appTerminalViewSource).toMatch(
      TERMINAL_VIEW_MOUSE_FOCUS_POLICY_DECL_RE
    );
    expect(appTerminalInputSource).toMatch(
      TERMINAL_VIEW_MOUSE_FOCUS_POLICY_GUARD_RE
    );
    expect(
      appTerminalInputSource.match(TERMINAL_VIEW_MOUSE_FOCUS_POLICY_GUARD_RE)
    ).toHaveLength(3);
    expect(SOURCE).toMatch(BRIDGE_DISABLES_TERMINAL_VIEW_MOUSE_FOCUS_RE);
  });

  it("forwards auxiliary mouse focus intent without native keyboard mutation", () => {
    const scrollContainerSource = readFileSync(
      TERMINAL_SCROLL_CONTAINER_PATH,
      "utf8"
    );
    expect(scrollContainerSource).toMatch(
      OTHER_MOUSE_DOWN_FOCUSES_BEFORE_FORWARD_RE
    );
  });

  it("gates Ghostty surface focus through per-surface host keyboard ownership", () => {
    const appTerminalViewSource = readFileSync(
      resolve(
        import.meta.dirname,
        "../../native/Vendor/libghostty-spm/Sources/GhosttyTerminal/Platform/AppKit/AppTerminalView.swift"
      ),
      "utf8"
    );
    const appTerminalLifecycleSource = readFileSync(
      resolve(
        import.meta.dirname,
        "../../native/Vendor/libghostty-spm/Sources/GhosttyTerminal/Platform/AppKit/AppTerminalView+Lifecycle.swift"
      ),
      "utf8"
    );
    expect(appTerminalViewSource).toMatch(
      TERMINAL_VIEW_HOST_KEYBOARD_POLICY_DECL_RE
    );
    expect(appTerminalLifecycleSource).toMatch(APPKIT_FOCUS_GATED_BY_HOST_RE);
    expect(appTerminalLifecycleSource).not.toMatch(
      APPKIT_FORBIDS_UNCONDITIONAL_SURFACE_FOCUS_RE
    );
    expect(SOURCE).toMatch(INPUT_ROUTING_APPLIES_HOST_FOCUS_RE);
    expect(SOURCE).not.toMatch(
      FORBIDDEN_INPUT_ROUTING_RUNTIME_CURSOR_CONFIG_RE
    );
    expect(SOURCE).not.toMatch(FORBIDDEN_TERMINAL_CURSOR_VISIBILITY_CONFIG_RE);
  });

  it("gates AppKit text commands and menu actions through host keyboard ownership", () => {
    const appTerminalInputSource = readFileSync(
      resolve(
        import.meta.dirname,
        "../../native/Vendor/libghostty-spm/Sources/GhosttyTerminal/Platform/AppKit/AppTerminalView+Input.swift"
      ),
      "utf8"
    );
    expect(appTerminalInputSource).toMatch(APPKIT_COMMANDS_GATED_BY_HOST_RE);
    expect(appTerminalInputSource).toMatch(APPKIT_COPY_GATED_BY_HOST_RE);
    expect(appTerminalInputSource).toMatch(APPKIT_PASTE_GATED_BY_HOST_RE);
    expect(appTerminalInputSource).toMatch(APPKIT_SELECT_ALL_GATED_BY_HOST_RE);
  });

  it("uses the Ghostty SPM AppKit scroll view instead of a Pier-drawn overlay scrollbar", () => {
    const scrollContainerSource = readFileSync(
      TERMINAL_SCROLL_CONTAINER_PATH,
      "utf8"
    );
    expect(scrollContainerSource).not.toMatch(
      FORBIDDEN_TERMINAL_OVERLAY_SCROLLBAR_RE
    );

    expect(existsSync(SPM_APP_TERMINAL_SCROLL_VIEW_PATH)).toBe(true);
    const appTerminalScrollViewSource = readFileSync(
      SPM_APP_TERMINAL_SCROLL_VIEW_PATH,
      "utf8"
    );
    expect(appTerminalScrollViewSource).toMatch(SPM_SCROLL_VIEW_CLASS_RE);
    expect(appTerminalScrollViewSource).toMatch(SPM_OWNS_NATIVE_SCROLL_VIEW_RE);
    expect(appTerminalScrollViewSource).toMatch(SPM_LIVE_SCROLL_RE);
  });

  it("applyFirstResponder web branch must not makeFirstResponder(nil)", () => {
    const src = readFileSync(SWIFT_PATH, "utf8");
    const fnStart = src.indexOf("func applyFirstResponder(for window");
    expect(fnStart).toBeGreaterThan(-1);
    const webBranchStart = src.indexOf("if activeTerminalId == nil", fnStart);
    expect(webBranchStart).toBeGreaterThan(-1);
    const webBranch = src.slice(webBranchStart, webBranchStart + 500);
    expect(webBranch).not.toContain("makeFirstResponder(nil)");
  });

  it("does not let AppTerminalScrollView.mouseMoved recurse through AppKit responder forwarding", () => {
    expect(existsSync(SPM_APP_TERMINAL_SCROLL_VIEW_PATH)).toBe(true);
    const appTerminalScrollViewSource = readFileSync(
      SPM_APP_TERMINAL_SCROLL_VIEW_PATH,
      "utf8"
    );
    const mouseMoved = appTerminalScrollViewSource.match(
      SPM_MOUSE_MOVED_METHOD_RE
    );
    expect(mouseMoved?.groups?.body).toContain("scrollView.flashScrollers()");
    expect(mouseMoved?.groups?.body).not.toContain("super.mouseMoved");
  });
});
