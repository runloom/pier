# Rich Input Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让按需增强输入支持任意文件的选择 / 粘贴 / 拖拽，以上轨 chip + 正文 `[#n]` 展示，并一次 `sendText` 把绝对路径与展开正文交给智能体。

**Architecture:** main 只做选文件、路径可读校验、无路径图片落临时盘；renderer 持有 per-panel 附件列表与正文草稿；纯函数负责 `[#n]` 展开/删除重编号与发送载荷组装；UI 为附件轨 + 回形针 + paste/drop，挂进现有 `TerminalComposer`。

**Tech Stack:** Electron 43 · React 19 · TypeScript strict · Vitest · 现有 `pier:terminal:send-text` IPC

**Spec:** `docs/superpowers/specs/2026-07-21-rich-input-attachments-design.md`（`ec687332`）

## Global Constraints

- 任意文件类型；本地文件用**原绝对路径**，不复制；仅无路径位图/图片字节写入 `os.tmpdir()/pier-terminal-pastes/`。
- 发送：**一次** `sendText({ text, submit: true })`，`text` 非空且 ≤ `64_000`（现网 `MAX_SEND_TEXT_LENGTH`）。
- 载荷：`paths.join("\n")`，若展开正文非空则再 `"\n" + expandedBody`。
- `[#n]` 词法：`/\[#(\d+)\]/g`；删除重编号从大到小；Backspace 只改文案不删附件。
- 同 path 去重；`resolve` 部分失败 → 成功子集仍添加 + 失败汇总提示。
- **重写**未合入草稿：不得保留仅图片 filter、选文件 copy、history/mode/model。
- 用户文案走 i18n；禁止「富文本」；产品名增强输入 / Rich Input。
- 代码标识可继续 `composer`；Git：按仓库协议 stage 明确路径，message 用 Conventional Commits；用户未要求时实现阶段可不 commit，计划中的 commit 步在执行时按用户确认执行。
- 文件体积：软顶 ~300、硬顶 500 行。

## File map

| 文件 | 职责 |
|---|---|
| `src/shared/contracts/terminal.ts` | 附件类型与 main API 结果类型 |
| `src/main/ipc/terminal-composer-attachments.ts` | pick / resolve / materialize（重写 untracked 草稿） |
| `src/main/ipc/terminal-input-ipc.ts` | 注册附件相关 `ipcMain.handle` |
| `src/preload/terminal-api.ts` + `TerminalAPI` | 暴露 `pickComposerFiles` 等 |
| `src/renderer/panel-kits/terminal/terminal-composer-attachments-model.ts` | 纯函数：token / buildSendText / 删除改写 |
| `src/renderer/panel-kits/terminal/use-terminal-composer-attachments.ts` | per-panel 附件 state、pick/paste/drop、与发送协作 |
| `src/renderer/panel-kits/terminal/terminal-composer-attachment-rail.tsx` | 附件轨 UI |
| `src/renderer/panel-kits/terminal/terminal-composer.tsx` | 接线：轨、回形针、paste/drop、发送改用 buildSendText |
| `src/renderer/i18n/locales/*/terminal.ts` | 文案 |
| 删除或覆盖 | untracked：`terminal-composer-controls.tsx`、`use-terminal-composer-controller.ts`（含 history/mode 的整文件不采用）；`tests/unit/main/terminal-composer-attachments.test.ts` 按新契约重写 |

---

### Task 1: 纯函数模型（token / 载荷 / 删除改写）

**Files:**
- Create: `src/renderer/panel-kits/terminal/terminal-composer-attachments-model.ts`
- Test: `tests/unit/renderer/terminal-composer-attachments-model.test.ts`

**Interfaces:**
- Produces:
  - `export type ComposerAttachment = { id: string; path: string; name: string; kind: "image" | "file" }`
  - `export const COMPOSER_ATT_TOKEN = /\[#(\d+)\]/g`
  - `export const MAX_COMPOSER_SEND_TEXT_LENGTH = 64_000`
  - `export function kindFromFileName(name: string): "image" | "file"`
  - `export function expandAttachmentTokens(draft: string, attachments: readonly ComposerAttachment[]): string`
  - `export function findInvalidAttachmentTokens(draft: string, attachmentCount: number): number[]` // 越界 n 列表，升序去重
  - `export function buildComposerSendText(attachments: readonly ComposerAttachment[], draft: string): string`
  - `export function removeAttachmentAndRewriteDraft(input: { attachments: ComposerAttachment[]; draft: string; removeId: string }): { attachments: ComposerAttachment[]; draft: string }`
  - `export function insertTokenAtCursor(draft: string, cursor: number, tokenIndex1Based: number): { draft: string; cursor: number }`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from "vitest";
import {
  buildComposerSendText,
  expandAttachmentTokens,
  findInvalidAttachmentTokens,
  insertTokenAtCursor,
  kindFromFileName,
  removeAttachmentAndRewriteDraft,
} from "@/panel-kits/terminal/terminal-composer-attachments-model.ts";

const a = (path: string, id = path): ComposerAttachment => ({
  id,
  kind: kindFromFileName(path),
  name: path.split("/").pop() ?? path,
  path,
});

describe("kindFromFileName", () => {
  it("maps image extensions", () => {
    expect(kindFromFileName("x.PNG")).toBe("image");
    expect(kindFromFileName("a.pdf")).toBe("file");
  });
});

describe("expandAttachmentTokens", () => {
  it("expands [#n] and leaves unknown intact for caller validation", () => {
    const atts = [a("/p/one.png", "1"), a("/p/two.pdf", "2")];
    expect(expandAttachmentTokens("见 [#1] 与 [#2]", atts)).toBe(
      "见 /p/one.png 与 /p/two.pdf"
    );
  });
});

describe("findInvalidAttachmentTokens", () => {
  it("reports out-of-range ordinals", () => {
    expect(findInvalidAttachmentTokens("x [#0] [#3]", 2)).toEqual([0, 3]);
    expect(findInvalidAttachmentTokens("ok [#1]", 1)).toEqual([]);
  });
});

describe("buildComposerSendText", () => {
  it("joins paths and expanded body", () => {
    const atts = [a("/a.png", "1"), a("/b.pdf", "2")];
    expect(buildComposerSendText(atts, "分析 [#1]")).toBe(
      "/a.png\n/b.pdf\n分析 /a.png"
    );
  });
  it("attachments only has no trailing empty body line", () => {
    expect(buildComposerSendText([a("/a.png", "1")], "  ")).toBe("/a.png");
  });
  it("body only", () => {
    expect(buildComposerSendText([], "hello")).toBe("hello");
  });
});

describe("removeAttachmentAndRewriteDraft", () => {
  it("renumbers without breaking [#10]", () => {
    const attachments = Array.from({ length: 10 }, (_, i) =>
      a(`/p/${i + 1}.bin`, String(i + 1))
    );
    const draft = "x [#1] y [#10] z [#2]";
    const next = removeAttachmentAndRewriteDraft({
      attachments,
      draft,
      removeId: "2",
    });
    expect(next.attachments).toHaveLength(9);
    // 原 #1 仍为 1；原 #10 → #9；原 #2 删除
    expect(next.draft).toMatch(/\[#1]/);
    expect(next.draft).toMatch(/\[#9]/);
    expect(next.draft).not.toMatch(/\[#10\]/);
    expect(next.draft).not.toMatch(/\[#2\]/);
  });
});

describe("insertTokenAtCursor", () => {
  it("inserts spaced [#n] at cursor", () => {
    const r = insertTokenAtCursor("分析图", 2, 1); // after 分析
    expect(r.draft).toContain("[#1]");
    expect(r.cursor).toBeGreaterThan(2);
  });
});
```

（测试文件顶部需 `import type { ComposerAttachment }` 或从同模块导出。）

- [ ] **Step 2: 跑测确认失败**

```bash
pnpm vitest run tests/unit/renderer/terminal-composer-attachments-model.test.ts
```

Expected: FAIL module not found

- [ ] **Step 3: 实现纯函数模块**

实现要点：
- `kindFromFileName`：`/\.(png|jpe?g|gif|webp|bmp|svg)$/i`
- `expandAttachmentTokens`：`replace` 回调，n 合法则 `attachments[n-1].path`，否则保留原 token（校验另做）
- `findInvalidAttachmentTokens`：扫全部 n，收集 `n < 1 || n > count`
- `buildComposerSendText`：paths + optional expanded trim 非空 body，`join("\n")`
- `removeAttachmentAndRewriteDraft`：找 index k；filter 数组；draft 用 match 列表从大 n 处理
- `insertTokenAtCursor`：在 cursor 处插入，若左侧非空白先加空格，token 后加空格（右侧已有空白则不再加）

- [ ] **Step 4: 跑测通过**

```bash
pnpm vitest run tests/unit/renderer/terminal-composer-attachments-model.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit（若用户允许 git 写）**

```bash
git add src/renderer/panel-kits/terminal/terminal-composer-attachments-model.ts \
  tests/unit/renderer/terminal-composer-attachments-model.test.ts
git commit -m "feat(terminal): add Rich Input attachment token model"
```

---

### Task 2: shared 契约 + main 附件 IPC + preload

**Files:**
- Modify: `src/shared/contracts/terminal.ts`（在 `TerminalSendTextArgs` 附近追加类型；`TerminalAPI` 追加方法）
- Create/Overwrite: `src/main/ipc/terminal-composer-attachments.ts`
- Modify: `src/main/ipc/terminal-input-ipc.ts`
- Modify: `src/preload/terminal-api.ts`
- Test: `tests/unit/main/terminal-composer-attachments.test.ts`（覆盖 untracked 旧测）

**Interfaces:**
- Produces (shared):

```ts
export interface TerminalComposerAttachmentDto {
  id: string;
  kind: "image" | "file";
  name: string;
  path: string;
}

export type TerminalComposerPathsResult = {
  attachments: TerminalComposerAttachmentDto[];
  failures: { path: string; reason: string }[];
};

export type TerminalComposerPickResult =
  | { ok: true; paths: string[] }
  | { ok: false; error: string };

export type TerminalComposerMaterializeResult =
  | { ok: true; attachment: TerminalComposerAttachmentDto | null } // null = 无图/取消
  | { ok: false; error: string };

export interface TerminalComposerImageBytes {
  bytes: number[]; // IPC 友好
  mime?: string;
  name?: string;
}
```

- `TerminalAPI` 增加：
  - `pickComposerFiles(): Promise<TerminalComposerPickResult>`
  - `resolveComposerPaths(paths: string[]): Promise<TerminalComposerPathsResult>`
  - `materializeComposerClipboardImage(): Promise<TerminalComposerMaterializeResult>`
  - `materializeComposerImageBytes(data: TerminalComposerImageBytes): Promise<TerminalComposerMaterializeResult>`

- IPC channels（与 preload 一致）:
  - `pier:terminal:composer-pick-files`
  - `pier:terminal:composer-resolve-paths`
  - `pier:terminal:composer-materialize-clipboard-image`
  - `pier:terminal:composer-materialize-image-bytes`

- [ ] **Step 1: 写 main 单测（失败）**

覆盖：
- 临时文件可读 → attachments 含 path/name/kind
- 目录 path → failures
- 不存在 → failures
- 混合：一成功一失败
- `materialize` 写入 `pier-terminal-pastes` 且文件存在
- pick 在测试中 mock `dialog.showOpenDialog` 取消 → `{ ok: true, paths: [] }`

用 `node:fs/promises` + `os.tmpdir()` 造夹具；mock `electron` 的 `dialog`/`clipboard` 与仓库其它 main 测一致（参考现有 electron mock 模式，如 `tests/unit/main/*.test.ts`）。

- [ ] **Step 2: 跑测 FAIL**

```bash
pnpm vitest run tests/unit/main/terminal-composer-attachments.test.ts
```

- [ ] **Step 3: 实现 main 模块**

`terminal-composer-attachments.ts` 关键：
- **不要** image-only filter；pick 用 `filters: [{ name: "All Files", extensions: ["*"] }]`（或 Electron 等价不限类型）
- **不要** `copyFile` 本地已有路径；resolve 只 `stat` + 返回原 path
- id：`crypto.randomUUID()`
- kind：与 renderer 相同扩展名规则（可在 main 内联同一 regex，或抽 `src/shared/composer-attachment-kind.ts` 供两端 import——若抽 shared，放 Task 2 并改 Task 1 从 shared 引用 kind 函数以免分叉）
- 位图：`clipboard.readImage()`，`isEmpty` 则 null；否则 PNG bytes 写盘
- bytes materialize：按 mime 选 ext，默认 png

`terminal-input-ipc.ts`：注册四个 handler，无需 window（纯 dialog/fs）；dialog 需要 `BrowserWindow.fromWebContents` 作 parent 时按现有 dialog 调用惯例。

preload：`terminal-api.ts` 四行 invoke。

- [ ] **Step 4: 跑测 PASS + typecheck 触及符号**

```bash
pnpm vitest run tests/unit/main/terminal-composer-attachments.test.ts
```

- [ ] **Step 5: Commit（若允许）**

```bash
git commit -m "feat(terminal): add composer attachment main IPC"
```

---

### Task 3: attachments hook（state / pick / paste / drop / 去重）

**Files:**
- Create: `src/renderer/panel-kits/terminal/use-terminal-composer-attachments.ts`
- Test: `tests/unit/renderer/use-terminal-composer-attachments.test.ts`（或纯逻辑测 + 轻组件测）
- Delete untracked if still present: `use-terminal-composer-controller.ts`、`terminal-composer-controls.tsx`（勿合并 history/mode）

**Interfaces:**
- Consumes: Task 1 model；Task 2 `window.pier.terminal.pickComposerFiles` 等
- Produces:

```ts
export function useTerminalComposerAttachments(input: {
  disabled: boolean;
  onDraftChange: (draft: string) => void;
  /** 当前正文与光标，插入 token 用 */
  getDraftAndCursor: () => { draft: string; cursor: number };
  panelId: string;
  reportError: (titleKey: string, detail: string) => void;
}): {
  attachments: ComposerAttachment[];
  canSendWithDraft: (draft: string) => boolean;
  clearAll: () => void; // 发送成功后调用；不暴露「清除全部」按钮
  onPaste: (event: React.ClipboardEvent) => void;
  onDrop: (event: React.DragEvent) => void;
  onDragOver: (event: React.DragEvent) => void;
  pickFiles: () => void;
  removeAttachment: (id: string) => void;
  /** 发送前：校验 token/64k；失败已 reportError 则返回 null */
  buildPayloadOrReport: (draft: string) => string | null;
  hydrateFromMaps: () => void; // mount 时从 module Map 恢复
}
```

Module-level: `attachmentsByPanel = new Map<string, ComposerAttachment[]>()`  
导出 `resetTerminalComposerAttachmentsForTests()`。

行为：
- `removeAttachment`：调 `removeAttachmentAndRewriteDraft`，写回 Map + `onDraftChange`
- `pickFiles`：await pick → resolve → merge
- merge：path 去重；append；对每个新附件 `insertTokenAtCursor` 链式更新 draft/cursor 经 `onDraftChange`（光标：hook 内可只更新 draft，cursor 由 textarea ref 在 composer 内设置——若简化，**v1 允许总是 append token 到 draft 末尾** 若取光标困难；规格偏好光标处。实现：composer 传 `textareaRef`，hook 读 `selectionStart`）
- paste：files 有 path → resolve；image 无 path → bytes materialize；text 若 preventDefault 了文件则手动插入 `clipboardData.getData("text/plain")`
- drop：同 paste 文件分支；`preventDefault` on dragOver/drop
- `buildPayloadOrReport`：invalid tokens / empty / >64k → `reportError` + null；否则 `buildComposerSendText`
- `canSendWithDraft`：`buildComposerSendText(...).length > 0`（不跑 invalid 也可先 true，真正发送再校验）

- [ ] **Step 1–4: TDD** 至少覆盖：去重、remove 改写 draft、buildPayload 越界/64k、clearAll

- [ ] **Step 5: Commit（若允许）**

```bash
git commit -m "feat(terminal): add composer attachments hook"
```

---

### Task 4: UI 附件轨 + 接入 TerminalComposer

**Files:**
- Create: `src/renderer/panel-kits/terminal/terminal-composer-attachment-rail.tsx`
- Modify: `src/renderer/panel-kits/terminal/terminal-composer.tsx`
- Modify: `src/renderer/i18n/locales/en/terminal.ts`、`zh-CN/terminal.ts`
- Test: `tests/unit/renderer/terminal-composer.test.tsx`（扩展）
- Modify lifecycle 若需要 mock 新 API

**i18n keys（`terminal.composer.*`）：**

| key | en | zh-CN |
|---|---|---|
| `attachFile` | Add file | 添加文件 |
| `removeAttachment` | Remove attachment | 移除附件 |
| `attachFailed` | Couldn’t add file | 无法添加文件 |
| `invalidAttachmentRef` | Invalid attachment reference | 存在无效的附件引用 |
| `sendTooLong` | Message is too long to send | 内容过长，无法发送 |
| `pathUnreadable` | Couldn’t read that file path | 无法读取该文件路径 |

- [ ] **Step 1: 附件轨组件**

```tsx
// TerminalComposerAttachmentRail({ attachments, disabled, onRemove })
// block-start chips: #n, icon, name truncate, X button aria-label=removeAttachment
```

- [ ] **Step 2: 改 TerminalComposer**

- 接 `useTerminalComposerAttachments`；`reportError` → `showAppAlert({ title: t(key), body: detail })`
- 根节点：`onDragOver` / `onDrop`
- textarea：`onPaste={attachments.onPaste}`（注意与默认文本插入协作）
- 有附件时 `InputGroupAddon align="block-start"` 渲染轨
- 回形针 `Paperclip` 按钮 → `pickFiles`（multiline 与单行布局都要有，靠近 send）
- `canSend`：`!disabled && attachments.canSendWithDraft(value)`
- `send()`：
  ```ts
  const payload = attachments.buildPayloadOrReport(value);
  if (payload == null) return;
  window.pier.terminal.sendText({ panelId, submit: true, text: payload })
    .then((result) => {
      if (result.ok || result.textDelivered) {
        drafts.delete(panelId);
        setValue("");
        attachments.clearAll();
        onCloseRef.current();
        if (!result.ok) reportSendFailure(...);
        return;
      }
      reportSendFailure(...);
    })
  ```
- 关闭（Esc/surface）时附件已在 Map，只需继续 `drafts.set` 正文；mount 时 `attachments` 从 Map 恢复（hook 内 `useState(() => attachmentsByPanel.get(panelId) ?? [])`）
- 保持 file-size ≤ 500；过线则把 send/paste 再抽到 hook

- [ ] **Step 3: 组件测试**

- mock `window.pier.terminal.pickComposerFiles` / `resolveComposerPaths` / `sendText`
- 添加附件后 send 调用一次且 text 含 path
- 仅附件可 send
- remove chip 更新 DOM

- [ ] **Step 4: 跑测**

```bash
pnpm vitest run \
  tests/unit/renderer/terminal-composer-attachments-model.test.ts \
  tests/unit/renderer/terminal-composer.test.tsx \
  tests/unit/main/terminal-composer-attachments.test.ts \
  tests/component/terminal-panel-lifecycle.test.tsx
```

- [ ] **Step 5: Commit（若允许）**

```bash
git commit -m "feat(terminal): wire Rich Input file attachments UI"
```

---

### Task 5: 回归与收尾

**Files:**
- `tests/e2e/agent-composer.spec.ts`（可选：不强制真文件；可只保证无附件路径仍绿）
- 清理：删除未使用 untracked 草稿或确保已被覆盖且无引用
- `pnpm exec biome check` 触及文件 / `bash scripts/check-file-size.sh`

- [ ] **Step 1: 全量相关测**

```bash
pnpm vitest run \
  tests/unit/renderer/terminal-composer-attachments-model.test.ts \
  tests/unit/renderer/terminal-composer.test.tsx \
  tests/unit/main/terminal-composer-attachments.test.ts \
  tests/unit/renderer/terminal-composer-mount.test.ts \
  tests/unit/renderer/terminal-composer-passthrough.test.ts \
  tests/component/terminal-panel-lifecycle.test.tsx \
  tests/component/workspace-host.test.tsx
```

Expected: all PASS

- [ ] **Step 2: e2e 冒烟（macOS）**

```bash
pnpm build && pnpm exec playwright test --config playwright.config.ts tests/e2e/agent-composer.spec.ts
```

- [ ] **Step 3: file-size / 残留扫描**

```bash
bash scripts/check-file-size.sh
rg -n "openModelPicker|switchMode|historyByPanel|IMAGE_FILTERS|copyFile" src/renderer/panel-kits/terminal src/main/ipc/terminal-composer-attachments.ts || true
```

不得留下 mode/model/history 与选文件 copy。

- [ ] **Step 4: Commit（若允许）**

```bash
git commit -m "test(terminal): cover Rich Input attachments regression"
```

---

## Spec coverage checklist

| Spec 节 | Task |
|---|---|
| §2 任意文件/原路径/64k/单次 send | 1–4 |
| §3 数据流 | 2–4 |
| §4 模型/kind/token | 1 |
| §5 UI/paste/drop/删除/草稿 | 3–4 |
| §6 发送序列化与结果 | 1, 4 |
| §7 main API | 2 |
| §8 按需集成 | 4–5 |
| §9 i18n | 4 |
| §10 测试 | 1–5 |
| 非目标 history/mode/model | 3 删除草稿 controller |

## Placeholder scan

无 TBD；类型名在 Task 1–2 钉死；后续 task 引用一致。

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-21-rich-input-attachments.md`.

**Two execution options:**

1. **Subagent-Driven（推荐）** — 每任务新子代理 + 任务间审查  
2. **Inline Execution** — 本会话按 executing-plans 连续做  

Which approach?
