# 终端 open-url 优先 files 打开 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 终端网格点击本地路径时优先用 `pier.files` 打开；files 无法处理时回退 `shell.openPath`；远程 URL 由 main 直接 `shell.openExternal`，避免接线后「谁都不开」。

**Architecture:** 复用 pwd 同构链路：Ghostty `OPEN_URL` → Swift `TerminalSurfaceOpenURLDelegate` → native TSF → main。main 对远程 URL 直接 `openExternal`；对本地候选广播 `pier://terminal:open-url`。renderer host 分发给 files 插件；files 解析/锚点判断后开 panel 或 `file.openPath`。terminal kit 不 import files。

**Tech Stack:** GhosttyBridge Swift、Node-API ThreadSafeFunction、Electron `shell.openPath` / `shell.openExternal`、Vitest 4、既有 files `panels.openInstance` / `openProjectFiles`。

**配套设计：** `docs/superpowers/specs/2026-07-17-terminal-open-url-files-design.md`

## Global Constraints

- terminal panel-kit **禁止** import `@plugins/builtin/files`。
- `file-service.ts` 已近 hard cap 500：`openPath` 实现放独立小模块再接入。
- `host-context.ts` / `files/renderer/index.tsx` 已偏大：新逻辑放专用模块，activate 只接线。
- 用户可见文案走 files i18n（en + zh-CN）；成功不 toast。
- 禁止 `@ts-ignore` / `@ts-expect-error` / `as any`。
- 默认不自动 commit；步骤含 commit 时先征得用户确认。
- 相对路径只相对该终端 OSC 7 cwd；无 cwd 不猜。
- 锚点外本地路径不进 files，直接系统打开。

---

## 文件结构

**新建**

- `src/main/services/file-open-path.ts` — `openPathViaElectronShell` + 纯校验
- `src/main/ipc/terminal-open-url-forwarding.ts` — 远程/本地分流 + 广播
- `src/plugins/builtin/files/renderer/files-terminal-open-url-resolve.ts` — URL/路径纯解析
- `src/plugins/builtin/files/renderer/files-terminal-open-url-anchors.ts` — 锚点集合 / 最长覆盖根
- `src/plugins/builtin/files/renderer/files-terminal-open-url-handler.ts` — 订阅处理：stat / open / fallback
- `src/renderer/lib/plugins/terminal-open-url-host.ts` — host：handlers + 无订阅者本地兜底
- `tests/unit/main/file-open-path.test.ts`
- `tests/unit/main/terminal-open-url-forwarding.test.ts`
- `tests/unit/renderer/files-terminal-open-url-resolve.test.ts`
- `tests/unit/renderer/files-terminal-open-url-anchors.test.ts`
- `tests/unit/renderer/files-terminal-open-url-handler.test.ts`
- `tests/unit/renderer/terminal-open-url-host.test.ts`

**修改**

- `native/Sources/GhosttyBridge/GhosttyBridge.swift` — OpenURL delegate + C ABI
- `native/src/addon.mm` — TSF `setOpenUrlForwardCallback`
- `src/main/ipc/terminal-native-addon.ts` — 类型声明
- `src/main/ipc/terminal.ts` — 注册 callback
- `src/shared/ipc-channels.ts` — `TERMINAL_OPEN_URL`
- `src/shared/contracts/terminal.ts` — `TerminalOpenUrlEvent` + `onOpenUrl`
- `src/shared/contracts/file.ts` / `file-commands.ts` — `file.openPath` schema
- `src/main/app-core/file-commands.ts` / `permissions.ts` — 命令路由
- `src/main/services/file-service.ts` — 挂 `openPath`（薄封装）
- `src/preload/terminal-api.ts` / `file-api.ts`
- `src/plugins/api/renderer.ts` / `renderer-facades.ts`
- `src/renderer/lib/plugins/host-terminal-context.ts` / `host-files-context.ts`
- `src/plugins/builtin/files/locales/en.json` / `zh-CN.json`
- `src/plugins/builtin/files/renderer/index.tsx` — activate 注册 handler

**任务顺序**

1. 契约 + `file.openPath`（可独立测）
2. files 纯解析 / 锚点（可独立测）
3. native → main → preload 事件链
4. plugin API + host 分发 + files handler
5. 治理 / 手动验收

---

### Task 1: `file.openPath` 契约与 file-service

**Files:**
- Create: `src/main/services/file-open-path.ts`
- Modify: `src/shared/contracts/file.ts`
- Modify: `src/shared/contracts/file-commands.ts`
- Modify: `src/main/app-core/permissions.ts`
- Modify: `src/main/app-core/file-commands.ts`
- Modify: `src/main/services/file-service.ts`（仅增加方法委托，避免涨爆）
- Modify: `src/preload/file-api.ts`
- Modify: `src/plugins/api/renderer-facades.ts`
- Modify: `src/renderer/lib/plugins/host-files-context.ts`
- Test: `tests/unit/main/file-open-path.test.ts`

**Interfaces:**
- Produces:
  - `fileOpenPathRequestSchema` → `{ path: string }`（绝对路径）
  - `FileOpenPathResult = { opened: true } | { opened: false; reason: "invalid-path" | "open-failed" }`
  - `FileService.openPath(request): Promise<FileOpenPathResult>`
  - command type `"file.openPath"`，capability `file:read`
  - `context.files.openPath({ path })`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/main/file-open-path.test.ts
import { describe, expect, it, vi } from "vitest";
import {
  isAbsoluteOpenPath,
  openPathWithOpener,
} from "../../../src/main/services/file-open-path.ts";

describe("isAbsoluteOpenPath", () => {
  it("accepts posix and windows absolute paths", () => {
    expect(isAbsoluteOpenPath("/Users/x/file.md")).toBe(true);
    expect(isAbsoluteOpenPath("C:\\\\Users\\\\x\\\\file.md")).toBe(true);
  });

  it("rejects relative and empty", () => {
    expect(isAbsoluteOpenPath("docs/a.md")).toBe(false);
    expect(isAbsoluteOpenPath("")).toBe(false);
    expect(isAbsoluteOpenPath("  ")).toBe(false);
  });
});

describe("openPathWithOpener", () => {
  it("returns invalid-path for relative input without calling opener", async () => {
    const openPath = vi.fn(async () => "");
    await expect(
      openPathWithOpener("docs/a.md", openPath)
    ).resolves.toEqual({ opened: false, reason: "invalid-path" });
    expect(openPath).not.toHaveBeenCalled();
  });

  it("maps empty electron error string to opened:true", async () => {
    const openPath = vi.fn(async () => "");
    await expect(
      openPathWithOpener("/tmp/a.md", openPath)
    ).resolves.toEqual({ opened: true });
  });

  it("maps non-empty electron error string to open-failed", async () => {
    const openPath = vi.fn(async () => "Failed to open");
    await expect(
      openPathWithOpener("/tmp/a.md", openPath)
    ).resolves.toEqual({ opened: false, reason: "open-failed" });
  });

  it("maps thrown errors to open-failed", async () => {
    const openPath = vi.fn(async () => {
      throw new Error("boom");
    });
    await expect(
      openPathWithOpener("/tmp/a.md", openPath)
    ).resolves.toEqual({ opened: false, reason: "open-failed" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/main/file-open-path.test.ts`  
Expected: FAIL — module / exports missing

- [ ] **Step 3: Implement helper + wire command stack**

`src/main/services/file-open-path.ts`:

```ts
import { isAbsolute } from "node:path";

export type FileOpenPathResult =
  | { opened: true }
  | { opened: false; reason: "invalid-path" | "open-failed" };

export function isAbsoluteOpenPath(path: string): boolean {
  const trimmed = path.trim();
  return trimmed.length > 0 && isAbsolute(trimmed);
}

export async function openPathWithOpener(
  path: string,
  openPath: (absolutePath: string) => Promise<string>
): Promise<FileOpenPathResult> {
  if (!isAbsoluteOpenPath(path)) {
    return { opened: false, reason: "invalid-path" };
  }
  try {
    const errorMessage = await openPath(path.trim());
    if (errorMessage) {
      return { opened: false, reason: "open-failed" };
    }
    return { opened: true };
  } catch {
    return { opened: false, reason: "open-failed" };
  }
}

export async function openPathViaElectronShell(
  path: string
): Promise<FileOpenPathResult> {
  const { shell } = await import("electron");
  return openPathWithOpener(path, (absolutePath) =>
    shell.openPath(absolutePath)
  );
}
```

在 `file.ts` 增加 `fileOpenPathRequestSchema` / `fileOpenPathResultSchema`。  
`file-commands.ts` 增加 `file.openPath`；`permissions.ts`：`"file.openPath": { capabilities: ["file:read"] }`。  
`FileService` 增加 `openPath`，`createFileService` 委托 `options.openPathItem ?? openPathViaElectronShell`。  
preload / facade / `host-files-context` 透传并 assert `file:read`。

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run tests/unit/main/file-open-path.test.ts tests/unit/main/file-service.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit（需用户确认）**

```bash
git add src/main/services/file-open-path.ts src/shared/contracts/file.ts src/shared/contracts/file-commands.ts src/main/app-core/permissions.ts src/main/app-core/file-commands.ts src/main/services/file-service.ts src/preload/file-api.ts src/plugins/api/renderer-facades.ts src/renderer/lib/plugins/host-files-context.ts tests/unit/main/file-open-path.test.ts
git commit -m "$(cat <<'EOF'
feat(files): add shell.openPath fallback API

EOF
)"
```

---

### Task 2: 终端 open-url 路径纯解析

**Files:**
- Create: `src/plugins/builtin/files/renderer/files-terminal-open-url-resolve.ts`
- Test: `tests/unit/renderer/files-terminal-open-url-resolve.test.ts`

**Interfaces:**
- Produces:
  - `ParsedTerminalOpenUrl = { kind: "remote"; url } | { kind: "local-path"; path } | { kind: "unresolved"; reason: "relative-without-cwd" | "invalid" }`
  - `parseTerminalOpenUrl(raw: string, cwd: string | null): ParsedTerminalOpenUrl`

- [ ] **Step 1: Write the failing test**

覆盖：https/mailto → remote；`file:///Users/x/My%20Docs/a.md` → 解码本地路径；绝对路径保留；相对路径相对 cwd；无 cwd 相对路径 → `relative-without-cwd`；空串 → invalid。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/renderer/files-terminal-open-url-resolve.test.ts`  
Expected: FAIL

- [ ] **Step 3: Implement `parseTerminalOpenUrl`**

规则：
1. trim；空 → invalid
2. 非 `file:` 的 `scheme:` → remote
3. `file:` → URL 解码为本地绝对路径（处理 Windows `/C:/`）
4. `path.isAbsolute` → local-path
5. 否则需绝对 cwd，`path.resolve(cwd, raw)`；否则 `relative-without-cwd`

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/renderer/files-terminal-open-url-resolve.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit（需用户确认）**

```bash
git add src/plugins/builtin/files/renderer/files-terminal-open-url-resolve.ts tests/unit/renderer/files-terminal-open-url-resolve.test.ts
git commit -m "$(cat <<'EOF'
feat(files): parse terminal open-url local and remote targets

EOF
)"
```

---

### Task 3: 锚点集合与最长覆盖根

**Files:**
- Create: `src/plugins/builtin/files/renderer/files-terminal-open-url-anchors.ts`
- Test: `tests/unit/renderer/files-terminal-open-url-anchors.test.ts`

**Interfaces:**
- Consumes: `isSamePathOrDescendant` from `files-document-paths.ts`
- Produces:
  - `terminalOpenUrlAnchors(context): string[]` — 非空的 projectRootPath / worktreeRoot / gitRoot / cwd / openedPath
  - `longestCoveringAnchor(path, anchors): string | null` — 覆盖 path 的最长锚点

- [ ] **Step 1: Write the failing test**（收集锚点；最长前缀；锚点外 null）

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/renderer/files-terminal-open-url-anchors.test.ts`  
Expected: FAIL

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run test to verify it passes**

Expected: PASS

- [ ] **Step 5: Commit（需用户确认）**

```bash
git add src/plugins/builtin/files/renderer/files-terminal-open-url-anchors.ts tests/unit/renderer/files-terminal-open-url-anchors.test.ts
git commit -m "$(cat <<'EOF'
feat(files): resolve longest terminal open-url anchor root

EOF
)"
```

---

### Task 4: Shared terminal open-url 事件契约 + preload

**Files:**
- Modify: `src/shared/contracts/terminal.ts`
- Modify: `src/shared/ipc-channels.ts`
- Modify: `src/preload/terminal-api.ts`

**Interfaces:**
- Produces:
  - `TerminalOpenUrlKind = "text" | "html" | "unknown"`
  - `TerminalOpenUrlEvent = { panelId; url; kind }`
  - `terminalOpenUrlEventSchema`
  - `PIER_BROADCAST.TERMINAL_OPEN_URL = "pier://terminal:open-url"`
  - `TerminalAPI.onOpenUrl(cb): () => void`

- [ ] **Step 1: Add contracts + preload `subscribeIpc`**

`ALLOWED_RENDERER_CHANNELS` 已展开 `Object.values(PIER_BROADCAST)`，只需加 broadcast 常量。

- [ ] **Step 2: typecheck**（补齐测试里 TerminalAPI mock 的 `onOpenUrl`）

Run: `pnpm typecheck`  
Expected: 0 errors

- [ ] **Step 3: Commit（需用户确认）**

```bash
git add src/shared/contracts/terminal.ts src/shared/ipc-channels.ts src/preload/terminal-api.ts
git commit -m "$(cat <<'EOF'
feat(terminal): add open-url event contract and preload subscription

EOF
)"
```

---

### Task 5: main 远程/本地分流转发

**Files:**
- Create: `src/main/ipc/terminal-open-url-forwarding.ts`
- Modify: `src/main/ipc/terminal-native-addon.ts`
- Modify: `src/main/ipc/terminal.ts`
- Test: `tests/unit/main/terminal-open-url-forwarding.test.ts`

**Interfaces:**
- Produces:
  - `classifyTerminalOpenUrlForMain(url): "remote" | "local-candidate"`
  - `handleTerminalOpenUrl({ windowId, panelId, url, kind, openExternal, broadcast })`
  - `NativeAddon.setOpenUrlForwardCallback`

**设计细化（相对 spec §5.2）：** 远程 URL 在 **main** 调 `shell.openExternal`，不走 renderer `externalNavigation`（仅 https + 1s nonce，不适合 mailto/http 与异步链路）。本地候选才广播。

- [ ] **Step 1: Write the failing test**

远程 → openExternal 且不 broadcast；本地候选 → broadcast 且不 openExternal；classify 覆盖 http(s)/mailto/file/绝对/相对。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/main/terminal-open-url-forwarding.test.ts`  
Expected: FAIL

- [ ] **Step 3: Implement + 在 `terminal.ts` 注册 callback**

```ts
addon?.setOpenUrlForwardCallback((id, panelId, url, kind) => {
  const rawPanelId = fromNativePanelKey(panelId);
  recordNativeTerminalRoute(id, "open-url", panelId, { kind, url });
  handleTerminalOpenUrl({
    windowId: id,
    panelId: rawPanelId,
    url,
    kind: kind === "html" || kind === "text" ? kind : "unknown",
    openExternal: async (target) => {
      const { shell } = await import("electron");
      await shell.openExternal(target);
    },
    broadcast: (event) => {
      forwardToWindow(
        id,
        PIER_BROADCAST.TERMINAL_OPEN_URL,
        event,
        "pier-open-url-forward"
      );
    },
  }).catch((err) => console.error("[pier-open-url] failed:", err));
});
```

- [ ] **Step 4: Run tests** — Expected: PASS

- [ ] **Step 5: Commit（需用户确认）**

```bash
git add src/main/ipc/terminal-open-url-forwarding.ts src/main/ipc/terminal-native-addon.ts src/main/ipc/terminal.ts tests/unit/main/terminal-open-url-forwarding.test.ts
git commit -m "$(cat <<'EOF'
feat(terminal): forward local open-url events and open remotes in main

EOF
)"
```

---

### Task 6: Native Swift + addon open_url 通道

**Files:**
- Modify: `native/Sources/GhosttyBridge/GhosttyBridge.swift`
- Modify: `native/src/addon.mm`

**Interfaces:**
- Produces: Swift `TerminalSurfaceOpenURLDelegate` + `ghostty_bridge_set_open_url_forward_callback`；addon `setOpenUrlForwardCallback`

- [ ] **Step 1: Extend `TerminalEventDelegate`**

conform `TerminalSurfaceOpenURLDelegate`；`forwardOpenUrlCallback: ((Int, String, String, String) -> Void)?`；`terminalDidRequestOpenURL` 映射 kind → `"text"|"html"|"unknown"`。

- [ ] **Step 2: C ABI + addon.mm TSF**

与 pwd 同构：`OpenUrlForwardPayload { windowId, panelId, url, kind }` + export。

- [ ] **Step 3: Rebuild native**

Run: `pnpm native:build`（或仓库等价脚本）  
Expected: 成功

- [ ] **Step 4: Commit（需用户确认）**

```bash
git add native/Sources/GhosttyBridge/GhosttyBridge.swift native/src/addon.mm
git commit -m "$(cat <<'EOF'
feat(native): forward Ghostty open_url actions to main

EOF
)"
```

---

### Task 7: Plugin terminal API — `onOpenUrl` + `getPanelContext`

**Files:**
- Modify: `src/plugins/api/renderer.ts`
- Modify: `src/renderer/lib/plugins/host-terminal-context.ts`
- Optional extract: `src/renderer/lib/workspace/terminal-panel-snapshots.ts`（供 quickpick 与 host 共用）

**Interfaces:**
- Produces:

```ts
interface RendererPluginTerminalContext {
  activePanelId(): string | null;
  getPanelContext(panelId: string): PanelContext | null;
  onOpenUrl(cb: (event: TerminalOpenUrlEvent) => void): () => void;
  readSelectionText(panelId?: string): Promise<TerminalSelectionTextResult>;
}
```

- [ ] **Step 1: Implement**

`getPanelContext`：`terminal:read` 后从 workspace terminal panel 快照取 `context`。  
`onOpenUrl`：assert 后 `window.pier.terminal.onOpenUrl(cb)`。

- [ ] **Step 2: typecheck** — Expected: 0 errors

- [ ] **Step 3: Commit（需用户确认）**

```bash
git add src/plugins/api/renderer.ts src/renderer/lib/plugins/host-terminal-context.ts src/renderer/lib/workspace/terminal-panel-snapshots.ts
git commit -m "$(cat <<'EOF'
feat(plugins): expose terminal onOpenUrl and getPanelContext

EOF
)"
```

---

### Task 8: files open-url handler + locales

**Files:**
- Create: `src/plugins/builtin/files/renderer/files-terminal-open-url-handler.ts`
- Modify: `src/plugins/builtin/files/locales/en.json`
- Modify: `src/plugins/builtin/files/locales/zh-CN.json`
- Modify: `src/plugins/builtin/files/renderer/index.tsx`
- Test: `tests/unit/renderer/files-terminal-open-url-handler.test.ts`

**Interfaces:**
- Produces: `registerFilesTerminalOpenUrlHandler(context): () => void`
- handler `Promise<boolean>`：`true` = 已处理（host 勿再兜底）

**规则：**
1. remote → `false`（main 已处理）
2. unresolved → toast，`true`
3. 无覆盖锚点 → `files.openPath`，`true`
4. 有锚点 → `stat({ root: anchor, path: relative })`
5. 目录 → `openProjectFiles` + `revealFilesTreePath`；失败 → openPath
6. 文件 → 若 binary/too-large 则 openPath；否则 `openInstance` disk source；抛错 → openPath
7. 同一规范化 path inflight 去重

locales keys：
- `files.notifications.terminalOpenUrl.relativeWithoutCwd`
- `files.notifications.terminalOpenUrl.invalid`
- `files.notifications.terminalOpenUrl.openFailed`

- [ ] **Step 1: Write failing handler tests**（mock stat/openPath/openInstance/reveal）

- [ ] **Step 2: Implement + `index.tsx` activate 注册**（逻辑不写进 index 本体）

- [ ] **Step 3: Run tests**

Run: `pnpm vitest run tests/unit/renderer/files-terminal-open-url-handler.test.ts tests/unit/renderer/files-terminal-open-url-resolve.test.ts tests/unit/renderer/files-terminal-open-url-anchors.test.ts`  
Expected: PASS

- [ ] **Step 4: Commit（需用户确认）**

```bash
git add src/plugins/builtin/files/renderer/files-terminal-open-url-handler.ts src/plugins/builtin/files/renderer/index.tsx src/plugins/builtin/files/locales/en.json src/plugins/builtin/files/locales/zh-CN.json tests/unit/renderer/files-terminal-open-url-handler.test.ts
git commit -m "$(cat <<'EOF'
feat(files): open terminal local paths in the files plugin

EOF
)"
```

---

### Task 9: Host 无 files 订阅者时的本地兜底

**Files:**
- Create: `src/renderer/lib/plugins/terminal-open-url-host.ts`
- Modify: `src/renderer/lib/plugins/runtime.ts`（或既有 bootstrap）注册一次
- Test: `tests/unit/renderer/terminal-open-url-host.test.ts`

**Interfaces:**
- Produces:
  - `addTerminalOpenUrlHandler(handler): () => void`
  - `installTerminalOpenUrlHost(): () => void`
- 流程：handlers 任一 `true` → stop；全 `false` 且绝对 local-path → `window.pier.files.openPath`；remote 忽略

- [ ] **Step 1: Failing tests** — handler 消费后不兜底；无 handler 绝对路径兜底；remote 不 openPath

- [ ] **Step 2: Implement + wire**；files `register*` 内部调用 `addTerminalOpenUrlHandler`

- [ ] **Step 3: Run tests** — Expected: PASS

- [ ] **Step 4: Commit（需用户确认）**

```bash
git add src/renderer/lib/plugins/terminal-open-url-host.ts src/renderer/lib/plugins/runtime.ts src/plugins/builtin/files/renderer/files-terminal-open-url-handler.ts tests/unit/renderer/terminal-open-url-host.test.ts
git commit -m "$(cat <<'EOF'
feat(plugins): fall back terminal local open-url to system openPath

EOF
)"
```

---

### Task 10: 治理、回归与手动验收

- [ ] **Step 1: 单元回归**

```bash
pnpm vitest run \
  tests/unit/main/file-open-path.test.ts \
  tests/unit/main/terminal-open-url-forwarding.test.ts \
  tests/unit/renderer/files-terminal-open-url-resolve.test.ts \
  tests/unit/renderer/files-terminal-open-url-anchors.test.ts \
  tests/unit/renderer/files-terminal-open-url-handler.test.ts \
  tests/unit/renderer/terminal-open-url-host.test.ts \
  tests/unit/renderer/files-terminal-action.test.tsx
```

Expected: PASS

- [ ] **Step 2: depcruise / 边界**

Run: `pnpm depcruise`（或仓库既定脚本）  
Expected: `panel-kits/terminal` 不依赖 `plugins/builtin/files`

- [ ] **Step 3: 手动验收（`pnpm dev`）**

| # | 操作 | 期望 |
|---|---|---|
| 1 | 点击项目内 `README.md` | files panel 打开 |
| 2 | 点击项目内目录 | files 树 reveal |
| 3 | 点击 `.zip` | 系统默认 App |
| 4 | 点击项目外绝对路径 | 系统打开，无锚点错误 panel |
| 5 | 点击 `https://example.com` | 浏览器（main openExternal） |
| 6 | 无 OSC 7 时点相对路径 | toast，不误开 |
| 7 | 确认不双开 files+外部编辑器 | 仅一路 |

- [ ] **Step 4: 可选更新 design 状态为 implemented；最终 commit 需用户确认**

---

## Spec 覆盖自检

| Spec 要求 | Task |
|---|---|
| 本地文件优先 files | 8 |
| binary/失败 → shell.openPath | 1 + 8 |
| 目录 reveal / 失败系统 | 8 |
| 相对路径用 OSC 7 cwd | 2 + 7/8 |
| 无 cwd 不猜 | 2 + 8 |
| file:// 解码 | 2 |
| 远程不进 files | 5 + 8 |
| terminal 不 import files | 8/9/10 |
| 无 files 订阅者兜底 | 9 |
| open_url native 接线 | 6 |
| inflight 去重 | 8 |
| i18n 错误文案 | 8 |
| 锚点外系统打开 | 3 + 8 |
| 最长锚点作 root | 3 + 8 |

**占位符扫描：** 无 TBD。远程改为 main `openExternal` 已在 Task 5 写明。  
**类型一致性：** `TerminalOpenUrlEvent.kind` / `FileOpenPathResult.reason` / handler `Promise<boolean>` 全链路统一。
