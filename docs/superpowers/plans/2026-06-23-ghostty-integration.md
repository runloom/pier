# Ghostty 终端集成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Ghostty 终端引擎集成到 Pier，作为 dockview panel 参与布局，采用 EventRouterView 架构实现 overlay 无闪烁覆盖。

**Architecture:** Ghostty NSView 在 WKWebView 下方渲染终端内容，WKWebView 设为透明让终端区域"透视"，顶层 EventRouterView 按矩形区域路由鼠标事件到终端或 web 层。overlay 打开时 EventRouter 切换为全部给 web 模式。

**Tech Stack:** Swift (libghostty-spm / SPM) + Obj-C++ (node-addon-api / node-gyp) + Electron 42 IPC + React 19 + dockview-react + Zustand

**Spec:** `docs/superpowers/specs/2026-06-23-ghostty-integration-design.md`

**Reference:** `/Users/dev/ABC/ghostty-electron-demo` — demo 代码可直接参考复制，下文标注差异点。

---

### Task 1: Scaffold native/ directory + SPM + build pipeline

**Files:**
- Create: `native/Package.swift`
- Create: `native/package.json`
- Create: `native/binding.gyp`
- Create: `native/build.sh`
- Create: `native/.gitignore`

- [ ] **Step 1: Create native/Package.swift**

```swift
// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "GhosttyBridge",
    platforms: [.macOS(.v13)],
    products: [
        .library(
            name: "GhosttyBridge",
            type: .dynamic,
            targets: ["GhosttyBridge"]
        ),
    ],
    dependencies: [
        .package(
            url: "https://github.com/Lakr233/libghostty-spm.git",
            branch: "main"
        ),
    ],
    targets: [
        .target(
            name: "GhosttyBridge",
            dependencies: [
                .product(name: "GhosttyTerminal", package: "libghostty-spm"),
            ],
            swiftSettings: [
                .unsafeFlags(["-Xfrontend", "-enable-objc-interop"]),
            ]
        ),
    ]
)
```

- [ ] **Step 2: Create native/package.json**

```json
{
  "name": "pier-native",
  "version": "0.0.0",
  "private": true,
  "dependencies": {
    "node-addon-api": "^8.3.0"
  },
  "devDependencies": {
    "node-gyp": "^11.0.0"
  }
}
```

- [ ] **Step 3: Create native/binding.gyp**

```json
{
  "targets": [
    {
      "target_name": "ghostty_native",
      "sources": ["src/addon.mm"],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "libraries": [
        "<(module_root_dir)/build_swift/libGhosttyBridge.dylib",
        "-framework AppKit",
        "-framework Foundation",
        "-framework Metal",
        "-framework MetalKit",
        "-framework QuartzCore"
      ],
      "xcode_settings": {
        "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
        "MACOSX_DEPLOYMENT_TARGET": "13.0",
        "OTHER_CPLUSPLUSFLAGS": ["-fobjc-arc"],
        "OTHER_LDFLAGS": [
          "-Wl,-rpath,@loader_path",
          "-Wl,-rpath,@loader_path/../../build_swift"
        ]
      }
    }
  ]
}
```

- [ ] **Step 4: Create native/build.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "=== [1/3] SPM resolve + Swift build ==="
swift package resolve
swift build -c release --product GhosttyBridge

SWIFT_BUILD_DIR=$(swift build -c release --show-bin-path)
DYLIB="$SWIFT_BUILD_DIR/libGhosttyBridge.dylib"

if [ ! -f "$DYLIB" ]; then
  echo "ERROR: dylib not found at $DYLIB"
  exit 1
fi

echo "=== [2/3] Staging + rpath fixup ==="
mkdir -p build_swift
DYLIB_OUT="build_swift/libGhosttyBridge.dylib"
cp "$DYLIB" "$DYLIB_OUT"

# Find GhosttyKit.framework in SPM artifacts
FRAMEWORK=$(find .build/artifacts -name "GhosttyKit.framework" -type d | head -1)
if [ -n "$FRAMEWORK" ]; then
  rm -rf build_swift/GhosttyKit.framework
  cp -R "$FRAMEWORK" build_swift/
  echo "Copied GhosttyKit.framework"
fi

install_name_tool -id "@rpath/libGhosttyBridge.dylib" "$DYLIB_OUT" 2>/dev/null || true
install_name_tool -add_rpath "@loader_path" "$DYLIB_OUT" 2>/dev/null || true

echo "=== [3/3] node-gyp rebuild ==="
npm install --ignore-scripts
npx --yes node-gyp rebuild --verbose

# Copy runtime deps next to .node
cp build_swift/libGhosttyBridge.dylib build/Release/ 2>/dev/null || true
if [ -d build_swift/GhosttyKit.framework ]; then
  cp -R build_swift/GhosttyKit.framework build/Release/
fi

echo "=== Done ==="
ls -lh build/Release/ghostty_native.node
```

- [ ] **Step 5: Create native/.gitignore**

```
.build/
build/
build_swift/
node_modules/
Package.resolved
```

- [ ] **Step 6: Commit**

```bash
git add native/Package.swift native/package.json native/binding.gyp native/build.sh native/.gitignore
git commit -m "chore: scaffold native/ directory for Ghostty integration"
```

---

### Task 2: Implement GhosttyBridge.swift

**Files:**
- Create: `native/Sources/GhosttyBridge/GhosttyBridge.swift`

- [ ] **Step 1: Create GhosttyBridge.swift**

这是核心原生层，包含 EventRouterView + 终端管理。相对 demo 的关键差异用 `// PIER:` 注释标注。

```swift
// native/Sources/GhosttyBridge/GhosttyBridge.swift
//
// Pier Ghostty Bridge — EventRouterView 架构
//
// NSView 层级 (从底到顶):
//   1. Ghostty NSView 容器 — Metal GPU 渲染终端
//   2. WKWebView (isOpaque=false) — 透明 web UI
//   3. EventRouterView — 不画像素，hitTest 路由事件
//
// PIER: 与 demo 的差异:
//   - 终端在 WKWebView 之下 (demo 在之上)
//   - 新增 EventRouterView 做事件路由
//   - 新增 setupWindow / setOverlayActive API
//   - WKWebView 设为透明

import AppKit
import GhosttyTerminal

// MARK: - EventRouterView

/// 完全透明的 NSView，只 override hitTest 做事件路由。
/// 放在 contentView 最顶层，根据终端矩形分发事件到终端或 web 层。
final class EventRouterView: NSView {
    struct Target {
        let rect: NSRect
        let view: NSView
    }

    var targets: [String: Target] = [:]
    var overlayActive = false

    override var isOpaque: Bool { false }
    override func draw(_ dirtyRect: NSRect) {}

    override func hitTest(_ point: NSPoint) -> NSView? {
        guard !overlayActive else { return nil }
        guard let sv = superview else { return nil }
        let local = convert(point, from: sv)
        for (_, target) in targets {
            if target.rect.contains(local) {
                let p = target.view.superview?.convert(point, from: sv) ?? point
                return target.view.hitTest(p)
            }
        }
        return nil
    }
}

// MARK: - Terminal record

private struct Terminal {
    let containerView: NSView
    let terminalView: TerminalView
    let parentWindow: NSWindow
}

// MARK: - Bridge implementation

final class GhosttyBridgeImpl {
    static let shared = GhosttyBridgeImpl()

    private var terminals: [String: Terminal] = [:]
    private var eventRouters: [ObjectIdentifier: EventRouterView] = [:]  // per-window
    private var activePanelId: String?

    private lazy var sharedController: TerminalController = TerminalController { builder in
        builder.withBackgroundOpacity(1.0)
    }

    // MARK: - Window setup (PIER: new API)

    /// 一次性初始化: 创建 EventRouterView + WKWebView 透明化
    func setupWindow(parent: NSWindow) -> Bool {
        guard let contentView = parent.contentView else { return false }
        let windowId = ObjectIdentifier(parent)

        // 防止重复初始化
        guard eventRouters[windowId] == nil else { return true }

        // 查找 WKWebView
        var wkWebView: NSView?
        for subview in contentView.subviews {
            if String(describing: type(of: subview)).contains("WKWebView")
                || String(describing: type(of: subview)).contains("WebContentsView") {
                wkWebView = subview
                break
            }
        }

        // WKWebView 透明化
        if let wk = wkWebView {
            wk.setValue(false, forKey: "drawsBackground")
        }

        // 创建 EventRouterView (最顶层)
        let router = EventRouterView(frame: contentView.bounds)
        router.autoresizingMask = [.width, .height]
        contentView.addSubview(router, positioned: .above, relativeTo: nil)
        eventRouters[windowId] = router

        return true
    }

    // MARK: - Overlay control (PIER: new API)

    func setOverlayActive(_ active: Bool) {
        for (_, router) in eventRouters {
            router.overlayActive = active
        }
    }

    // MARK: - Terminal lifecycle

    func createTerminal(parent: NSWindow, panelId: String, viewport: NSRect) -> Bool {
        guard let contentView = parent.contentView else { return false }

        let frame = computeFrame(in: contentView, viewport: viewport)

        let terminalView = TerminalView(frame: NSRect(origin: .zero, size: frame.size))
        terminalView.autoresizingMask = [.width, .height]
        terminalView.configuration = TerminalSurfaceOptions(backend: .exec)
        terminalView.controller = sharedController

        let container = NSView(frame: frame)
        container.wantsLayer = true
        container.layer?.backgroundColor = NSColor.black.cgColor
        container.addSubview(terminalView)

        // PIER: 放在 WKWebView 之下
        // 查找 WKWebView 作为参照
        var wkWebView: NSView?
        for subview in contentView.subviews {
            if String(describing: type(of: subview)).contains("WKWebView")
                || String(describing: type(of: subview)).contains("WebContentsView") {
                wkWebView = subview
                break
            }
        }

        if let wk = wkWebView {
            contentView.addSubview(container, positioned: .below, relativeTo: wk)
        } else {
            contentView.addSubview(container, positioned: .below, relativeTo: nil)
        }

        terminals[panelId] = Terminal(
            containerView: container,
            terminalView: terminalView,
            parentWindow: parent
        )

        // 更新 EventRouter targets
        let windowId = ObjectIdentifier(parent)
        eventRouters[windowId]?.targets[panelId] = EventRouterView.Target(
            rect: frame, view: terminalView
        )

        activePanelId = panelId
        return true
    }

    func setFrame(panelId: String, viewport: NSRect) {
        guard let term = terminals[panelId],
              let contentView = term.parentWindow.contentView else { return }
        let frame = computeFrame(in: contentView, viewport: viewport)
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        term.containerView.frame = frame
        CATransaction.commit()

        // 同步 EventRouter targets
        let windowId = ObjectIdentifier(term.parentWindow)
        eventRouters[windowId]?.targets[panelId] = EventRouterView.Target(
            rect: frame, view: term.terminalView
        )
    }

    func show(panelId: String) {
        guard let term = terminals[panelId] else { return }
        activePanelId = panelId

        CATransaction.begin()
        CATransaction.setDisableActions(true)
        if let contentView = term.parentWindow.contentView {
            // 找到 WKWebView，确保终端在其下方
            var wkWebView: NSView?
            for subview in contentView.subviews {
                if String(describing: type(of: subview)).contains("WKWebView")
                    || String(describing: type(of: subview)).contains("WebContentsView") {
                    wkWebView = subview
                    break
                }
            }
            if let wk = wkWebView {
                contentView.addSubview(term.containerView, positioned: .below, relativeTo: wk)
            }
        }
        term.containerView.alphaValue = 1
        term.containerView.isHidden = false
        CATransaction.commit()
    }

    func hide(panelId: String) {
        guard let term = terminals[panelId] else { return }
        guard panelId != activePanelId else { return }
        let f = term.containerView.frame
        if f.minX > -50000 {
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            term.containerView.frame = NSRect(
                x: -99999, y: -99999, width: f.width, height: f.height
            )
            CATransaction.commit()
        }

        // 从 EventRouter targets 中移除 (offscreen 不需要路由)
        let windowId = ObjectIdentifier(term.parentWindow)
        eventRouters[windowId]?.targets.removeValue(forKey: panelId)
    }

    func close(panelId: String) {
        guard let term = terminals[panelId] else { return }
        term.containerView.removeFromSuperview()
        terminals.removeValue(forKey: panelId)
        if activePanelId == panelId { activePanelId = nil }

        let windowId = ObjectIdentifier(term.parentWindow)
        eventRouters[windowId]?.targets.removeValue(forKey: panelId)
    }

    func focus(panelId: String) {
        guard let term = terminals[panelId] else { return }
        activePanelId = panelId
        term.terminalView.window?.makeFirstResponder(term.terminalView)
    }

    // MARK: - Coordinate conversion

    private func computeFrame(in contentView: NSView, viewport: NSRect) -> NSRect {
        if contentView.isFlipped {
            return viewport
        }
        return NSRect(
            x: viewport.minX,
            y: contentView.bounds.height - viewport.minY - viewport.height,
            width: viewport.width,
            height: viewport.height
        )
    }
}

// MARK: - C ABI exports

@_cdecl("ghostty_bridge_setup_window")
public func ghosttyBridgeSetupWindow(_ nsWindowPtr: UnsafeMutableRawPointer) -> Bool {
    let window = Unmanaged<NSWindow>.fromOpaque(nsWindowPtr).takeUnretainedValue()
    return GhosttyBridgeImpl.shared.setupWindow(parent: window)
}

@_cdecl("ghostty_bridge_set_overlay_active")
public func ghosttyBridgeSetOverlayActive(_ active: Bool) {
    GhosttyBridgeImpl.shared.setOverlayActive(active)
}

@_cdecl("ghostty_bridge_create_terminal")
public func ghosttyBridgeCreateTerminal(
    _ nsWindowPtr: UnsafeMutableRawPointer,
    _ panelId: UnsafePointer<CChar>,
    _ x: Double, _ y: Double, _ w: Double, _ h: Double
) -> Bool {
    let window = Unmanaged<NSWindow>.fromOpaque(nsWindowPtr).takeUnretainedValue()
    let viewport = NSRect(x: x, y: y, width: w, height: h)
    return GhosttyBridgeImpl.shared.createTerminal(
        parent: window, panelId: String(cString: panelId), viewport: viewport
    )
}

@_cdecl("ghostty_bridge_set_frame")
public func ghosttyBridgeSetFrame(
    _ panelId: UnsafePointer<CChar>,
    _ x: Double, _ y: Double, _ w: Double, _ h: Double
) {
    GhosttyBridgeImpl.shared.setFrame(
        panelId: String(cString: panelId),
        viewport: NSRect(x: x, y: y, width: w, height: h)
    )
}

@_cdecl("ghostty_bridge_show")
public func ghosttyBridgeShow(_ panelId: UnsafePointer<CChar>) {
    GhosttyBridgeImpl.shared.show(panelId: String(cString: panelId))
}

@_cdecl("ghostty_bridge_hide")
public func ghosttyBridgeHide(_ panelId: UnsafePointer<CChar>) {
    GhosttyBridgeImpl.shared.hide(panelId: String(cString: panelId))
}

@_cdecl("ghostty_bridge_close")
public func ghosttyBridgeClose(_ panelId: UnsafePointer<CChar>) {
    GhosttyBridgeImpl.shared.close(panelId: String(cString: panelId))
}

@_cdecl("ghostty_bridge_focus")
public func ghosttyBridgeFocus(_ panelId: UnsafePointer<CChar>) {
    GhosttyBridgeImpl.shared.focus(panelId: String(cString: panelId))
}
```

- [ ] **Step 2: Commit**

```bash
git add native/Sources/GhosttyBridge/GhosttyBridge.swift
git commit -m "feat(native): implement GhosttyBridge with EventRouterView"
```

---

### Task 3: Implement addon.mm (N-API bridge)

**Files:**
- Create: `native/src/addon.mm`

- [ ] **Step 1: Create addon.mm**

```objc
// native/src/addon.mm — N-API bridge: JS ↔ C ABI (GhosttyBridge.swift)
#import <AppKit/AppKit.h>
#import <napi.h>

extern "C" {
    bool ghostty_bridge_setup_window(void* nsWindow);
    void ghostty_bridge_set_overlay_active(bool active);
    bool ghostty_bridge_create_terminal(void* nsWindow, const char* panelId,
                                         double x, double y, double w, double h);
    void ghostty_bridge_set_frame(const char* panelId,
                                   double x, double y, double w, double h);
    void ghostty_bridge_show(const char* panelId);
    void ghostty_bridge_hide(const char* panelId);
    void ghostty_bridge_close(const char* panelId);
    void ghostty_bridge_focus(const char* panelId);
}

// Electron getNativeWindowHandle() returns Buffer containing NSView**
static NSWindow* WindowFromHandle(const Napi::Value& v) {
    Napi::Buffer<char> buf = v.As<Napi::Buffer<char>>();
    void* raw = static_cast<void*>(buf.Data());
    NSView* __unsafe_unretained * viewPtr =
        reinterpret_cast<NSView* __unsafe_unretained *>(raw);
    NSView* view = *viewPtr;
    return view.window;
}

// --- JS exports ---

static Napi::Value JsSetupWindow(const Napi::CallbackInfo& info) {
    NSWindow* win = WindowFromHandle(info[0]);
    if (!win) return Napi::Boolean::New(info.Env(), false);
    bool ok = ghostty_bridge_setup_window((__bridge void*)win);
    return Napi::Boolean::New(info.Env(), ok);
}

static Napi::Value JsSetOverlayActive(const Napi::CallbackInfo& info) {
    bool active = info[0].As<Napi::Boolean>().Value();
    ghostty_bridge_set_overlay_active(active);
    return info.Env().Undefined();
}

static Napi::Value JsCreateTerminal(const Napi::CallbackInfo& info) {
    NSWindow* win = WindowFromHandle(info[0]);
    if (!win) return Napi::Boolean::New(info.Env(), false);
    std::string panelId = info[1].As<Napi::String>().Utf8Value();
    Napi::Object frame = info[2].As<Napi::Object>();
    double x = frame.Get("x").As<Napi::Number>().DoubleValue();
    double y = frame.Get("y").As<Napi::Number>().DoubleValue();
    double w = frame.Get("width").As<Napi::Number>().DoubleValue();
    double h = frame.Get("height").As<Napi::Number>().DoubleValue();
    bool ok = ghostty_bridge_create_terminal((__bridge void*)win, panelId.c_str(), x, y, w, h);
    return Napi::Boolean::New(info.Env(), ok);
}

static Napi::Value JsSetFrame(const Napi::CallbackInfo& info) {
    std::string panelId = info[0].As<Napi::String>().Utf8Value();
    Napi::Object frame = info[1].As<Napi::Object>();
    double x = frame.Get("x").As<Napi::Number>().DoubleValue();
    double y = frame.Get("y").As<Napi::Number>().DoubleValue();
    double w = frame.Get("width").As<Napi::Number>().DoubleValue();
    double h = frame.Get("height").As<Napi::Number>().DoubleValue();
    ghostty_bridge_set_frame(panelId.c_str(), x, y, w, h);
    return info.Env().Undefined();
}

static Napi::Value JsShow(const Napi::CallbackInfo& info) {
    std::string panelId = info[0].As<Napi::String>().Utf8Value();
    ghostty_bridge_show(panelId.c_str());
    return info.Env().Undefined();
}

static Napi::Value JsHide(const Napi::CallbackInfo& info) {
    std::string panelId = info[0].As<Napi::String>().Utf8Value();
    ghostty_bridge_hide(panelId.c_str());
    return info.Env().Undefined();
}

static Napi::Value JsClose(const Napi::CallbackInfo& info) {
    std::string panelId = info[0].As<Napi::String>().Utf8Value();
    ghostty_bridge_close(panelId.c_str());
    return info.Env().Undefined();
}

static Napi::Value JsFocus(const Napi::CallbackInfo& info) {
    std::string panelId = info[0].As<Napi::String>().Utf8Value();
    ghostty_bridge_focus(panelId.c_str());
    return info.Env().Undefined();
}

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("setupWindow",     Napi::Function::New(env, JsSetupWindow));
    exports.Set("setOverlayActive", Napi::Function::New(env, JsSetOverlayActive));
    exports.Set("createTerminal",  Napi::Function::New(env, JsCreateTerminal));
    exports.Set("setFrame",        Napi::Function::New(env, JsSetFrame));
    exports.Set("showTerminal",    Napi::Function::New(env, JsShow));
    exports.Set("hideTerminal",    Napi::Function::New(env, JsHide));
    exports.Set("closeTerminal",   Napi::Function::New(env, JsClose));
    exports.Set("focusTerminal",   Napi::Function::New(env, JsFocus));
    return exports;
}

NODE_API_MODULE(ghostty_native, Init)
```

- [ ] **Step 2: Commit**

```bash
git add native/src/addon.mm
git commit -m "feat(native): implement N-API bridge (addon.mm)"
```

---

### Task 4: Build native module + verify

- [ ] **Step 1: Run build**

```bash
cd native && bash build.sh
```

Expected: `build/Release/ghostty_native.node` 文件生成，无编译错误。

- [ ] **Step 2: Verify .node loads**

```bash
node -e "const m = require('./native/build/Release/ghostty_native.node'); console.log(Object.keys(m))"
```

Expected output 包含: `setupWindow, setOverlayActive, createTerminal, setFrame, showTerminal, hideTerminal, closeTerminal, focusTerminal`

- [ ] **Step 3: Update root package.json**

在 `pier/package.json` 的 scripts 中添加:

```json
"build:native": "cd native && bash build.sh"
```

修改 `dev` script 前置 `build:native`:

```json
"dev": "pnpm build:native && electron-vite dev"
```

修改 `build` script 前置 `build:native`:

```json
"build": "pnpm build:native && electron-vite build"
```

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore: integrate native build into dev/build scripts"
```

---

### Task 5: Shared terminal contracts (TypeScript)

**Files:**
- Create: `src/shared/contracts/terminal.ts`

- [ ] **Step 1: Create terminal.ts**

```ts
// src/shared/contracts/terminal.ts

export interface TerminalFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CreateTerminalArgs {
  panelId: string;
  frame: TerminalFrame;
}

export interface CreateTerminalResult {
  ok: boolean;
  error?: string;
}

export interface TerminalAPI {
  setup(): Promise<CreateTerminalResult>;
  create(args: CreateTerminalArgs): Promise<CreateTerminalResult>;
  setFrame(panelId: string, frame: TerminalFrame): void;
  show(panelId: string): void;
  hide(panelId: string): void;
  close(panelId: string): Promise<void>;
  focus(panelId: string): void;
  setOverlayActive(active: boolean): void;
}
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm typecheck
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/shared/contracts/terminal.ts
git commit -m "feat: add shared terminal IPC contracts"
```

---

### Task 6: Main-side terminal IPC handlers

**Files:**
- Create: `src/main/ipc/terminal.ts`
- Modify: `src/main/index.ts` — register terminal IPC

- [ ] **Step 1: Create src/main/ipc/terminal.ts**

```ts
import { createRequire } from "node:module";
import { BrowserWindow, type IpcMain } from "electron";
import type { CreateTerminalArgs, TerminalFrame } from "@shared/contracts/terminal.ts";

interface NativeAddon {
  setupWindow(parentHandle: Buffer): boolean;
  setOverlayActive(active: boolean): void;
  createTerminal(
    parentHandle: Buffer,
    panelId: string,
    frame: TerminalFrame
  ): boolean;
  setFrame(panelId: string, frame: TerminalFrame): void;
  showTerminal(panelId: string): void;
  hideTerminal(panelId: string): void;
  closeTerminal(panelId: string): void;
  focusTerminal(panelId: string): void;
}

function loadNativeAddon(): {
  addon: NativeAddon | null;
  error: string | null;
} {
  if (process.platform !== "darwin") {
    return { addon: null, error: "ghostty requires macOS" };
  }
  try {
    const require = createRequire(import.meta.url);
    const addon: NativeAddon = require(
      "../../native/build/Release/ghostty_native.node"
    );
    return { addon, error: null };
  } catch (e) {
    return {
      addon: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export function registerTerminalIpc(ipcMain: IpcMain): void {
  const { addon, error: loadError } = loadNativeAddon();

  ipcMain.handle("pier:terminal:setup", (event) => {
    if (!addon) {
      return { ok: false, error: loadError ?? "native addon not loaded" };
    }
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      return { ok: false, error: "window not found" };
    }
    try {
      const handle = win.getNativeWindowHandle();
      const ok = addon.setupWindow(handle);
      return ok ? { ok: true } : { ok: false, error: "setupWindow failed" };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle(
    "pier:terminal:create",
    (event, args: CreateTerminalArgs) => {
      if (!addon) {
        return { ok: false, error: loadError ?? "native addon not loaded" };
      }
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) {
        return { ok: false, error: "window not found" };
      }
      try {
        const handle = win.getNativeWindowHandle();
        const ok = addon.createTerminal(handle, args.panelId, args.frame);
        return ok
          ? { ok: true }
          : { ok: false, error: "createTerminal returned false" };
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }
  );

  ipcMain.on(
    "pier:terminal:set-frame",
    (_event, panelId: string, frame: TerminalFrame) => {
      addon?.setFrame(panelId, frame);
    }
  );

  ipcMain.on("pier:terminal:show", (_event, panelId: string) => {
    addon?.showTerminal(panelId);
  });

  ipcMain.on("pier:terminal:hide", (_event, panelId: string) => {
    addon?.hideTerminal(panelId);
  });

  ipcMain.handle("pier:terminal:close", (_event, panelId: string) => {
    addon?.closeTerminal(panelId);
  });

  ipcMain.on("pier:terminal:focus", (_event, panelId: string) => {
    addon?.focusTerminal(panelId);
  });

  ipcMain.on("pier:terminal:set-overlay", (_event, active: boolean) => {
    addon?.setOverlayActive(active);
  });
}
```

- [ ] **Step 2: Register in main/index.ts**

在 `src/main/index.ts` 中 `registerThemeIpc` 旁新增:

```ts
import { registerTerminalIpc } from "./ipc/terminal.ts";
```

在 IPC 注册区块中添加:

```ts
registerTerminalIpc(ipcMain);
```

- [ ] **Step 3: Run typecheck**

```bash
pnpm typecheck
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc/terminal.ts src/main/index.ts
git commit -m "feat: add terminal IPC handlers with native addon loading"
```

---

### Task 7: Extend preload with terminal API

**Files:**
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Add TerminalAPI to preload**

在 `src/preload/index.ts` 中:

1. Import terminal types:
```ts
import type { TerminalAPI } from "@shared/contracts/terminal.ts";
```

2. 创建 terminalApi 对象 (在 `themeApi` 之后):
```ts
const terminalApi: TerminalAPI = {
  setup: () => ipcRenderer.invoke("pier:terminal:setup"),
  create: (args) => ipcRenderer.invoke("pier:terminal:create", args),
  setFrame: (panelId, frame) =>
    ipcRenderer.send("pier:terminal:set-frame", panelId, frame),
  show: (panelId) => ipcRenderer.send("pier:terminal:show", panelId),
  hide: (panelId) => ipcRenderer.send("pier:terminal:hide", panelId),
  close: (panelId) => ipcRenderer.invoke("pier:terminal:close", panelId),
  focus: (panelId) => ipcRenderer.send("pier:terminal:focus", panelId),
  setOverlayActive: (active) =>
    ipcRenderer.send("pier:terminal:set-overlay", active),
};
```

3. 在 `PierWindowAPI` interface 中新增:
```ts
terminal: TerminalAPI;
```

4. 在 api 对象中新增:
```ts
terminal: terminalApi,
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm typecheck
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/preload/index.ts
git commit -m "feat: extend preload bridge with terminal API"
```

---

### Task 8: CSS transparency scheme

**Files:**
- Modify: `src/renderer/app/globals.css`
- Modify: `src/renderer/components/workspace/welcome-panel.tsx`

- [ ] **Step 1: Modify globals.css — root transparency**

在 `src/renderer/app/globals.css` 中找到 `body` 规则 (约行 487):

```css
body {
  font-family: ...;
  background: var(--background);
}
```

将 `background: var(--background)` 改为 `background: transparent`:

```css
body {
  font-family: ...;
  background: transparent;
}
```

在 `#root` 规则中也确保透明:

```css
#root {
  height: 100%;
  background: transparent;
}
```

- [ ] **Step 2: Modify globals.css — dockview groupview transparency**

找到现有的 dockview 统一底色规则:

```css
.dockview-theme-pier .dv-dockview,
.dockview-theme-pier .dv-groupview {
  background-color: var(--background) !important;
}
```

改为透明:

```css
.dockview-theme-pier .dv-dockview,
.dockview-theme-pier .dv-groupview {
  background-color: transparent !important;
}
```

新增: split view 缝隙区域补色 (panel 间细线):

```css
.dockview-theme-pier .dv-view-container > .dv-view:not(:first-child)::before {
  background-color: var(--border);
}
```

- [ ] **Step 3: welcome-panel.tsx — 补不透明背景**

在 `src/renderer/components/workspace/welcome-panel.tsx` 的根 div 加 `bg-background`:

```tsx
export function WelcomePanel(_props: IDockviewPanelProps) {
  return (
    <div className="flex h-full items-center justify-center bg-background p-6">
```

(原本没有 `bg-background`，依赖 body 背景。透明化后需要显式设置。)

- [ ] **Step 4: Run typecheck + lint**

```bash
pnpm typecheck
pnpm exec ultracite check src/renderer/app/globals.css src/renderer/components/workspace/welcome-panel.tsx
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/app/globals.css src/renderer/components/workspace/welcome-panel.tsx
git commit -m "feat: CSS transparency scheme for terminal see-through"
```

---

### Task 9: Create TerminalPanel component

**Files:**
- Create: `src/renderer/panel-kits/terminal/terminal-panel.tsx`
- Modify: `src/renderer/components/workspace/panel-registry.ts`

- [ ] **Step 1: Create terminal-panel.tsx**

```tsx
// src/renderer/panel-kits/terminal/terminal-panel.tsx
import type { IDockviewPanelProps } from "dockview-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { TerminalFrame } from "@shared/contracts/terminal.ts";

function getAnchorFrame(
  api: IDockviewPanelProps["api"],
  anchor: HTMLDivElement
): TerminalFrame | null {
  const r = anchor.getBoundingClientRect();
  if (r.width < 10 || r.height < 10) return null;
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

async function waitForRealSize(
  api: IDockviewPanelProps["api"],
  anchor: HTMLDivElement
): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      const r = anchor.getBoundingClientRect();
      if (r.width > 100 && r.height > 100) {
        resolve();
        return;
      }
      requestAnimationFrame(check);
    };
    check();
  });
}

export function TerminalPanel(props: IDockviewPanelProps) {
  const { api } = props;
  const panelId = api.id;
  const anchorRef = useRef<HTMLDivElement>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  // 让 anchor 跟随 parent 尺寸 (dockview content area)
  useLayoutEffect(() => {
    const parent = parentRef.current?.parentElement;
    const anchor = anchorRef.current;
    if (!(parent && anchor)) return;

    const sync = () => {
      anchor.style.width = `${parent.clientWidth}px`;
      anchor.style.height = `${parent.clientHeight}px`;
    };
    sync();

    const ro = new ResizeObserver(sync);
    ro.observe(parent);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;

    let disposed = false;
    const subscriptions: Array<{ dispose(): void }> = [];
    let lastFrame = "";

    const sendFrameNow = () => {
      if (disposed) return;
      const frame = getAnchorFrame(api, anchor);
      if (!frame) return;
      const key = `${frame.x},${frame.y},${frame.width},${frame.height}`;
      if (key === lastFrame) return;
      lastFrame = key;
      window.pier.terminal.setFrame(panelId, frame);
    };

    let rafId = 0;
    const scheduleSync = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        sendFrameNow();
      });
    };

    const init = async () => {
      await waitForRealSize(api, anchor);
      if (disposed) return;

      const frame = getAnchorFrame(api, anchor);
      if (!frame) {
        setError("无法获取面板坐标");
        return;
      }

      const result = await window.pier.terminal.create({ panelId, frame });
      if (!result.ok) {
        setError(result.error ?? "终端创建失败");
        return;
      }

      // Visibility
      subscriptions.push(
        api.onDidVisibilityChange((e) => {
          if (e.isVisible) {
            sendFrameNow();
            window.pier.terminal.show(panelId);
          } else {
            // 双 RAF 延迟 hide 防闪
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                if (!disposed) window.pier.terminal.hide(panelId);
              });
            });
          }
        })
      );

      // Focus
      subscriptions.push(
        api.onDidActiveChange((e) => {
          if (e.isActive) window.pier.terminal.focus(panelId);
        })
      );

      // Resize sync
      const parent = anchor.parentElement;
      if (parent) {
        const ro = new ResizeObserver(scheduleSync);
        ro.observe(parent);
        subscriptions.push({ dispose: () => ro.disconnect() });
      }

      // Window resize (maximize/restore)
      const onWindowResize = () => sendFrameNow();
      window.addEventListener("resize", onWindowResize);
      subscriptions.push({
        dispose: () => window.removeEventListener("resize", onWindowResize),
      });
    };

    init();

    return () => {
      disposed = true;
      if (rafId) cancelAnimationFrame(rafId);
      for (const s of subscriptions) s.dispose();
      window.pier.terminal.close(panelId);
    };
  }, [api, panelId]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <p className="text-muted-foreground text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div ref={parentRef} className="h-full">
      <div ref={anchorRef} className="terminal-anchor" />
    </div>
  );
}
```

- [ ] **Step 2: Register in panel-registry.ts**

```ts
import { TerminalPanel } from "@/panel-kits/terminal/terminal-panel.tsx";

export const panelComponents: Record<
  string,
  FunctionComponent<IDockviewPanelProps>
> = {
  welcome: WelcomePanel,
  terminal: TerminalPanel,
};
```

- [ ] **Step 3: Run typecheck**

```bash
pnpm typecheck
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/panel-kits/terminal/terminal-panel.tsx src/renderer/components/workspace/panel-registry.ts
git commit -m "feat: add TerminalPanel component with native lifecycle"
```

---

### Task 10: Terminal panel action + keybinding

**Files:**
- Modify: `src/renderer/lib/actions/panel-actions.ts`
- Modify: `src/renderer/stores/workspace.store.ts`

- [ ] **Step 1: Add openTerminal to workspace store**

在 `src/renderer/stores/workspace.store.ts` 的 interface 和 create 中新增 `addTerminal`:

```ts
// interface WorkspaceState 新增:
addTerminal: () => void;

// create 实现中新增:
addTerminal() {
  const api = get().api;
  if (!api) return;
  const id = `terminal-${Date.now()}`;
  const activeGroup = api.activeGroup;
  api.addPanel({
    id,
    component: "terminal",
    title: "Terminal",
    position: activeGroup
      ? { referenceGroup: activeGroup, direction: "within" }
      : { direction: "right" },
  });
},
```

- [ ] **Step 2: Add keybinding in panel-actions.ts**

新增 terminal action:

```ts
actionRegistry.register({
  id: "pier.panel.newTerminal",
  title: "New Terminal",
  surfaces: [],
  execute() {
    useWorkspaceStore.getState().addTerminal();
  },
});
```

- [ ] **Step 3: Add to default keymap**

在 `src/renderer/lib/keybindings/defaults.ts` 新增:

```ts
{ actionId: "pier.panel.newTerminal", chord: { cmdOrCtrl: true, code: "Backquote" } },
```

(Cmd+` 打开新终端)

- [ ] **Step 4: Run typecheck**

```bash
pnpm typecheck
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/stores/workspace.store.ts src/renderer/lib/actions/panel-actions.ts src/renderer/lib/keybindings/defaults.ts
git commit -m "feat: add terminal panel action with Cmd+\` keybinding"
```

---

### Task 11: Overlay integration

**Files:**
- Create: `src/renderer/stores/terminal-overlay.store.ts`
- Modify: `src/renderer/components/common/command-palette.tsx`
- Modify: `src/renderer/pages/settings/settings-dialog.tsx`
- Modify: `src/renderer/main.tsx` — call setup()

- [ ] **Step 1: Create terminal-overlay.store.ts**

```ts
// src/renderer/stores/terminal-overlay.store.ts

/**
 * Overlay ref 计数器。
 *
 * web overlay (command palette / dialog 等) 打开时调 pushOverlay(),
 * 关闭时调 popOverlay()。计数归零时通知 native 层恢复终端事件路由。
 */
let overlayCount = 0;

export function pushOverlay(): void {
  if (++overlayCount === 1) {
    window.pier?.terminal?.setOverlayActive?.(true);
  }
}

export function popOverlay(): void {
  overlayCount = Math.max(0, overlayCount - 1);
  if (overlayCount === 0) {
    window.pier?.terminal?.setOverlayActive?.(false);
  }
}
```

- [ ] **Step 2: Wire into CommandPalette**

在 `src/renderer/components/common/command-palette.tsx` 的 Dialog/Command 组件中，找到控制打开/关闭的逻辑，添加:

```ts
import { pushOverlay, popOverlay } from "@/stores/terminal-overlay.store.ts";
```

在 open 状态变化回调中:
```ts
// onOpenChange 或等效回调中:
if (open) pushOverlay();
else popOverlay();
```

- [ ] **Step 3: Wire into SettingsDialog**

在 `src/renderer/pages/settings/settings-dialog.tsx` 中同理:

```ts
import { pushOverlay, popOverlay } from "@/stores/terminal-overlay.store.ts";
```

在 dialog 的 `onOpenChange` 中调用 push/pop。

- [ ] **Step 4: Call terminal.setup() in bootstrap**

在 `src/renderer/main.tsx` 的 `bootstrap()` 中，`Promise.all([initTheme(), ...])` 之后添加:

```ts
// 终端原生层初始化 (失败不阻塞)
window.pier?.terminal?.setup?.()?.catch(() => undefined);
```

- [ ] **Step 5: Run typecheck**

```bash
pnpm typecheck
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/stores/terminal-overlay.store.ts src/renderer/components/common/command-palette.tsx src/renderer/pages/settings/settings-dialog.tsx src/renderer/main.tsx
git commit -m "feat: overlay integration with terminal EventRouter"
```

---

### Task 12: Integration verification

- [ ] **Step 1: Full build check**

```bash
pnpm typecheck && pnpm exec ultracite check
```

Expected: PASS

- [ ] **Step 2: Manual integration test**

```bash
pnpm dev
```

验证清单:
1. 启动无报错
2. Cmd+` 打开终端 tab
3. 终端内 shell 可交互 (输入命令、看到输出)
4. 拖拽 sash 调整 terminal/welcome 分屏比例，终端跟随 resize
5. tab 切换: terminal ↔ welcome，终端正确 show/hide
6. Cmd+Shift+P 打开 command palette → 终端可见（被遮罩调暗）→ palette 可交互
7. Settings dialog 打开 → 同上
8. 关闭 overlay → 终端恢复可交互

- [ ] **Step 3: Final commit (if any cleanup needed)**

```bash
git add -A
git commit -m "chore: integration cleanup"
```
