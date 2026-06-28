# 终端输入与焦点架构重构 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把终端键盘焦点的唯一权威下沉到 native，消除终端区焦点闪烁与竞态，并让任何浮在终端上的 web 元素天然免疫同类问题。

**Architecture:** native 持有每窗口的 `FocusArbiter`（`basePanel` + `webRequests` → 派生 `effectiveTarget`）作为 Level 1 焦点权威；renderer 退化为意图发送器（dockview 活跃面板 + 浮层 web 焦点请求），不再计算 effective、不再用 DOM 焦点事件回写状态；native 的 `applyFirstResponder` 投影改为不再 `makeFirstResponder(nil)`、幂等且目标校验。

**Tech Stack:** Swift（GhosttyBridge + XCTest）、Electron main（TypeScript）、React renderer（Zustand）、Vitest、IPC JSON 快照。

**前置约定：**
- 设计依据：`docs/superpowers/specs/2026-06-29-terminal-input-focus-architecture-design.md`。
- Git：按项目 `AGENTS.md`，提交前 stage 明确路径、展示 `git diff --staged`、等用户确认；计划中的 commit 步骤遵循该约定。
- Swift 测试运行：`swift test --package-path native --filter <Name>`。
- 单测运行：`pnpm vitest run <file>`；类型检查：`pnpm typecheck`；完整检查：`pnpm check`。
- 里程碑顺序：M1 纯逻辑 → M2 投影 + 真机验证 → M3 契约/main → M4 renderer → M5 结构锁与回归 → M6 冗余清理 →（可选）M7 native 本地 mouse-down 决策。

---

## 文件结构

**native（Swift）**
- 修改：`native/Sources/GhosttyBridge/GhosttyBridge.swift` — `WindowKeyboardState` 扩成 arbiter；`applyInputRouting`/`keyboardFocusTarget(from:)` 改为消费 base+webRequests；`applyFirstResponder` web 路径修正；新增意图入口。
- 新建：`native/Tests/GhosttyBridgeTests/FocusArbiterTests.swift` — arbiter 归约 + 投影单测。

**IPC 契约（TypeScript）**
- 修改：`src/shared/contracts/terminal.ts` — `TerminalInputRoutingSnapshot` 改 payload；删 `WebFocusScopeKind` 与 `TerminalKeyboardFocusTarget.scope`。

**main（TypeScript）**
- 修改：`src/main/ipc/terminal-presentation.ts` — effective 计算消费新 payload。
- 修改：`src/main/ipc/terminal-focus-state.ts` — web 聚焦判定消费新 effective。

**renderer（TypeScript）**
- 修改：`src/renderer/stores/terminal-input-routing.store.ts` — 删 effective/base-map/scope-kind，加薄意图发送器。
- 新建：`src/renderer/panel-kits/terminal/use-terminal-web-focus.ts` — 浮层焦点契约 hook。
- 修改：`src/renderer/panel-kits/terminal/terminal-search-bar.tsx` — 用新 hook，删 onFocus/onBlur 反馈。
- 删除：`src/renderer/panel-kits/terminal/use-terminal-search-keyboard-opening.ts`。
- 修改：`src/renderer/components/workspace/workspace-host.tsx` — `onFocusRequest` 与活跃面板同步改用 `setBasePanel` 意图。

**测试**
- 修改：`tests/unit/native-terminal-state-invariants.test.ts` — 锁新不变量。
- 修改：`tests/unit/renderer/stores/terminal-input-routing.test.ts` — 新意图发送器行为。

---

## M1：native FocusArbiter 归约（纯逻辑，完整 TDD）

### Task 1: WindowKeyboardState 扩成 arbiter

**Files:**
- Modify: `native/Sources/GhosttyBridge/GhosttyBridge.swift:623-636`（`WindowKeyboardState` 结构）
- Test: `native/Tests/GhosttyBridgeTests/FocusArbiterTests.swift`（新建）

- [ ] **Step 1: 写失败测试**

新建 `native/Tests/GhosttyBridgeTests/FocusArbiterTests.swift`：

```swift
@testable import GhosttyBridge
import XCTest

final class FocusArbiterTests: XCTestCase {
    func testEmptyWebRequestsFollowsBasePanel() {
        var s = GhosttyBridgeImpl.WindowKeyboardState()
        s.basePanel = .terminal("terminal-1")
        XCTAssertEqual(s.effectiveTarget, .terminal("terminal-1"))
    }

    func testAnyWebRequestForcesWeb() {
        var s = GhosttyBridgeImpl.WindowKeyboardState()
        s.basePanel = .terminal("terminal-1")
        s.webRequests = ["search:terminal-1"]
        XCTAssertEqual(s.effectiveTarget, .web)
    }

    func testReleasingLastWebRequestRestoresBasePanel() {
        var s = GhosttyBridgeImpl.WindowKeyboardState()
        s.basePanel = .terminal("terminal-1")
        s.webRequests = ["search:terminal-1"]
        s.webRequests.removeAll { $0 == "search:terminal-1" }
        XCTAssertEqual(s.effectiveTarget, .terminal("terminal-1"))
    }

    func testAcceptsTerminalKeyboardRequiresWindowFocusAndTerminalTarget() {
        var s = GhosttyBridgeImpl.WindowKeyboardState()
        s.basePanel = .terminal("terminal-1")
        s.windowFocused = false
        XCTAssertFalse(s.acceptsTerminalKeyboard)
        s.windowFocused = true
        XCTAssertTrue(s.acceptsTerminalKeyboard)
        s.webRequests = ["x"]
        XCTAssertFalse(s.acceptsTerminalKeyboard)
    }
}
```

需要让 `KeyboardFocusTarget` 可 `Equatable`、`WindowKeyboardState` 对测试可见。`KeyboardFocusTarget` 与 `WindowKeyboardState` 当前是 `GhosttyBridgeImpl` 的嵌套类型，已可 `@testable` 访问；为断言相等给 enum 加 `Equatable`。

- [ ] **Step 2: 运行确认失败**

Run: `swift test --package-path native --filter FocusArbiterTests`
Expected: 编译失败（`effectiveTarget` 不存在 / `KeyboardFocusTarget` 非 Equatable）。

- [ ] **Step 3: 改 WindowKeyboardState**

`GhosttyBridge.swift` 中把 enum 标 `Equatable`，并重写结构（替换 `:623-636`）：

```swift
    enum KeyboardFocusTarget: Equatable {
        case terminal(String)
        case web

        var panelId: String? {
            switch self {
            case .terminal(let panelId): return panelId
            case .web: return nil
            }
        }

        var debugPayload: [String: Any] {
            switch self {
            case .terminal(let panelId): return ["kind": "terminal", "panelId": panelId]
            case .web: return ["kind": "web"]
            }
        }
    }

    /// Per-window 焦点仲裁状态。basePanel = dockview 活跃面板意图；webRequests =
    /// 浮在终端上的 web 元素的焦点请求栈。effectiveTarget 是唯一派生真相。
    struct WindowKeyboardState {
        var basePanel: KeyboardFocusTarget = .web
        var webRequests: [String] = []
        var windowFocused = false

        var effectiveTarget: KeyboardFocusTarget {
            webRequests.isEmpty ? basePanel : .web
        }

        var activeTerminalPanelId: String? {
            effectiveTarget.panelId
        }

        var acceptsTerminalKeyboard: Bool {
            windowFocused && activeTerminalPanelId != nil
        }
    }
```

- [ ] **Step 4: 运行确认通过**

Run: `swift test --package-path native --filter FocusArbiterTests`
Expected: 4 测试 PASS。

- [ ] **Step 5: 提交**

```bash
git add native/Sources/GhosttyBridge/GhosttyBridge.swift native/Tests/GhosttyBridgeTests/FocusArbiterTests.swift
git commit -m "feat(terminal): arbiter state derives effectiveTarget from base + web requests"
```

### Task 2: native 意图入口（setBasePanel / requestWebFocus / releaseWebFocus）

**Files:**
- Modify: `native/Sources/GhosttyBridge/GhosttyBridge.swift`（在 `mutateState` 附近新增方法，约 `:654` 后）
- Test: `native/Tests/GhosttyBridgeTests/FocusArbiterTests.swift`

- [ ] **Step 1: 写失败测试**

在 `FocusArbiterTests.swift` 追加（用 `TestKeyWindow` 复用现有测试基建里的同名辅助；若该 helper 在别的测试文件 private，则在本文件再定义一个 `private final class TestKeyWindow: NSWindow { override var isKeyWindow: Bool { true } }`）：

```swift
@MainActor
final class FocusArbiterIntentTests: XCTestCase {
    func testRequestAndReleaseWebFocusTogglesEffectiveTarget() {
        let impl = GhosttyBridgeImpl.shared
        let win = NSWindow()
        impl.setBasePanelForTesting(win, .terminal("terminal-1"))
        XCTAssertEqual(impl.stateFor(window: win).effectiveTarget, .terminal("terminal-1"))

        impl.requestWebFocus(window: win, id: "search:terminal-1")
        XCTAssertEqual(impl.stateFor(window: win).effectiveTarget, .web)

        impl.releaseWebFocus(window: win, id: "search:terminal-1")
        XCTAssertEqual(impl.stateFor(window: win).effectiveTarget, .terminal("terminal-1"))
    }

    func testDuplicateRequestIsIdempotent() {
        let impl = GhosttyBridgeImpl.shared
        let win = NSWindow()
        impl.requestWebFocus(window: win, id: "a")
        impl.requestWebFocus(window: win, id: "a")
        impl.releaseWebFocus(window: win, id: "a")
        XCTAssertTrue(impl.stateFor(window: win).webRequests.isEmpty)
    }
}
```

- [ ] **Step 2: 运行确认失败**

Run: `swift test --package-path native --filter FocusArbiterIntentTests`
Expected: 失败（`requestWebFocus` / `setBasePanelForTesting` 不存在）。

- [ ] **Step 3: 实现意图入口**

在 `GhosttyBridgeImpl`（`mutateState` 之后）新增：

```swift
    func setBasePanel(window: NSWindow, target: KeyboardFocusTarget) {
        mutateState(window) { $0.basePanel = target }
        applyFirstResponder(for: window)
    }

    func requestWebFocus(window: NSWindow, id: String) {
        mutateState(window) {
            if !$0.webRequests.contains(id) { $0.webRequests.append(id) }
        }
        applyFirstResponder(for: window)
    }

    func releaseWebFocus(window: NSWindow, id: String) {
        mutateState(window) { $0.webRequests.removeAll { $0 == id } }
        applyFirstResponder(for: window)
    }

    // 仅测试用：绕过 IPC 直接设 basePanel。
    func setBasePanelForTesting(_ window: NSWindow, _ target: KeyboardFocusTarget) {
        mutateState(window) { $0.basePanel = target }
    }
```

- [ ] **Step 4: 运行确认通过**

Run: `swift test --package-path native --filter FocusArbiterIntentTests`
Expected: 2 测试 PASS。

- [ ] **Step 5: 提交**

```bash
git add native/Sources/GhosttyBridge/GhosttyBridge.swift native/Tests/GhosttyBridgeTests/FocusArbiterTests.swift
git commit -m "feat(terminal): native focus arbiter intent entrypoints"
```

---

## M2：native 投影修正 + 真机验证

### Task 3: applyFirstResponder web 路径不再 makeFirstResponder(nil)

**Files:**
- Modify: `native/Sources/GhosttyBridge/GhosttyBridge.swift:1046-1084`（`applyFirstResponder`）
- Test: `native/Tests/GhosttyBridgeTests/FocusArbiterTests.swift`

- [ ] **Step 1: 写失败测试**

追加一个用真实 surface 的投影测试。复用 `TerminalHostResizeTests.swift` 里创建 surface 的模式（`@testable` 可访问 `terminals` 字典与 `applyFirstResponder`）：

```swift
@MainActor
final class FocusArbiterProjectionTests: XCTestCase {
    func testWebTargetDoesNotClearWindowFirstResponderToNil() throws {
        let impl = GhosttyBridgeImpl.shared
        let win = TestKeyWindow(
            contentRect: NSRect(x: 0, y: 0, width: 400, height: 300),
            styleMask: [.titled], backing: .buffered, defer: false
        )
        // 安装一个测试用的非终端 firstResponder，模拟 web 视图占位
        let webStub = FocusableStubView()
        win.contentView?.addSubview(webStub)
        win.makeFirstResponder(webStub)

        impl.setBasePanelForTesting(win, .web)
        mutateWindowFocusedForTesting(impl, win, true)
        impl.applyFirstResponder(for: win)

        // web target 下不得把 firstResponder 砸成 nil（不得 resign 掉 web 占位）
        XCTAssertTrue(win.firstResponder === webStub)
    }
}

private final class FocusableStubView: NSView {
    override var acceptsFirstResponder: Bool { true }
}
```

（若 `windowFocused` 无测试 setter，则在 Task 2 的 testing helper 同位置加 `func mutateWindowFocusedForTesting(_ impl: GhosttyBridgeImpl, _ win: NSWindow, _ v: Bool)` 经 `mutateState` 设置；或直接用 `setBasePanelForTesting` 同款 helper 设 `windowFocused`。）

- [ ] **Step 2: 运行确认失败**

Run: `swift test --package-path native --filter FocusArbiterProjectionTests`
Expected: 失败 —— 当前代码 `activeTerminalId == nil` 分支会在 web 占位非终端时…（确认现状：当前分支只在 firstResponder 是某终端 view 时才 `makeFirstResponder(nil)`，所以本测试可能已经过。若已过，调整断言为：构造 firstResponder 是某终端 view 的情形，验证修正前会被砸 nil、修正后保留/转交。见 Step 3 的精确语义。）

- [ ] **Step 3: 修正 web 路径**

替换 `:1066-1083` 的 `activeTerminalId == nil` 分支为：web target 时只压低各终端 surface 的 `hostKeyboardActive` 并 resign 仍是终端 view 的 firstResponder（让 AppKit 走 nextResponder），但不无条件 `makeFirstResponder(nil)` 抹平 web 占位：

```swift
        if activeTerminalId == nil {
            // web 拥有键盘：压低所有终端 surface，仅当 firstResponder 仍是某终端
            // view 时让它 resign，交还 nextResponder 链（web 视图）。不把
            // firstResponder 砸成 nil —— 那会连带 resign 掉 Chromium web 视图，
            // 触发 blur→focus 抖动（根因 D）。web 层聚焦由 main 调
            // webContents.focus() 负责。
            for (_, term) in terminals
                where ObjectIdentifier(term.parentWindow) == windowId {
                term.terminalView.hostKeyboardActive = false
                if window.firstResponder === term.terminalView {
                    _ = term.terminalView.resignFirstResponder()
                }
            }
            return
        }
```

- [ ] **Step 4: 运行确认通过**

Run: `swift test --package-path native --filter "FocusArbiter"`
Expected: M1+M2 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add native/Sources/GhosttyBridge/GhosttyBridge.swift native/Tests/GhosttyBridgeTests/FocusArbiterTests.swift
git commit -m "fix(terminal): web focus target stops slamming firstResponder to nil"
```

### Task 4: 真机验证 Q2（webContents.focus 抢回行为）

**Files:**
- 临时：`tests/e2e/_q2-probe.spec.ts`（验证后删除）

- [ ] **Step 1: 构建并运行真机 dev 会话**

Run: `pnpm build && pnpm dev`
在真实 macOS 会话（应用为前台 key window）下：开一个终端，点进去聚焦，按 `Mod+KeyF` 开搜索。

- [ ] **Step 2: 用 debug window 观测 firstResponder**

在 devtools console 执行多次 `await window.pier.terminal.debugSnapshot()`，记录开搜索后 1–2 秒内 `native.surfaces[0].isFirstResponder`、`native.window.keyboardFocusTarget`：
- 期望：搜索打开后 target=web、surface isFirstResponder 稳定为 false，无来回翻转；搜索框 caret 稳定。
- 若仍翻转：记录现象，说明 Electron 42 下 webContents.focus() 抢回不稳，需在 Task 7 引入限频 reassert + 目标校验加固；键盘仍由 `acceptsTerminalKeyboard` 兜底不漏键。

- [ ] **Step 3: 记录结论到设计文档第 9 节**

把真机结论补进 spec 第 9 节（「Q2 真机实测：稳定/需加固」）。

- [ ] **Step 4: 提交结论**

```bash
git add docs/superpowers/specs/2026-06-29-terminal-input-focus-architecture-design.md
git commit -m "docs(terminal): record Q2 firstResponder retention result"
```

---

## M3：IPC 契约 + main 改用 base/webRequests

### Task 5: 改 TerminalInputRoutingSnapshot 契约

**Files:**
- Modify: `src/shared/contracts/terminal.ts:29-51`
- Test: `tests/unit/shared/terminal-debug-diagnostics.test.ts`（若引用了被删字段，需同步）

- [ ] **Step 1: 改契约类型**

替换 `:29-51`：

```ts
export type TerminalKeyboardFocusTarget =
  | { kind: "terminal"; panelId: string }
  | { kind: "web" };

export interface TerminalInputRoutingSnapshot {
  /** dockview 活跃面板意图（terminal | web）。 */
  basePanel: TerminalKeyboardFocusTarget;
  /** 当前活跃的浮层 web 焦点请求数；>0 即 effective=web。 */
  webRequestCount: number;
  rendererSequence: number;
  webOverlayRects: TerminalWebOverlayRect[];
}

export interface TerminalNativeInputRoutingSnapshot
  extends TerminalInputRoutingSnapshot {
  nativeApplySequence: number;
  windowFocused: boolean;
}
```

删除 `WebFocusScopeKind` 类型（整行 `export type WebFocusScopeKind = ...`）。`TerminalNativeInputRoutingSnapshot.keyboardFocusTarget` 的所有读取点改为读 `basePanel` + `webRequestCount`（见 Task 6/7）。

- [ ] **Step 2: 运行类型检查确认断点**

Run: `pnpm typecheck`
Expected: 在 `terminal-presentation.ts` / `terminal-focus-state.ts` / 渲染层 store / 搜索框报出所有 `keyboardFocusTarget` / `WebFocusScopeKind` 引用错误 —— 这就是后续任务的待改清单。

- [ ] **Step 3: 提交（仅契约，允许下游暂红）**

本步不单独提交；与 Task 6 一起在 main 编译通过后提交，避免中间不可编译态。

### Task 6: main effective 计算消费新 payload

**Files:**
- Modify: `src/main/ipc/terminal-presentation.ts:52-72,108-120`
- Modify: `src/main/ipc/terminal-focus-state.ts:16-40`
- Test: `tests/unit/main/terminal-focus-state.test.ts`（已存在，调整断言）

- [ ] **Step 1: 写/改失败测试**

在 `tests/unit/main/terminal-focus-state.test.ts` 加：

```ts
it("effective target is web when webRequestCount > 0 even if basePanel is terminal", () => {
  const effective = computeEffectiveKeyboardTarget(
    { kind: "terminal", panelId: "terminal-1" },
    1
  );
  expect(effective).toEqual({ kind: "web" });
});

it("effective target follows basePanel when no web requests", () => {
  const effective = computeEffectiveKeyboardTarget(
    { kind: "terminal", panelId: "terminal-1" },
    0
  );
  expect(effective).toEqual({ kind: "terminal", panelId: "terminal-1" });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run tests/unit/main/terminal-focus-state.test.ts`
Expected: 失败（`computeEffectiveKeyboardTarget` 未导出）。

- [ ] **Step 3: 实现并接线**

在 `terminal-presentation.ts` 新增并导出纯函数，替换原先直接读 `keyboardFocusTarget` 的 `terminalFocusPanelId`：

```ts
export function computeEffectiveKeyboardTarget(
  basePanel: TerminalKeyboardFocusTarget,
  webRequestCount: number
): TerminalKeyboardFocusTarget {
  return webRequestCount > 0 ? { kind: "web" } : basePanel;
}

function terminalFocusPanelId(
  inputRouting: TerminalInputRoutingSnapshot,
  windowFocused: boolean
): string | null {
  const effective = computeEffectiveKeyboardTarget(
    inputRouting.basePanel,
    inputRouting.webRequestCount
  );
  if (!windowFocused || effective.kind !== "terminal") {
    return null;
  }
  return effective.panelId;
}
```

`desiredInputRouting` 默认值改为 `{ basePanel: { kind: "web" }, webRequestCount: 0, rendererSequence: 0, webOverlayRects: [] }`。
`terminal-focus-state.ts` 的 `focusWebContentsForEffectiveInputRouting` 把 `effective.keyboardFocusTarget` 改为先 `computeEffectiveKeyboardTarget(effective.basePanel, effective.webRequestCount)` 再判 `kind`。
`scopeKeyboardFocusTarget` / `scopeNativeInputRouting` 改为 scope `basePanel`。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm vitest run tests/unit/main/terminal-focus-state.test.ts && pnpm typecheck`
Expected: 测试 PASS；main 侧类型错误清零（renderer 侧仍红，下一里程碑处理）。

- [ ] **Step 5: 提交**

```bash
git add src/shared/contracts/terminal.ts src/main/ipc/terminal-presentation.ts src/main/ipc/terminal-focus-state.ts tests/unit/main/terminal-focus-state.test.ts
git commit -m "refactor(terminal): main computes effective target from base + web request count"
```

### Task 7: native 解析新 payload + 限频目标校验加固

**Files:**
- Modify: `native/Sources/GhosttyBridge/GhosttyBridge.swift:980-1023`（`applyInputRouting` / `keyboardFocusTarget(from:)`）、addon.mm 的输入路由 JSON 解析
- Test: `native/Tests/GhosttyBridgeTests/FocusArbiterTests.swift`

- [ ] **Step 1: 写失败测试**

```swift
func testApplyInputRoutingSetsBaseAndWebRequestsFromSnapshot() {
    let impl = GhosttyBridgeImpl.shared
    let win = NSWindow()
    impl.applyInputRoutingForTesting(
        win, basePanelKind: "terminal", basePanelId: "terminal-1",
        webRequestCount: 0, windowFocused: true
    )
    XCTAssertEqual(impl.stateFor(window: win).effectiveTarget, .terminal("terminal-1"))
    impl.applyInputRoutingForTesting(
        win, basePanelKind: "terminal", basePanelId: "terminal-1",
        webRequestCount: 2, windowFocused: true
    )
    XCTAssertEqual(impl.stateFor(window: win).effectiveTarget, .web)
}
```

- [ ] **Step 2: 运行确认失败**

Run: `swift test --package-path native --filter FocusArbiterTests`
Expected: 失败（helper 与解析未实现）。

- [ ] **Step 3: 实现解析**

`applyInputRouting(parent:inputRouting:)` 的 `mutateState` 块改为：

```swift
        mutateState(parent) { state in
            state.basePanel = Self.basePanel(from: inputRouting)
            state.webRequests = inputRouting.webRequestCount > 0
                ? Array(repeating: "ipc", count: inputRouting.webRequestCount)
                : []
            state.windowFocused = inputRouting.windowFocused
        }
        applyFirstResponder(for: parent)
```

把 `keyboardFocusTarget(from:)` 重命名/改为 `basePanel(from:)`，解析 `inputRouting.basePanel`。`TerminalInputRoutingEnvelope` 的解码字段从 `keyboardFocusTarget` 改为 `basePanel` + `webRequestCount`（同步 addon.mm 的 JSON 取值与 envelope 结构）。新增测试 helper `applyInputRoutingForTesting(...)` 构造 envelope 走同路径。

> 说明：native 侧用 `webRequestCount` 重建一个等长占位数组即可满足 `effectiveTarget` 判定；webRequests 的具体 id 是 renderer 内部事，native 只需「有没有」。

- [ ] **Step 4: 运行确认通过**

Run: `swift test --package-path native --filter "FocusArbiter"`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add native/Sources/GhosttyBridge/GhosttyBridge.swift native/Tests/GhosttyBridgeTests/FocusArbiterTests.swift native/src/addon.mm
git commit -m "refactor(terminal): native input routing consumes base panel + web request count"
```

---

## M4：renderer 退化为意图发送器

### Task 8: store 删 effective/scope-map，加薄意图发送器

**Files:**
- Modify: `src/renderer/stores/terminal-input-routing.store.ts`
- Test: `tests/unit/renderer/stores/terminal-input-routing.test.ts`

- [ ] **Step 1: 写失败测试**

替换/新增（删除引用旧 API 的用例）：

```ts
import {
  setTerminalBasePanel,
  requestTerminalWebFocus,
  getLastTerminalInputRoutingSnapshot,
  resetTerminalInputRoutingForTests,
} from "@/stores/terminal-input-routing.store.ts";

beforeEach(() => resetTerminalInputRoutingForTests());

it("base panel goes into snapshot.basePanel", () => {
  setTerminalBasePanel({ kind: "terminal", panelId: "terminal-1" });
  expect(getLastTerminalInputRoutingSnapshot()?.basePanel).toEqual({
    kind: "terminal",
    panelId: "terminal-1",
  });
  expect(getLastTerminalInputRoutingSnapshot()?.webRequestCount).toBe(0);
});

it("web focus requests increment webRequestCount and release decrements", () => {
  const release = requestTerminalWebFocus("search:terminal-1");
  expect(getLastTerminalInputRoutingSnapshot()?.webRequestCount).toBe(1);
  release();
  expect(getLastTerminalInputRoutingSnapshot()?.webRequestCount).toBe(0);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run tests/unit/renderer/stores/terminal-input-routing.test.ts`
Expected: 失败（新 API 不存在）。

- [ ] **Step 3: 重写 store 焦点部分**

删除 `baseKeyboardFocusTarget` 的 effective 计算、`webFocusScopes` Map、`effectiveKeyboardFocusTarget`、`sameKeyboardFocusTarget`、`registerWebFocusScope`、`hasExclusiveWebFocusScope`、`releaseTransientWebFocusScopes`、`beginFullscreenWebInputCapture` 中的 scope 部分。新增：

```ts
let basePanel: TerminalKeyboardFocusTarget = { kind: "web" };
const webRequestIds = new Set<string>();

function applyTerminalInputRouting(): void {
  rendererSequence += 1;
  const snapshot: TerminalInputRoutingSnapshot = {
    basePanel,
    webRequestCount: webRequestIds.size,
    rendererSequence,
    webOverlayRects: Array.from(webOverlayRects, ([id, frame]) => ({ frame, id })),
  };
  lastSnapshot = snapshot;
  window.pier?.terminal?.applyInputRouting?.(snapshot);
}

export function setTerminalBasePanel(target: TerminalKeyboardFocusTarget): void {
  if (
    basePanel.kind === target.kind &&
    (target.kind === "web" || basePanel.kind === "terminal" && basePanel.panelId === target.panelId)
  ) {
    return;
  }
  basePanel = target;
  applyTerminalInputRouting();
}

export function requestTerminalWebFocus(id: string): () => void {
  if (!webRequestIds.has(id)) {
    webRequestIds.add(id);
    applyTerminalInputRouting();
  }
  return () => {
    if (webRequestIds.delete(id)) {
      applyTerminalInputRouting();
    }
  };
}
```

`beginFullscreenWebInputCapture`（拖拽/sash）改为用 `requestTerminalWebFocus(id)` 拿 release，配合现有 `registerTerminalFullscreenWebOverlay`。`resetTerminalInputRoutingForTests` 重置 `basePanel`/`webRequestIds`。保留 `webOverlayRects` 几何相关函数不动。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm vitest run tests/unit/renderer/stores/terminal-input-routing.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/stores/terminal-input-routing.store.ts tests/unit/renderer/stores/terminal-input-routing.test.ts
git commit -m "refactor(terminal): renderer input routing store sends base + web focus intents"
```

### Task 9: useTerminalWebFocus hook + 搜索框改造 + 删 opening hook

**Files:**
- Create: `src/renderer/panel-kits/terminal/use-terminal-web-focus.ts`
- Modify: `src/renderer/panel-kits/terminal/terminal-search-bar.tsx`
- Modify: `src/renderer/panel-kits/terminal/terminal-panel.tsx`（移除 opening hook 接线）
- Delete: `src/renderer/panel-kits/terminal/use-terminal-search-keyboard-opening.ts`
- Test: `tests/unit/renderer/...`（组件层若有现成 search 测试则同步）

- [ ] **Step 1: 写 hook**

```ts
import { useEffect } from "react";
import { requestTerminalWebFocus } from "@/stores/terminal-input-routing.store.ts";

/** 浮在终端上的 web 元素：可见期间持有一次 web 焦点请求，卸载/隐藏时释放。
 *  纯生命周期驱动，绝不由 DOM focus/blur 事件触发。 */
export function useTerminalWebFocus(id: string, active: boolean): void {
  useEffect(() => {
    if (!active) {
      return;
    }
    const release = requestTerminalWebFocus(id);
    return release;
  }, [id, active]);
}
```

- [ ] **Step 2: 改搜索框**

`terminal-search-bar.tsx`：
- 删除 `ensureSearchKeyboardFocus`/`releaseSearchKeyboardFocus`/`releaseSearchKeyboardRef` 与对应 `useLayoutEffect`/`useEffect`。
- 删除 `<search>` 上的 `onBlurCapture`/`onFocusCapture`。
- 用 `useTerminalWebFocus(\`terminal-search:${panelId}:keyboard\`, visible)` 替代。
- 保留 `registerTerminalElementWebOverlay`（几何）与一次性 `inputRef.focus()`（`focusRequest` 驱动）。

- [ ] **Step 3: 拆 opening hook**

`terminal-panel.tsx`：删除 `useTerminalSearchKeyboardOpening` 的 import、`holdOpeningKeyboardFocus`/`releaseOpeningKeyboardFocus` 接线与 `onKeyboardFocusReady` 传参（搜索框打开期间的 web 焦点已由 `useTerminalWebFocus(visible)` 覆盖）。删除文件 `use-terminal-search-keyboard-opening.ts`。

- [ ] **Step 4: 运行检查**

Run: `pnpm typecheck && pnpm vitest run tests/unit/renderer`
Expected: PASS，无对已删 API 的引用。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/panel-kits/terminal/use-terminal-web-focus.ts src/renderer/panel-kits/terminal/terminal-search-bar.tsx src/renderer/panel-kits/terminal/terminal-panel.tsx
git rm src/renderer/panel-kits/terminal/use-terminal-search-keyboard-opening.ts
git commit -m "refactor(terminal): search bar uses lifecycle web-focus hook, drop focus-event feedback"
```

### Task 10: workspace-host onFocusRequest / 活跃面板同步改用 setBasePanel

**Files:**
- Modify: `src/renderer/components/workspace/workspace-host.tsx`
- Test: `tests/unit/renderer/lib/workspace/terminal-focus-request.test.ts`（已存在，调整）

- [ ] **Step 1: 改调用点**

把所有 `setTerminalBaseKeyboardFocusTarget({ kind: "terminal"/"web", ... })` 改为 `setTerminalBasePanel(...)`。`onFocusRequest` 处理器删除 `releaseTransientWebFocusScopes()` 调用（已不存在），保留「激活 dockview 面板 + `setTerminalBasePanel({kind:"terminal", panelId})`」。`syncActivePanelScope` 中 web 面板分支改 `setTerminalBasePanel({ kind: "web" })`。

- [ ] **Step 2: 运行检查**

Run: `pnpm vitest run tests/unit/renderer/lib/workspace/terminal-focus-request.test.ts && pnpm typecheck`
Expected: PASS。

- [ ] **Step 3: 提交**

```bash
git add src/renderer/components/workspace/workspace-host.tsx tests/unit/renderer/lib/workspace/terminal-focus-request.test.ts
git commit -m "refactor(terminal): workspace host drives base panel intent"
```

---

## M5：结构不变量锁 + 自动化回归

### Task 11: 锁新不变量

**Files:**
- Modify: `tests/unit/native-terminal-state-invariants.test.ts`

- [ ] **Step 1: 加锁**

追加结构断言（读 `GhosttyBridge.swift` 源文本）：

```ts
it("applyFirstResponder web branch must not makeFirstResponder(nil)", () => {
  const src = readFileSync(SWIFT_PATH, "utf8");
  const webBranch = src.slice(
    src.indexOf("if activeTerminalId == nil"),
    src.indexOf("if activeTerminalId == nil") + 600
  );
  expect(webBranch).not.toContain("makeFirstResponder(nil)");
});

it("effectiveTarget is derived from webRequests, not stored", () => {
  const src = readFileSync(SWIFT_PATH, "utf8");
  expect(src).toContain("webRequests.isEmpty ? basePanel : .web");
});
```

并删除/改写引用旧 `keyboardFocusTarget = Self.keyboardFocusTarget(from:` 的旧不变量断言。

- [ ] **Step 2: 运行确认通过**

Run: `pnpm vitest run tests/unit/native-terminal-state-invariants.test.ts`
Expected: PASS。

- [ ] **Step 3: 提交**

```bash
git add tests/unit/native-terminal-state-invariants.test.ts
git commit -m "test(terminal): lock no-nil-firstResponder and derived effective target invariants"
```

### Task 12: 搜索零振荡自动化回归（依赖可观测性）

**Files:**
- Create: `tests/e2e/terminal-search-focus-stability.spec.ts`

- [ ] **Step 1: 写回归测试**

利用 native 现可被意图驱动：注入终端焦点（`setTerminalBasePanel`）+ 打开搜索意图，采样 `debugSnapshot` 时间线，断言 `keyboardFocusTarget` 与 `surface0.isFirstResponder` 在 1.5s 内切换次数 ≤ 1：

```ts
// 通过 win.evaluate 调 window.pier.terminal.debugSnapshot()，
// 采样 30 帧 × 50ms，countTransitions(keyboardFocusTarget) <= 1
// 且 countTransitions(surface0.isFirstResponder) <= 1。
```

（完整骨架参照 spec 第 8 节；若真机 Q2 显示需限频加固，先完成 Task 13 再启用此测试的严格阈值。）

- [ ] **Step 2: 运行**

Run: `pnpm test:e2e -- terminal-search-focus-stability`
Expected: PASS（切换 ≤ 1，无振荡）。

- [ ] **Step 3: 提交**

```bash
git add tests/e2e/terminal-search-focus-stability.spec.ts
git commit -m "test(terminal): regression guard for zero search focus oscillation"
```

---

## M6：冗余清理

### Task 13: 清死代码与残留引用

**Files:**
- 全仓搜索：`registerWebFocusScope`、`WebFocusScopeKind`、`hasExclusiveWebFocusScope`、`releaseTransientWebFocusScopes`、`effectiveKeyboardFocusTarget`、`setTerminalBaseKeyboardFocusTarget`、`use-terminal-search-keyboard-opening`

- [ ] **Step 1: 搜索残留**

Run: `git grep -nE "WebFocusScopeKind|registerWebFocusScope|hasExclusiveWebFocusScope|releaseTransientWebFocusScopes|effectiveKeyboardFocusTarget|setTerminalBaseKeyboardFocusTarget|keyboard-opening"`
Expected: 仅剩注释/无引用；有引用则删除或改为新 API。

- [ ] **Step 2: 完整检查**

Run: `pnpm check`
Expected: typecheck + lint + depcruise + file-size 全过。

- [ ] **Step 3: 提交**

```bash
git add -A
git commit -m "chore(terminal): remove dead web focus scope machinery"
```

---

## M7（可选，后置增强）：native 本地 mouse-down 即时决策

> 仅在核心修复稳定后再做。目标是消除终端内容点击的「forward→renderer→IPC 回环」延迟。

### Task 14: mouse-down 本地置 basePanel + 序号防 stale 覆盖

**Files:**
- Modify: `native/Sources/GhosttyBridge/TerminalScrollContainer.swift:108-116`（`mouseDown`）
- Modify: `native/Sources/GhosttyBridge/GhosttyBridge.swift`（`setBasePanel` 记录本地 set 的逻辑时钟，`applyInputRouting` 解析 basePanel 时若与刚发生的本地 set 冲突且 renderer 未追上则跳过覆盖）
- Test: `native/Tests/GhosttyBridgeTests/FocusArbiterTests.swift`

- [ ] **Step 1: 写失败测试**

```swift
func testLocalMouseDownBaseIsNotClobberedByStaleSnapshot() {
    // 本地 setBasePanel(.terminal("t2")) 后，一帧仍携带旧 basePanel=.terminal("t1")
    // 的 stale 快照不得把 base 拉回 t1。
}
```

- [ ] **Step 2–5:** 实现「本地 set 打逻辑时钟 + 解析快照时校验收敛」，运行 `swift test --package-path native --filter FocusArbiterTests` 通过，真机确认点击别的终端即时聚焦无回环，提交。

---

## 自检：spec 覆盖核对

- 单一权威下沉 native → Task 1/2/7。
- 投影修正（不 nil-slam、幂等、目标校验）→ Task 3，限频加固按 Q2 真机结论 Task 7/14。
- 斩断反馈环（删 onFocus/onBlur）→ Task 9。
- snap-back 修复（base 不被覆盖、释放即恢复）→ Task 1（effectiveTarget 派生）+ Task 8。
- 三区坍缩两态 / 未来浮层契约 → Task 9（`useTerminalWebFocus`）。
- 冗余删除清单 → Task 5/8/9/13。
- 可观测/可测试性 → Task 12。
- 可行性 Q2 → Task 4。
- native 本地决策（migration step 3）→ Task 14（后置）。

每个里程碑产出可独立 typecheck/测试的可工作软件。
