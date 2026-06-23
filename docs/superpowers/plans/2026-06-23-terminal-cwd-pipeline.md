# Terminal CWD Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打通 shell → Ghostty → swift → C++ → main → preload → renderer 的 cwd 上报链路, 让 terminal panel 的 tab title / 系统 title 反映当前工作目录。

**Architecture:** 利用 Ghostty 已实现的 OSC 7 解析能力, 通过 `TerminalSurfacePwdDelegate` 在 swift 端接收 PWD 变化, 经 N-API ThreadSafeFunction 跨线程到 main JS, 通过 webContents.send 推到 renderer; renderer 端 terminal-panel 订阅事件, 经已有的 `usePanelDescriptor` hook 把 cwd 同步到中心 store, 各 sink (tab / document.title / titlebar) 自然更新。

**Tech Stack:**
- swift: AppKit + GhosttyTerminal (libghostty-spm)
- native: Node-API (napi.h) + ThreadSafeFunction
- main: Electron 42 (BrowserWindow.webContents.send)
- renderer: React 19 + Zustand 5 + dockview-react 6.6.1
- 测试: Vitest 4 (TS 层) + 手动 `pnpm dev` (跨进程链路)

---

## File Structure

**新建 (renderer 层)**

- `tests/unit/panel-descriptor.test.ts` — store / hook 单元测试 (path 字段)
- `tests/unit/cwd-derive.test.ts` — basename / cwd → descriptor 推导逻辑测试

**修改 (从下到上)**

- `native/Sources/GhosttyBridge/GhosttyBridge.swift` — 新增 PwdDelegate adapter + forwardPwdCallback + C ABI export
- `native/src/addon.mm` — 新增 PwdForwardFn typedef + ThreadSafeFunction + JsSetPwdForwardCallback + exports
- `src/main/ipc/terminal.ts` — NativeAddon interface 加 setPwdForwardCallback, registerTerminalIpc 注册转发到 `pier:terminal:cwd-change` IPC
- `src/shared/contracts/terminal.ts` — 新增 `TerminalCwdEvent` 类型 + TerminalAPI.onCwdChange
- `src/preload/index.ts` — terminalApi.onCwdChange 实现 (ipcRenderer.on + dispose)
- `src/renderer/stores/panel-descriptor.store.ts` — PanelDescriptor 加 `path?` 字段
- `src/renderer/hooks/use-panel-descriptor.ts` — descriptor 增加 path 透传逻辑 (exactOptionalPropertyTypes 适配)
- `src/renderer/components/common/document-title.tsx` — long 缺省 fallback 加 path
- `src/renderer/panel-kits/terminal/terminal-panel.tsx` — useState(cwd) + 订阅 onCwdChange + 推送 descriptor

**任务分解层次**

- Task 1-4: TS 层数据契约和 store 扩展 (TDD, 可独立验证)
- Task 5-7: swift / C++ 跨语言通道
- Task 8-9: main + preload IPC 转发
- Task 10: terminal-panel 集成
- Task 11: 重新 build native + check + 手动 verify
- Task 12: shell-integration env 注入 (条件任务, 看 Task 11 验证结果)

---

### Task 1: 扩展 PanelDescriptor 增加 path 字段 (TDD)

**Files:**
- Modify: `src/renderer/stores/panel-descriptor.store.ts`
- Create: `tests/unit/panel-descriptor.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// tests/unit/panel-descriptor.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import { usePanelDescriptorStore } from "../../src/renderer/stores/panel-descriptor.store.ts";

describe("PanelDescriptor store", () => {
  beforeEach(() => {
    usePanelDescriptorStore.setState({ descriptors: {}, activeId: null });
  });

  it("stores path field alongside short/long", () => {
    usePanelDescriptorStore.getState().upsert("p1", {
      short: "pier",
      long: "/Users/x/ABC/pier",
      path: "/Users/x/ABC/pier",
    });
    const d = usePanelDescriptorStore.getState().descriptors.p1;
    expect(d.path).toBe("/Users/x/ABC/pier");
    expect(d.long).toBe("/Users/x/ABC/pier");
    expect(d.short).toBe("pier");
  });

  it("path is optional — descriptor without path is valid", () => {
    usePanelDescriptorStore.getState().upsert("p1", { short: "Welcome" });
    const d = usePanelDescriptorStore.getState().descriptors.p1;
    expect(d.path).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试看它 fail**

Run: `pnpm test:unit panel-descriptor`
Expected: FAIL — TypeScript 报错 `Object literal may only specify known properties, and 'path' does not exist in type 'PanelDescriptor'`

- [ ] **Step 3: 给 PanelDescriptor 加 path 字段**

修改 `src/renderer/stores/panel-descriptor.store.ts` 第 9-14 行:

```typescript
export interface PanelDescriptor {
  /** 完整形式 — document.title / titlebar / 单 tab 模式 */
  long?: string;
  /** 当前工作目录绝对路径 — terminal panel 由 OSC 7 / 上层提供; 其他 panel 可不填 */
  path?: string;
  /** 紧凑形式 — tab strip 等空间受限处 */
  short: string;
}
```

(biome 要求 interface key 字母排序,放法注意 long → path → short。)

- [ ] **Step 4: 跑测试看它 pass**

Run: `pnpm test:unit panel-descriptor`
Expected: PASS, 2 tests

- [ ] **Step 5: typecheck 确认无破坏**

Run: `pnpm typecheck`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add src/renderer/stores/panel-descriptor.store.ts tests/unit/panel-descriptor.test.ts
git commit -m "feat(panel): PanelDescriptor 增加 path 字段

为 terminal cwd pipeline 准备 — sink 端按需消费,
short/long fallback 链不变。"
```

---

### Task 2: hook 透传 path 字段 (适配 exactOptionalPropertyTypes)

**Files:**
- Modify: `src/renderer/hooks/use-panel-descriptor.ts`

- [ ] **Step 1: 写失败测试 (基于 hook 行为)**

```typescript
// tests/unit/panel-descriptor.test.ts — 追加 describe
import { renderHook } from "@testing-library/react";
import { usePanelDescriptor } from "../../src/renderer/hooks/use-panel-descriptor.ts";

describe("usePanelDescriptor hook", () => {
  beforeEach(() => {
    usePanelDescriptorStore.setState({ descriptors: {}, activeId: null });
  });

  it("upserts path field into store", () => {
    const setTitle = vi.fn();
    const panel = { id: "term-1", setTitle };

    renderHook(() =>
      usePanelDescriptor(panel, {
        short: "pier",
        long: "/Users/x/ABC/pier",
        path: "/Users/x/ABC/pier",
      })
    );

    const stored = usePanelDescriptorStore.getState().descriptors["term-1"];
    expect(stored.path).toBe("/Users/x/ABC/pier");
    expect(setTitle).toHaveBeenCalledWith("pier");
  });

  it("descriptor without path stores only short/long", () => {
    const panel = { id: "term-2", setTitle: vi.fn() };
    renderHook(() => usePanelDescriptor(panel, { short: "Terminal" }));

    const stored = usePanelDescriptorStore.getState().descriptors["term-2"];
    expect(stored.path).toBeUndefined();
    expect(stored.short).toBe("Terminal");
  });
});
```

(import `vi` from `vitest`, 顶部加 `import { vi } from "vitest";` 和 `import "@testing-library/jest-dom";` 如缺。检查 `tests/setup/jsdom-setup.ts` 是否已配 jsdom — 若未配 testing-library 需在 package.json/vitest.config 启用; 当前 `tests/setup/jsdom-setup.ts` 是 1 行 — 若 fail 自动跳过 hook 测试只跑 store 测试 — 但 TDD 流程仍按 store + hook 都写。)

- [ ] **Step 2: 跑测试看它 fail**

Run: `pnpm test:unit panel-descriptor`
Expected: FAIL — `setTitle` 被调,但 store 中 path === undefined (当前 hook 只解构 short/long)

- [ ] **Step 3: 改 hook 透传 path**

修改 `src/renderer/hooks/use-panel-descriptor.ts` 第 27-43 行 (函数主体):

```typescript
export function usePanelDescriptor(
  panel: PanelHandle,
  descriptor: PanelDescriptor
): void {
  const { short, long, path } = descriptor;
  const upsert = usePanelDescriptorStore((s) => s.upsert);
  const remove = usePanelDescriptorStore((s) => s.remove);

  useEffect(() => {
    panel.setTitle(short);
    // exactOptionalPropertyTypes — 按字段是否定义条件构造, 避免显式 undefined
    const next: PanelDescriptor = { short };
    if (long !== undefined) next.long = long;
    if (path !== undefined) next.path = path;
    upsert(panel.id, next);
    return () => remove(panel.id);
  }, [panel, short, long, path, upsert, remove]);
}
```

- [ ] **Step 4: 跑测试**

Run: `pnpm test:unit panel-descriptor`
Expected: PASS

- [ ] **Step 5: typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add src/renderer/hooks/use-panel-descriptor.ts tests/unit/panel-descriptor.test.ts
git commit -m "feat(panel): usePanelDescriptor 透传 path 字段

exactOptionalPropertyTypes 适配 — 按字段存在性条件构造,
不传 undefined key。"
```

---

### Task 3: DocumentTitle sink 优先使用 path (TDD)

**Files:**
- Modify: `src/renderer/components/common/document-title.tsx`
- Create: `tests/unit/cwd-derive.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// tests/unit/cwd-derive.test.ts
import { describe, expect, it } from "vitest";

/**
 * resolveLong — sink fallback 优先级.
 *
 * 当 descriptor 同时有 path 时, document.title 优先用 path (绝对路径有信息密度);
 * 没有 path 时回退到 long; 都没有用 short.
 */
function resolveLong(d: { short: string; long?: string; path?: string }): string {
  return d.path ?? d.long ?? d.short;
}

describe("resolveLong", () => {
  it("prefers path over long", () => {
    expect(
      resolveLong({ short: "pier", long: "Pier project", path: "/Users/x/pier" })
    ).toBe("/Users/x/pier");
  });

  it("falls back to long when no path", () => {
    expect(resolveLong({ short: "x", long: "long text" })).toBe("long text");
  });

  it("falls back to short when neither", () => {
    expect(resolveLong({ short: "x" })).toBe("x");
  });
});
```

- [ ] **Step 2: 跑测试看它 fail**

Run: `pnpm test:unit cwd-derive`
Expected: FAIL — `resolveLong is not defined` (or `Cannot find name`)

注意:这里的 resolveLong 还没有从 source code import,纯函数定义在测试文件里也可以先跑过。让步骤直接是定义后跑;失败的语义其实是 `document.title` 没真正用 path。下一步改 sink 让真实代码也走这个逻辑。

- [ ] **Step 3: 把 resolveLong 提到 source,document-title 使用**

修改 `src/renderer/components/common/document-title.tsx`:

```tsx
import { useEffect } from "react";
import {
  type PanelDescriptor,
  useActiveDescriptor,
} from "@/stores/panel-descriptor.store.ts";

/**
 * 解析 document.title 用的"长形式"字符串.
 * 优先级:path (绝对路径, 信息密度最高) > long > short.
 */
export function resolveLong(d: PanelDescriptor): string {
  return d.path ?? d.long ?? d.short;
}

/**
 * DocumentTitle — 把当前 active panel 的 descriptor 同步到 document.title.
 *
 * Electron BrowserWindow.title 默认跟随 webContents.document.title 变化, 主进程
 * 不需要 IPC. 无 active panel 时 fallback "Pier".
 *
 * 渲染 null:这是个纯 side-effect 组件, 不占 DOM.
 */
export function DocumentTitle(): null {
  const active = useActiveDescriptor();
  useEffect(() => {
    const text = active ? resolveLong(active) : null;
    document.title = text ? `${text} — Pier` : "Pier";
  }, [active]);
  return null;
}
```

更新 `tests/unit/cwd-derive.test.ts` 改成 import 真实 resolveLong:

```typescript
import { describe, expect, it } from "vitest";
import { resolveLong } from "../../src/renderer/components/common/document-title.tsx";
// ... 测试用例不变
```

- [ ] **Step 4: 跑测试**

Run: `pnpm test:unit cwd-derive`
Expected: PASS, 3 tests

- [ ] **Step 5: title-bar 同步用 resolveLong**

修改 `src/renderer/components/common/title-bar.tsx`:

```tsx
import { resolveLong } from "@/components/common/document-title.tsx";
import { useActiveDescriptor } from "@/stores/panel-descriptor.store.ts";

/**
 * TitleBar — macOS hiddenInset 自定义标题栏.
 * (注释保持原状)
 */
export function TitleBar() {
  const active = useActiveDescriptor();
  const text = active ? resolveLong(active) : "Pier";
  return (
    <div className="app-drag flex h-[38px] shrink-0 items-center justify-center border-[var(--sidebar-border)] border-b bg-[var(--sidebar)]">
      <span className="select-none font-medium text-muted-foreground text-xs">
        {text}
      </span>
    </div>
  );
}
```

- [ ] **Step 6: 完整 check**

Run: `pnpm check`
Expected: typecheck / lint / depcruise / file-size 全绿

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/common/document-title.tsx src/renderer/components/common/title-bar.tsx tests/unit/cwd-derive.test.ts
git commit -m "feat(panel): sink 优先使用 path 作为长形式

DocumentTitle / TitleBar 共用 resolveLong, path > long > short。"
```

---

### Task 4: shared contracts 增加 TerminalCwdEvent 类型

**Files:**
- Modify: `src/shared/contracts/terminal.ts`

- [ ] **Step 1: 加事件类型 + onCwdChange 方法**

修改 `src/shared/contracts/terminal.ts`:

```typescript
export interface TerminalFrame {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface CreateTerminalArgs {
  frame: TerminalFrame;
  panelId: string;
}

export interface CreateTerminalResult {
  error?: string;
  ok: boolean;
}

/**
 * Terminal cwd 变化事件 — swift OSC 7 解析后通过 IPC 推送到 renderer.
 * cwd 是绝对路径 (不带 file:// 前缀, 已由 swift 端从 URL 提取).
 */
export interface TerminalCwdEvent {
  cwd: string;
  panelId: string;
}

export interface TerminalAPI {
  close(panelId: string): Promise<void>;
  create(args: CreateTerminalArgs): Promise<CreateTerminalResult>;
  focus(panelId: string): void;
  hide(panelId: string): void;
  /**
   * 订阅 terminal cwd 变化. 回调返回 dispose 函数, 调用即取消订阅.
   * 单个 listener 接收所有 panel 的事件 — 调用方按 panelId 过滤。
   */
  onCwdChange(cb: (event: TerminalCwdEvent) => void): () => void;
  setActivePanelKind: (
    kind: "terminal" | "web",
    panelId: string | null
  ) => void;
  setFrame(panelId: string, frame: TerminalFrame): void;
  setOverlayActive(active: boolean): void;
  setup(): Promise<CreateTerminalResult>;
  show(panelId: string): void;
}
```

(注意 biome 要求 interface key 排序: close → create → focus → hide → onCwdChange → setActivePanelKind → setFrame → setOverlayActive → setup → show)

- [ ] **Step 2: typecheck 看哪里炸**

Run: `pnpm typecheck`
Expected: FAIL — preload `terminalApi` 缺 onCwdChange 实现。这是下一个 task 修。

- [ ] **Step 3: Commit (允许 typecheck 暂时红 — 是下一步要修的接口扩展, 不能拆得更小)**

```bash
git add src/shared/contracts/terminal.ts
git commit -m "feat(contracts): TerminalAPI 增加 onCwdChange + TerminalCwdEvent

跨进程 cwd 上报接口契约, preload/main 在后续 task 实现。"
```

---

### Task 5: preload 实现 onCwdChange

**Files:**
- Modify: `src/preload/index.ts`

- [ ] **Step 1: 加 onCwdChange 实现**

修改 `src/preload/index.ts` 第 76-90 行 (terminalApi 定义) 末尾 (按 biome 排序加在 `setActivePanelKind` 前):

```typescript
const terminalApi: TerminalAPI = {
  close: (panelId) => ipcRenderer.invoke("pier:terminal:close", panelId),
  create: (args) => ipcRenderer.invoke("pier:terminal:create", args),
  focus: (panelId) => ipcRenderer.send("pier:terminal:focus", panelId),
  hide: (panelId) => ipcRenderer.send("pier:terminal:hide", panelId),
  onCwdChange: (cb) => {
    const listener = (
      _event: unknown,
      payload: { panelId: string; cwd: string }
    ) => {
      cb(payload);
    };
    ipcRenderer.on("pier:terminal:cwd-change", listener);
    return () => {
      ipcRenderer.off("pier:terminal:cwd-change", listener);
    };
  },
  setActivePanelKind: (kind, panelId) =>
    ipcRenderer.send("pier:terminal:set-active-panel-kind", kind, panelId),
  setFrame: (panelId, frame) =>
    ipcRenderer.send("pier:terminal:set-frame", panelId, frame),
  setOverlayActive: (active) =>
    ipcRenderer.send("pier:terminal:set-overlay", active),
  setup: () => ipcRenderer.invoke("pier:terminal:setup"),
  show: (panelId) => ipcRenderer.send("pier:terminal:show", panelId),
};
```

- [ ] **Step 2: typecheck**

Run: `pnpm typecheck`
Expected: PASS (contract + preload 对齐)

- [ ] **Step 3: lint**

Run: `pnpm lint`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/preload/index.ts
git commit -m "feat(preload): terminalApi.onCwdChange 接 ipcRenderer 订阅

返回 dispose, 关闭 listener 走 ipcRenderer.off。"
```

---

### Task 6: main IPC 注册 PWD forward callback (空通道先打通)

**Files:**
- Modify: `src/main/ipc/terminal.ts`

- [ ] **Step 1: NativeAddon interface 加 setPwdForwardCallback**

修改 `src/main/ipc/terminal.ts` 第 8-43 行 (NativeAddon interface), 在 setKeyboardForwardCallback 后加:

```typescript
interface NativeAddon {
  closeAllTerminals(parentHandle: Buffer): void;
  closeTerminal(panelId: string): void;
  createTerminal(
    parentHandle: Buffer,
    panelId: string,
    frame: TerminalFrame
  ): boolean;
  detachWindow(parentHandle: Buffer): void;
  focusTerminal(panelId: string): void;
  hideTerminal(panelId: string): void;
  setActivePanelKind(
    parentHandle: Buffer,
    kindRaw: number,
    panelId: string | null
  ): void;
  setFrame(panelId: string, frame: TerminalFrame): void;
  setKeyboardForwardCallback(
    cb:
      | ((
          browserWindowId: number,
          modifierFlags: number,
          chars: string
        ) => void)
      | null
  ): void;
  setOverlayActive(parentHandle: Buffer, active: boolean): void;
  /**
   * 注册 PWD forward callback. swift TerminalSurfacePwdDelegate 收到 OSC 7 后调用,
   * 传 (browserWindowId, panelId, cwd). 用 windowId 路由到对应 BrowserWindow 的
   * renderer (多窗口下避免广播污染). 传 null 解绑.
   */
  setPwdForwardCallback(
    cb:
      | ((browserWindowId: number, panelId: string, cwd: string) => void)
      | null
  ): void;
  setupWindow(parentHandle: Buffer, browserWindowId: number): boolean;
  showTerminal(panelId: string): void;
}
```

- [ ] **Step 2: registerTerminalIpc 注册 PWD callback,转发到 IPC**

在第 102 行 keyboard callback 注册之后加:

```typescript
  // 注册 PWD forward callback: swift TerminalSurfacePwdDelegate 收到 OSC 7 后,
  // 通过 ThreadSafeFunction 调到这里. callback 收到 (browserWindowId, panelId, cwd),
  // 用 windowId 精准路由到对应 BrowserWindow 的 renderer.
  //
  // 这是 terminal panel tab title / 系统 title 反映 cwd 的唯一通道. 不依赖
  // proc_pidinfo polling — Ghostty 已经完整解析 OSC 7, 被动接收即可.
  addon?.setPwdForwardCallback((browserWindowId, panelId, cwd) => {
    try {
      const targetWindow = BrowserWindow.fromId(browserWindowId);
      if (!targetWindow || targetWindow.isDestroyed()) {
        return;
      }
      const wc = targetWindow.webContents;
      if (wc.isDestroyed()) {
        return;
      }
      wc.send("pier:terminal:cwd-change", { panelId, cwd });
    } catch (err) {
      console.error("[pier-cwd-forward] send failed:", err);
    }
  });
```

- [ ] **Step 3: typecheck (会 fail — native addon 还没暴露这个方法,但接口契约对齐 main 自己的类型)**

Run: `pnpm typecheck`
Expected: PASS — interface 是 TS 侧声明, 实际 addon load 时如果 addon 没 method 会运行时 throw,这里只是 type-level pass.

注意:`addon?.setPwdForwardCallback(...)` 是 optional chain — 即使运行时 addon 没这个方法也只是 noop,不 crash。完整可用要等 Task 7 加 C++ export。

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc/terminal.ts
git commit -m "feat(main): main IPC 转发 PWD callback 到 cwd-change 事件

照 keyboard forward 模板, 按 browserWindowId 路由到对应窗口
renderer, 多窗口不污染。"
```

---

### Task 7: native addon (addon.mm) 加 PWD forward 通道

**Files:**
- Modify: `native/src/addon.mm`

- [ ] **Step 1: 加 C ABI 声明 + typedef**

修改 `native/src/addon.mm` 第 6-25 行 (extern "C" 块):

```cpp
extern "C" {
    bool ghostty_bridge_setup_window(void* nsWindow, long browserWindowId);
    void ghostty_bridge_set_overlay_active(void* nsWindow, bool active);
    bool ghostty_bridge_create_terminal(void* nsWindow, const char* panelId,
                                         double x, double y, double w, double h);
    void ghostty_bridge_set_frame(const char* panelId,
                                   double x, double y, double w, double h);
    void ghostty_bridge_show(const char* panelId);
    void ghostty_bridge_hide(const char* panelId);
    void ghostty_bridge_close(const char* panelId);
    void ghostty_bridge_focus(const char* panelId);
    void ghostty_bridge_close_all(void* nsWindow);
    void ghostty_bridge_detach_window(void* nsWindow);
    typedef void (*KeyboardForwardFn)(long browserWindowId, unsigned long modifiers, const char* chars);
    void ghostty_bridge_set_keyboard_forward_callback(KeyboardForwardFn cb);
    // PWD forward: swift PwdDelegate 收到 OSC 7 → 此 trampoline → JS.
    // 签名 (browserWindowId, panelId UTF-8, cwd UTF-8).
    typedef void (*PwdForwardFn)(long browserWindowId, const char* panelId, const char* cwd);
    void ghostty_bridge_set_pwd_forward_callback(PwdForwardFn cb);
    void ghostty_bridge_set_active_panel_kind(void* nsWindow, long kindRaw, const char* panelId);
}
```

- [ ] **Step 2: 加 PWD trampoline + ThreadSafeFunction**

在 keyboard trampoline 后 (第 147 行后, JsSetActivePanelKind 前) 插入:

```cpp
// ---- PWD forward callback (swift → main JS) ----
//
// swift TerminalSurfacePwdDelegate 收到 OSC 7 → forwardPwdCallback → 这里. 通过
// ThreadSafeFunction 把事件分发到 main JS 线程, 让 JS 端注册的 callback 收到
// (browserWindowId, panelId, cwd).
//
// 与 keyboard forward 同理:不能直接在 swift 线程调 napi function.
static Napi::ThreadSafeFunction g_pwdTSFN;

struct PwdForwardPayload {
    long windowId;
    std::string panelId;  // heap-owned (跨线程持久化)
    std::string cwd;      // heap-owned
};

static void g_pwdForwardTrampoline(long windowId, const char* panelId, const char* cwd) {
    if (!g_pwdTSFN) return;
    auto* payload = new PwdForwardPayload{ windowId, std::string(panelId), std::string(cwd) };
    auto status = g_pwdTSFN.BlockingCall(payload, [](Napi::Env env, Napi::Function jsCallback, PwdForwardPayload* p) {
        jsCallback.Call({
            Napi::Number::New(env, static_cast<double>(p->windowId)),
            Napi::String::New(env, p->panelId),
            Napi::String::New(env, p->cwd),
        });
        delete p;
    });
    if (status != napi_ok) {
        delete payload;
    }
}

static Napi::Value JsSetPwdForwardCallback(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() == 0 || info[0].IsNull() || info[0].IsUndefined()) {
        if (g_pwdTSFN) {
            g_pwdTSFN.Release();
            g_pwdTSFN = Napi::ThreadSafeFunction();
        }
        ghostty_bridge_set_pwd_forward_callback(nullptr);
        return env.Undefined();
    }
    Napi::Function jsFn = info[0].As<Napi::Function>();
    if (g_pwdTSFN) g_pwdTSFN.Release();
    g_pwdTSFN = Napi::ThreadSafeFunction::New(env, jsFn, "PierPwdForward", 0, 1);
    ghostty_bridge_set_pwd_forward_callback(&g_pwdForwardTrampoline);
    return env.Undefined();
}
```

- [ ] **Step 3: Init 增加 exports**

修改 Init 函数 (第 180-194 行), 在 setKeyboardForwardCallback 后加:

```cpp
static Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("setupWindow",     Napi::Function::New(env, JsSetupWindow));
    exports.Set("setOverlayActive", Napi::Function::New(env, JsSetOverlayActive));
    exports.Set("createTerminal",  Napi::Function::New(env, JsCreateTerminal));
    exports.Set("setFrame",        Napi::Function::New(env, JsSetFrame));
    exports.Set("showTerminal",    Napi::Function::New(env, JsShow));
    exports.Set("hideTerminal",    Napi::Function::New(env, JsHide));
    exports.Set("closeTerminal",   Napi::Function::New(env, JsClose));
    exports.Set("focusTerminal",   Napi::Function::New(env, JsFocus));
    exports.Set("closeAllTerminals", Napi::Function::New(env, JsCloseAll));
    exports.Set("detachWindow",    Napi::Function::New(env, JsDetachWindow));
    exports.Set("setKeyboardForwardCallback", Napi::Function::New(env, JsSetKeyboardForwardCallback));
    exports.Set("setPwdForwardCallback", Napi::Function::New(env, JsSetPwdForwardCallback));
    exports.Set("setActivePanelKind", Napi::Function::New(env, JsSetActivePanelKind));
    return exports;
}
```

- [ ] **Step 4: rebuild native**

Run:
```bash
cd native && bash build.sh && cd -
```
Expected: 编译成功 (无 unresolved symbol —— 即使 swift 端还没实现 `ghostty_bridge_set_pwd_forward_callback`,链接会 fail; 因此本 task 必须和 Task 8 紧邻提交)。

- [ ] **Step 5: Commit (与 Task 8 合并提交以避免 build 红)**

暂不 commit, 进入 Task 8 — 完成 swift 侧后一起提交。

---

### Task 8: swift 实现 PwdDelegate + C ABI export

**Files:**
- Modify: `native/Sources/GhosttyBridge/GhosttyBridge.swift`

- [ ] **Step 1: Terminal struct 增加 delegate 字段**

修改 `native/Sources/GhosttyBridge/GhosttyBridge.swift` 第 138-142 行:

```swift
// MARK: - Terminal record

private struct Terminal {
    let containerView: NSView
    let terminalView: TerminalView
    let parentWindow: NSWindow
    /// PwdDelegate adapter (strong-hold — terminalView.delegate 是 weak).
    /// 随 Terminal 一起释放, terminalView weak ref 自动 nil.
    let pwdDelegate: TerminalPwdDelegate
}
```

- [ ] **Step 2: 加 TerminalPwdDelegate adapter class**

在 EventRouterView class 结束后 (约第 134 行) 插入:

```swift
// MARK: - PWD delegate adapter

/// 实现 TerminalSurfacePwdDelegate, 每个 terminal 一个实例, 持有 panelId 用于
/// 区分多 panel. cwd 变化时调全局 forwardPwdCallback 把 (panelId, path) 转给
/// main process.
///
/// weak-set 到 terminalView.delegate, strong-hold 在 Terminal struct 中以保证
/// 生命周期 (terminalView.delegate weak — 没 strong owner 会立即 nil).
@MainActor
final class TerminalPwdDelegate: TerminalSurfacePwdDelegate {
    let panelId: String

    /// 全局 callback: 收到 OSC 7 path 时调用, 把 (browserWindowId, panelId, path)
    /// 转给 main process. browserWindowId 在 setupWindow 时记录, 由 GhosttyBridgeImpl
    /// 反查 (panel 所属 NSWindow → browserWindowId 映射).
    static var forwardPwdCallback: ((Int, String, String) -> Void)?

    init(panelId: String) {
        self.panelId = panelId
    }

    func terminalDidChangeWorkingDirectory(_ path: String) {
        // browserWindowId 由 GhosttyBridgeImpl 通过 panelId 反查
        guard let windowId = GhosttyBridgeImpl.shared.browserWindowId(forPanelId: panelId) else {
            return
        }
        TerminalPwdDelegate.forwardPwdCallback?(windowId, panelId, path)
    }
}
```

- [ ] **Step 3: GhosttyBridgeImpl 加 browserWindowId 映射 + panelId 反查**

修改 `GhosttyBridgeImpl` 类内, 在 `private var windowStates` 后 (约第 182 行) 加:

```swift
    /// panelId → browserWindowId 映射. createTerminal 时建立, close/closeAll 时清理.
    /// PwdDelegate 收到 OSC 7 时需要反查 panel 所属窗口以路由 IPC.
    private var panelIdToBrowserWindowId: [String: Int] = [:]

    /// NSWindow → browserWindowId 映射. setupWindow 时建立, detachWindow 时清理.
    /// createTerminal 用它把 panelId 关联到 browserWindowId.
    private var windowToBrowserWindowId: [ObjectIdentifier: Int] = [:]

    func browserWindowId(forPanelId panelId: String) -> Int? {
        return panelIdToBrowserWindowId[panelId]
    }
```

- [ ] **Step 4: setupWindow 记录 browserWindowId**

修改 `setupWindow(parent:browserWindowId:)` 函数 (约第 208 行) 末尾, return true 前加:

```swift
        // 初始化 per-window keyboard state (PanelKind 默认 .web — 安全, 不抢 firstResponder)
        windowStates[windowId] = WindowKeyboardState()

        // 记录 browserWindowId 映射 — PwdDelegate 反查 panel→window→browserId 路由 IPC.
        windowToBrowserWindowId[windowId] = browserWindowId

        return true
    }
```

- [ ] **Step 5: createTerminal 挂 delegate + 建 panelId→browserWindowId**

修改 `createTerminal(parent:panelId:viewport:)` 函数 (约第 344 行), 在 `let terminalView = TerminalView(...)` 之后 + `terminals[panelId] = Terminal(...)` 之前:

```swift
        let terminalView = TerminalView(frame: NSRect(origin: .zero, size: frame.size))
        terminalView.autoresizingMask = [.width, .height]
        terminalView.configuration = TerminalSurfaceOptions(backend: .exec)
        terminalView.controller = controller(for: parent)

        // 挂 PwdDelegate — 接 OSC 7, 转发 (panelId, path) 给 main process.
        let pwdDelegate = TerminalPwdDelegate(panelId: panelId)
        terminalView.delegate = pwdDelegate

        let container = NSView(frame: frame)
        container.addSubview(terminalView)

        // ... (contentView.addSubview 等不变)
        contentView.addSubview(container, positioned: .below, relativeTo: nil)

        terminals[panelId] = Terminal(
            containerView: container,
            terminalView: terminalView,
            parentWindow: parent,
            pwdDelegate: pwdDelegate
        )

        // 建立 panelId → browserWindowId 映射 (PwdDelegate 路由依赖)
        let parentWindowId = ObjectIdentifier(parent)
        if let bid = windowToBrowserWindowId[parentWindowId] {
            panelIdToBrowserWindowId[panelId] = bid
        }
```

- [ ] **Step 6: close / closeAll / detachWindow 清理映射**

修改 `close(panelId:)` (约第 454 行), 在 `terminals.removeValue(forKey: panelId)` 后加:

```swift
    func close(panelId: String) {
        guard let term = terminals[panelId] else { return }
        let parent = term.parentWindow
        term.containerView.removeFromSuperview()
        terminals.removeValue(forKey: panelId)
        panelIdToBrowserWindowId.removeValue(forKey: panelId)
        if activePanelId == panelId { activePanelId = nil }
        // ... 余下不变
```

修改 `closeAll(parent:)` (约第 492 行):

```swift
    func closeAll(parent: NSWindow) {
        let windowId = ObjectIdentifier(parent)
        let toClose = terminals.filter { ObjectIdentifier($0.value.parentWindow) == windowId }
        for (panelId, term) in toClose {
            term.containerView.removeFromSuperview()
            terminals.removeValue(forKey: panelId)
            panelIdToBrowserWindowId.removeValue(forKey: panelId)
        }
        if let activeId = activePanelId, terminals[activeId] == nil {
            activePanelId = nil
        }
        eventRouters[windowId]?.targets.removeAll()
    }
```

修改 `detachWindow(parent:)` (约第 512 行) 末尾:

```swift
        controllers.removeValue(forKey: windowId)
        windowToBrowserWindowId.removeValue(forKey: windowId)
    }
```

- [ ] **Step 7: 加 setPwdForwardCallback 方法**

在 `setKeyboardForwardCallback` (约第 338 行) 后加:

```swift
    /// 注册 PWD forward callback: swift TerminalSurfacePwdDelegate 收到 OSC 7 后,
    /// 把 (browserWindowId, panelId, cwd) 转给 main process. 与 keyboard forward
    /// 路径同模式 (NSEvent monitor → C 函数指针 → N-API ThreadSafeFunction).
    func setPwdForwardCallback(_ cb: @escaping (Int, String, String) -> Void) {
        TerminalPwdDelegate.forwardPwdCallback = cb
    }
```

- [ ] **Step 8: 加 C ABI export**

在文件末尾 `ghosttyBridgeSetActivePanelKind` 前 (约第 654 行) 加:

```swift
/// C 函数指针类型: 接收 browserWindowId (Int), panelId UTF-8 C string, cwd UTF-8.
public typealias PwdForwardCallback = @convention(c) (Int, UnsafePointer<CChar>, UnsafePointer<CChar>) -> Void

@_cdecl("ghostty_bridge_set_pwd_forward_callback")
public func ghosttyBridgeSetPwdForwardCallback(_ cb: PwdForwardCallback?) {
    MainActor.assumeIsolated {
        if let cb {
            GhosttyBridgeImpl.shared.setPwdForwardCallback { wid, panelId, cwd in
                panelId.withCString { pidPtr in
                    cwd.withCString { cwdPtr in
                        cb(wid, pidPtr, cwdPtr)
                    }
                }
            }
        } else {
            GhosttyBridgeImpl.shared.setPwdForwardCallback { _, _, _ in }
        }
    }
}
```

- [ ] **Step 9: rebuild native**

Run:
```bash
cd native && bash build.sh && cd -
```
Expected: 编译成功, 无 unresolved symbol。`.node` 文件更新时间 = 现在。

如失败:
- swift "use of unresolved identifier `TerminalSurfacePwdDelegate`" → 确认 `import GhosttyTerminal` 在文件顶部 (已有)
- "Type `TerminalPwdDelegate` does not conform to protocol" → check protocol 方法签名: `func terminalDidChangeWorkingDirectory(_ path: String)`,无 throws,无 return value
- "Cannot find `Terminal` in scope" → struct 名同 `Terminal` 跟 `GhosttyTerminal.Terminal` 冲突,改名为 `PierTerminal` 或在 import 时 alias

- [ ] **Step 10: typecheck (TS 应已无错 — addon 接口运行时绑定)**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 11: Commit (合并 Task 7 + Task 8 的所有改动)**

```bash
git add native/src/addon.mm native/Sources/GhosttyBridge/GhosttyBridge.swift
git commit -m "feat(native): swift + C++ 打通 PWD forward 通道

- swift: TerminalPwdDelegate adapter 实现 TerminalSurfacePwdDelegate
- swift: GhosttyBridgeImpl 维护 panelId/window → browserWindowId 映射
- C++: g_pwdTSFN ThreadSafeFunction + JsSetPwdForwardCallback exports

整个链路: OSC 7 → Ghostty parser → PwdDelegate → C trampoline → JS。"
```

---

### Task 9: terminal-panel 订阅 onCwdChange + 推送 descriptor

**Files:**
- Modify: `src/renderer/panel-kits/terminal/terminal-panel.tsx`

- [ ] **Step 1: 加 useState + useEffect 订阅,导出 basename helper**

修改 `src/renderer/panel-kits/terminal/terminal-panel.tsx`:

完整新文件 (替换原内容):

```tsx
import type { TerminalFrame } from "@shared/contracts/terminal.ts";
import type { IDockviewPanelProps } from "dockview-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePanelDescriptor } from "@/hooks/use-panel-descriptor.ts";

function getAnchorFrame(anchor: HTMLDivElement): TerminalFrame | null {
  const r = anchor.getBoundingClientRect();
  if (r.width < 10 || r.height < 10) {
    return null;
  }
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

function waitForRealSize(anchor: HTMLDivElement): Promise<void> {
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

/**
 * 路径 basename — POSIX 形式 (终端始终在 macOS). 末尾 '/' 容错处理:
 * "/" → "/", "/a/b/" → "b", "/a/b" → "b".
 */
function basename(path: string): string {
  if (path === "/" || path === "") return path || "Terminal";
  const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

export function TerminalPanel(props: IDockviewPanelProps) {
  const { api } = props;
  const panelId = api.id;
  const anchorRef = useRef<HTMLDivElement>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [cwd, setCwd] = useState<string | null>(null);

  // 订阅 swift OSC 7 → main → 这里. cwd 变化时 setState 触发 descriptor 重新计算.
  // 单 listener 接所有 panel 的事件 — 按 panelId 过滤.
  useEffect(() => {
    const dispose = window.pier.terminal.onCwdChange((event) => {
      if (event.panelId === panelId) {
        setCwd(event.cwd);
      }
    });
    return dispose;
  }, [panelId]);

  // 把 cwd 翻译成 descriptor 三字段:
  // - short:basename(cwd) — tab strip
  // - long:cwd — sink 长形式 (但 resolveLong 会优先用 path)
  // - path:cwd — sink 优先消费, 也是未来 breadcrumb / status bar 用的字段
  // 没 cwd 时 fallback "Terminal" (只填 short, 不传 long/path).
  usePanelDescriptor(
    api,
    cwd
      ? { short: basename(cwd), long: cwd, path: cwd }
      : { short: "Terminal" }
  );

  useLayoutEffect(() => {
    const parent = parentRef.current?.parentElement;
    const anchor = anchorRef.current;
    if (!(parent && anchor)) {
      return;
    }

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
    if (!anchor) {
      return;
    }

    let disposed = false;
    const subscriptions: Array<{ dispose(): void }> = [];
    let lastFrame = "";

    const sendFrameNow = () => {
      if (disposed) {
        return;
      }
      const frame = getAnchorFrame(anchor);
      if (!frame) {
        return;
      }
      const key = `${frame.x},${frame.y},${frame.width},${frame.height}`;
      if (key === lastFrame) {
        return;
      }
      lastFrame = key;
      window.pier.terminal.setFrame(panelId, frame);
    };

    let rafId = 0;
    const scheduleSync = () => {
      if (rafId) {
        return;
      }
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        sendFrameNow();
      });
    };

    const init = async () => {
      await waitForRealSize(anchor);
      if (disposed) {
        return;
      }

      const frame = getAnchorFrame(anchor);
      if (!frame) {
        setError("无法获取面板坐标");
        return;
      }

      const result = await window.pier.terminal.create({ panelId, frame });
      if (!result.ok) {
        setError(result.error ?? "终端创建失败");
        return;
      }

      subscriptions.push(
        api.onDidVisibilityChange((e) => {
          if (e.isVisible) {
            lastFrame = "";
            sendFrameNow();
            window.pier.terminal.show(panelId);
          } else {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                if (!disposed) {
                  window.pier.terminal.hide(panelId);
                }
              });
            });
          }
        })
      );

      subscriptions.push(
        api.onDidActiveChange((e) => {
          if (e.isActive) {
            window.pier.terminal.focus(panelId);
          }
        })
      );

      const parent = anchor.parentElement;
      if (parent) {
        const ro = new ResizeObserver(scheduleSync);
        ro.observe(parent);
        subscriptions.push({ dispose: () => ro.disconnect() });
      }

      const onWindowResize = () => sendFrameNow();
      window.addEventListener("resize", onWindowResize);
      subscriptions.push({
        dispose: () => window.removeEventListener("resize", onWindowResize),
      });
    };

    init();

    return () => {
      disposed = true;
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      for (const s of subscriptions) {
        s.dispose();
      }
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
    <div className="h-full" ref={parentRef}>
      <div className="terminal-anchor" ref={anchorRef} />
    </div>
  );
}
```

- [ ] **Step 2: typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: lint**

Run: `pnpm lint`
Expected: PASS

- [ ] **Step 4: 单元测试 basename (TDD)**

补充 `tests/unit/cwd-derive.test.ts`:

```typescript
// 文件顶部 import:
import { basename } from "../../src/renderer/panel-kits/terminal/terminal-panel.tsx";
```

但 basename 现在是 module-local 不 export — 让步骤 1 中 basename 改成 `export function basename`。

加测试:

```typescript
describe("basename", () => {
  it('handles "/"', () => {
    expect(basename("/")).toBe("/");
  });
  it("strips trailing slash", () => {
    expect(basename("/a/b/")).toBe("b");
  });
  it("returns last segment", () => {
    expect(basename("/Users/x/ABC/pier")).toBe("pier");
  });
  it("returns input if no slash", () => {
    expect(basename("pier")).toBe("pier");
  });
  it('fallback "Terminal" for empty', () => {
    expect(basename("")).toBe("Terminal");
  });
});
```

Run: `pnpm test:unit cwd-derive`
Expected: PASS, 8 tests (3 resolveLong + 5 basename)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/panel-kits/terminal/terminal-panel.tsx tests/unit/cwd-derive.test.ts
git commit -m "feat(terminal): panel 订阅 onCwdChange 推 descriptor

basename + cwd 推 short/long/path; cwd 未到达时 fallback Terminal。"
```

---

### Task 10: 跨语言完整 check + 手动验证

**Files:**
- 无修改 (验证阶段)

- [ ] **Step 1: 确认 native 已 rebuild**

Run:
```bash
ls -la native/build/Release/ghostty_native.node
```
Expected: 文件存在,mtime 是 Task 7+8 完成时刻。否则:

```bash
cd native && bash build.sh && cd -
```

- [ ] **Step 2: 完整 check**

Run: `pnpm check`
Expected: typecheck / lint / depcruise / file-size 全绿

- [ ] **Step 3: 运行单元测试**

Run: `pnpm test:unit`
Expected: 全绿,8+ 个 cwd / descriptor 相关测试 pass

- [ ] **Step 4: 启动 Electron 手动 verify**

Run: `pnpm dev`

操作清单:
1. 启动后窗口出现 — tab title 应显示 "Terminal" (cwd 未到达, fallback)
2. 在 terminal 里执行 `cd /tmp` — **预期** tab title 变 "tmp", document.title 变 "/tmp — Pier", macOS titlebar 同步
3. 再 `cd ~/ABC/pier` — tab title 变 "pier", document.title 变 "/Users/.../pier — Pier"
4. 开第二个 terminal panel,在它里面 cd 到别处 — 两个 tab 各自更新,互不干扰

**如果第 2 步 tab title 没变**(常见):
- 打开 dev tools 看 renderer console — 有没有 `pier:terminal:cwd-change` 事件到达
  - 无 → 说明链路上游没发,继续追
- 打开 main 进程 log — `addon.setPwdForwardCallback` callback 内有没有 print
  - 加 `console.log("[pier-cwd-forward] received", panelId, cwd);` 临时调试
  - 无 → 说明 swift 端 PwdDelegate 没收到 → **OSC 7 未发**,跳到 Task 11

- [ ] **Step 5: 如所有验证通过, Commit verify 笔记**

无文件改动则跳过 commit。验证结果记在下一 step 决定是否 Task 11。

---

### Task 11 (条件): shell-integration env 注入

**前置条件**:Task 10 step 4 验证发现 OSC 7 未发到 swift (cwd-change 事件根本不触发)。

如果验证通过,跳过本 task。

**Files:**
- Modify: `native/Sources/GhosttyBridge/GhosttyBridge.swift` (createTerminal 内)

- [ ] **Step 1: 查 GhosttyKit shell-integration env 注入接口**

Run:
```bash
grep -rE "shellIntegration|XDG_DATA_DIRS|GHOSTTY_RESOURCES" /Users/xyz/ABC/pier/.claude/worktrees/vigorous-wilson-616700/native/.build/checkouts/libghostty-spm/Sources/GhosttyTerminal --include="*.swift" | head -20
```

预期发现 `TerminalSurfaceOptions` 上有 `envInject` / `shellIntegration` 之类 toggle。

- [ ] **Step 2: 启用 shell-integration**

修改 `createTerminal(...)` 内 `TerminalSurfaceOptions(backend: .exec)` 这一行,根据 step 1 找到的 API 改成显式启用 (具体字段名以 grep 结果为准, 常见命名:`shellIntegrationFeatures` / `shellIntegration: .auto`)。

示例 (具体字段须按 grep 结果对齐):

```swift
terminalView.configuration = TerminalSurfaceOptions(
    backend: .exec,
    shellIntegration: .auto  // 或对应字段
)
```

- [ ] **Step 3: rebuild + verify**

Run:
```bash
cd native && bash build.sh && cd -
pnpm dev
```

再次执行 Task 10 step 4 的验证清单。

- [ ] **Step 4: Commit**

```bash
git add native/Sources/GhosttyBridge/GhosttyBridge.swift
git commit -m "feat(terminal): 默认启用 Ghostty shell-integration

让 OSC 7 cwd 上报自动生效, 不依赖用户 shell rc 手配。"
```

---

## 验证清单 (整体)

执行完所有 task 后, 用以下清单验证:

- [ ] `pnpm check` 全绿
- [ ] `pnpm test:unit` cwd / descriptor / basename 测试全 pass
- [ ] `pnpm dev` 启动后,首次显示 "Terminal" (cwd 未到达 fallback)
- [ ] 在 terminal 里 `cd /tmp` 后:
  - dockview tab 显示 "tmp"
  - 浏览器/Electron 窗口 title 显示 "/tmp — Pier"
  - macOS hiddenInset titlebar 显示 "/tmp"
- [ ] 开第二个 terminal panel,两个 tab cwd 独立更新
- [ ] 关闭一个 terminal panel,store 自动清理 descriptor,active 切换时另一个 tab 接管 title

---

## 风险与回退点

| 风险 | 触发症状 | 回退 |
|---|---|---|
| Ghostty `TerminalSurfacePwdDelegate` 在当前 libghostty-spm 版本签名不一致 | swift build fail | check `.build/checkouts/libghostty-spm/Sources/GhosttyTerminal/Surface/TerminalSurfaceViewDelegate.swift` 实际 signature, 调整 Task 8 step 2 |
| OSC 7 不发(shell 不支持) | Task 10 step 4 cwd 永不更新 | Task 11 (shell-integration env) 或 fallback proc_pidinfo polling (后续 PR) |
| `terminalView.delegate` weak 释放后 dangling | runtime crash 在 OSC 7 触发时 | 确认 Task 8 step 1 Terminal struct 持有 pwdDelegate strong ref |
| multi-window 路由错 | 多窗口下 cwd 串台 | 确认 Task 8 step 3-6 panelId→browserWindowId 映射 + cleanup 完整 |

---

## 完成后下一步 (out of scope)

- 接 OSC 0/2 title(`TerminalSurfaceTitleDelegate`) — 让 `claude` / `vim` 等自定义 title 也走 descriptor
- 接前台进程名(macOS proc_pidinfo) — OSC 7 fallback / 互补
- 多 tab 同名 cwd 时加 `#1 #2` 后缀
- Inline rename (双击 tab 编辑) → 写到 descriptor.short user override
