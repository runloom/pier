# Files 源码编辑器右侧缩略图（Minimap）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `pier.files` 的 CodeMirror 源码编辑器右侧显示文档缩略图，并用插件设置开关控制（默认开）。

**Architecture:** 依赖 `@replit/codemirror-minimap` 的 `showMinimap` facet；`FileEditorViewSession` 用 `Compartment` 挂载/卸载扩展；`FileEditorController` 读 `context.configuration` 并订阅变更，把当前开关经 `FileEditorViewCoordinator.attach` 传入 session 构造，运行时用 `setMinimapEnabled` 热切换。设置声明走 files plugin `configuration`（与 autoSave 同模式）。

**Tech Stack:** CodeMirror 6、`@replit/codemirror-minimap@0.5.2`、`@codemirror/state` `Compartment`、TypeScript strict、Vitest 4、插件 configuration API。

**配套设计：** `docs/superpowers/specs/2026-07-17-files-editor-minimap-design.md`

## Global Constraints

- Key：`pier.files.editor.minimap`；常量 `FILES_EDITOR_MINIMAP_SETTING_KEY`；`type: "boolean"`；`default: true`；`order: 15`。
- 读取兜底：`get<boolean>(key) !== false`（未设置 / default → 开；仅显式 `false` 关）。
- 样式固定：`displayText: "blocks"`、`showOverlay: "always"`；无二级设置。
- 仅 source 模式 CodeMirror session；preview / image / Compare 不挂。
- 颜色只用语义 token / 现有 theme 的 `color-mix` 白名单路径；禁止业务硬编码 hex/rgb/hsl/oklch/Tailwind 色阶。
- 禁止 `@ts-ignore` / `@ts-expect-error` / `as any`。
- Git 默认只读：本计划若含 commit 步骤，执行前须用户确认；未确认则只改文件不提交。
- 单文件 ≤ 500 行（file-size 治理）。Controller 已 ~463 行，minimap 订阅逻辑可内联薄字段（预计 +20 行），不要为此再抽独立 controller 类。

---

## 文件结构

**新建**

- `src/plugins/builtin/files/renderer/files-editor-minimap.ts`：`createMinimapExtension(): Extension`
- `tests/unit/renderer/files-editor-minimap-settings.test.ts`：manifest + locale 契约

**修改**

- `package.json`（及 lockfile）：加 `@replit/codemirror-minimap`；若安装后缺 peer 再加 `@codemirror/lint`
- `src/plugins/builtin/files/settings.ts`：导出 key 常量
- `src/plugins/builtin/files/manifest.ts`：configuration 属性
- `src/plugins/builtin/files/locales/en.json` / `zh-CN.json`：settings 文案
- `src/plugins/builtin/files/renderer/file-editor-view-session.ts`：Compartment + 构造参数 + `setMinimapEnabled`
- `src/plugins/builtin/files/renderer/file-editor-view-coordinator.ts`：attach 透传 `minimapEnabled`
- `src/plugins/builtin/files/renderer/file-editor-controller.ts`：读配置、订阅、attach 传参、dispose 注销
- `src/plugins/builtin/files/renderer/code-mirror-editor-theme.ts`：minimap 主题补丁（按实际 DOM class）

---

### Task 1: 依赖 + 设置契约 + 文案 + 契约测试

**Files:**
- Modify: `package.json`（`pnpm add`）
- Modify: `src/plugins/builtin/files/settings.ts`
- Modify: `src/plugins/builtin/files/manifest.ts`（configuration.properties）
- Modify: `src/plugins/builtin/files/locales/en.json`
- Modify: `src/plugins/builtin/files/locales/zh-CN.json`
- Create: `tests/unit/renderer/files-editor-minimap-settings.test.ts`

**Interfaces:**
- Produces: `export const FILES_EDITOR_MINIMAP_SETTING_KEY = "pier.files.editor.minimap"`
- Manifest property:
  ```ts
  [FILES_EDITOR_MINIMAP_SETTING_KEY]: {
    default: true,
    description:
      "Show a minimap overview on the right side of the source editor.",
    order: 15,
    type: "boolean",
  }
  ```

- [ ] **Step 1: Write the failing contract test**

```ts
// tests/unit/renderer/files-editor-minimap-settings.test.ts
import { FILES_PLUGIN_LOCALES } from "@plugins/builtin/files/locales/index.ts";
import { FILES_PLUGIN_MANIFEST } from "@plugins/builtin/files/manifest.ts";
import { FILES_EDITOR_MINIMAP_SETTING_KEY } from "@plugins/builtin/files/settings.ts";
import { describe, expect, it } from "vitest";

describe("files editor minimap setting", () => {
  it("declares boolean minimap defaulting to on after autoSave", () => {
    const properties = FILES_PLUGIN_MANIFEST.configuration?.properties;
    expect(properties?.[FILES_EDITOR_MINIMAP_SETTING_KEY]).toMatchObject({
      default: true,
      order: 15,
      type: "boolean",
    });
  });

  it("provides complete English and Chinese setting labels", () => {
    for (const locale of ["en", "zh-CN"] as const) {
      const entry =
        FILES_PLUGIN_LOCALES[locale].settings?.[FILES_EDITOR_MINIMAP_SETTING_KEY];
      expect(entry?.label).toEqual(expect.any(String));
      expect(entry?.description).toEqual(expect.any(String));
      expect(entry?.label.length).toBeGreaterThan(0);
      expect(entry?.description.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/renderer/files-editor-minimap-settings.test.ts`

Expected: FAIL（`FILES_EDITOR_MINIMAP_SETTING_KEY` 不存在或 manifest 无属性）

- [ ] **Step 3: Install dependency**

```bash
pnpm add @replit/codemirror-minimap@0.5.2
```

若 `pnpm install` / 后续 import 报 peer 缺 `@codemirror/lint`：

```bash
pnpm add @codemirror/lint@^6.4.2
```

- [ ] **Step 4: Add setting key**

在 `src/plugins/builtin/files/settings.ts` 顶部常量区追加：

```ts
export const FILES_EDITOR_MINIMAP_SETTING_KEY = "pier.files.editor.minimap";
```

- [ ] **Step 5: Declare manifest property**

`manifest.ts`：

1. 从 `./settings.ts` 增加 import `FILES_EDITOR_MINIMAP_SETTING_KEY`。
2. 在 `configuration.properties` 里、`FILES_AUTO_SAVE_SETTING_KEY` 块之后插入 Task 头部 Interfaces 中的 property（order 15）。

- [ ] **Step 6: Add locales**

`en.json` → `settings`：

```json
"pier.files.editor.minimap": {
  "description": "Show a minimap overview on the right side of the source editor.",
  "label": "Minimap"
}
```

`zh-CN.json` → `settings`：

```json
"pier.files.editor.minimap": {
  "description": "在源码编辑器右侧显示文档缩略图。",
  "label": "缩略图"
}
```

- [ ] **Step 7: Run contract test**

Run: `pnpm exec vitest run tests/unit/renderer/files-editor-minimap-settings.test.ts`

Expected: PASS

- [ ] **Step 8: Commit（仅当用户确认 Git 提交时）**

```bash
git add package.json pnpm-lock.yaml \
  src/plugins/builtin/files/settings.ts \
  src/plugins/builtin/files/manifest.ts \
  src/plugins/builtin/files/locales/en.json \
  src/plugins/builtin/files/locales/zh-CN.json \
  tests/unit/renderer/files-editor-minimap-settings.test.ts
# 展示 git diff --staged 后等待用户确认 message：
# feat(files): declare editor minimap setting
```

---

### Task 2: Minimap 扩展工厂 + Session Compartment

**Files:**
- Create: `src/plugins/builtin/files/renderer/files-editor-minimap.ts`
- Modify: `src/plugins/builtin/files/renderer/file-editor-view-session.ts`
- Modify: `src/plugins/builtin/files/renderer/file-editor-view-coordinator.ts`

**Interfaces:**
- Consumes: `FILES_EDITOR_MINIMAP_SETTING_KEY`（本任务不直接读配置）
- Produces:
  - `createMinimapExtension(): Extension`
  - `FileEditorViewSession` 构造增加 `minimapEnabled: boolean`
  - `setMinimapEnabled(enabled: boolean): void`
  - `FileEditorViewCoordinator.attach` 增加 `minimapEnabled: boolean`，创建 session 时传入

- [ ] **Step 1: Create extension factory**

```ts
// src/plugins/builtin/files/renderer/files-editor-minimap.ts
import type { Extension } from "@codemirror/state";
import { showMinimap } from "@replit/codemirror-minimap";

export function createMinimapExtension(): Extension {
  return showMinimap.compute(["doc"], () => ({
    create: () => ({ dom: document.createElement("div") }),
    displayText: "blocks" as const,
    showOverlay: "always" as const,
  }));
}
```

- [ ] **Step 2: Wire session**

在 `file-editor-view-session.ts`：

1. import `createMinimapExtension`。
2. 字段：
   ```ts
   readonly #minimapCompartment = new Compartment();
   #minimapEnabled: boolean;
   ```
3. 构造：
   ```ts
   constructor(input: {
     documentId: string;
     editorSessionId: string;
     minimapEnabled: boolean;
     onChange: (documentId: string, contents: string) => void;
     presentation: FileEditorViewPresentation;
   }) {
     // ...existing assignments...
     this.#minimapEnabled = input.minimapEnabled;
   }
   ```
4. 方法：
   ```ts
   setMinimapEnabled(enabled: boolean): void {
     if (this.#minimapEnabled === enabled) {
       return;
     }
     this.#minimapEnabled = enabled;
     const view = this.#view;
     if (!view) {
       return;
     }
     view.dispatch({
       effects: this.#minimapCompartment.reconfigure(
         enabled ? createMinimapExtension() : []
       ),
     });
   }
   ```
5. `#extensions()` 数组加入（建议放在 `EDITOR_THEME` 附近）：
   ```ts
   this.#minimapCompartment.of(
     this.#minimapEnabled ? createMinimapExtension() : []
   ),
   ```

- [ ] **Step 3: Coordinator attach 透传**

`file-editor-view-coordinator.ts` 的 `attach`：

```ts
attach(input: {
  document: FilesDocument;
  editorSessionId: string;
  minimapEnabled: boolean;
  parent: HTMLElement;
  presentation: FileEditorViewPresentation;
}): void {
  // ... existing document-id mismatch dispose ...
  if (session) {
    session.updatePresentation(input.presentation);
    session.setMinimapEnabled(input.minimapEnabled);
  } else {
    session = new FileEditorViewSession({
      documentId: input.document.id,
      editorSessionId: input.editorSessionId,
      minimapEnabled: input.minimapEnabled,
      onChange: (documentId, contents) => {
        const latest = getDocument(documentId);
        if (latest && !latest.readOnly) {
          updateDocumentContents(latest.id, contents);
        }
      },
      presentation: input.presentation,
    });
    this.#sessions.set(input.editorSessionId, session);
  }
  session.mount(input.parent, input.document);
}
```

注意：复用已有 session 时也要 `setMinimapEnabled`，避免设置在 detach 前变更后状态漂移。

- [ ] **Step 4: Typecheck the touched modules**

Run: `pnpm exec tsc -p tsconfig.json --noEmit 2>&1 | rg "file-editor-view|files-editor-minimap" || true`

Expected: 仅剩 controller 未传 `minimapEnabled` 的错误（Task 3 修）；session/minimap 自身无错。  
（也可用全量 `pnpm typecheck`，过滤 files 相关错误。）

- [ ] **Step 5: Commit（用户确认后）**

```bash
git add src/plugins/builtin/files/renderer/files-editor-minimap.ts \
  src/plugins/builtin/files/renderer/file-editor-view-session.ts \
  src/plugins/builtin/files/renderer/file-editor-view-coordinator.ts
# feat(files): wire codemirror minimap compartment
```

---

### Task 3: Controller 读配置、订阅、attach 传参

**Files:**
- Modify: `src/plugins/builtin/files/renderer/file-editor-controller.ts`

**Interfaces:**
- Consumes: `FILES_EDITOR_MINIMAP_SETTING_KEY`、`FileEditorViewSession.setMinimapEnabled`、`attach({ minimapEnabled })`
- Produces: controller 生命周期内 minimap 开关与 configuration 同步

- [ ] **Step 1: Import + fields**

```ts
import { FILES_EDITOR_MINIMAP_SETTING_KEY } from "../settings.ts";
```

类字段（靠近其它 private 字段）：

```ts
#minimapConfigDispose: (() => void) | null = null;
#minimapEnabled: boolean;
```

- [ ] **Step 2: Constructor — read + subscribe**

在 `constructor` 末尾（`#saveCoordinator` 初始化之后）：

```ts
this.#minimapEnabled =
  context.configuration.get<boolean>(FILES_EDITOR_MINIMAP_SETTING_KEY) !==
  false;
this.#minimapConfigDispose = context.configuration.onDidChange((event) => {
  if (!event.affectsConfiguration(FILES_EDITOR_MINIMAP_SETTING_KEY)) {
    return;
  }
  const enabled =
    context.configuration.get<boolean>(FILES_EDITOR_MINIMAP_SETTING_KEY) !==
    false;
  this.#minimapEnabled = enabled;
  for (const session of this.#views.values()) {
    session.setMinimapEnabled(enabled);
  }
});
```

- [ ] **Step 3: attachView 传参**

```ts
this.#views.attach({
  document,
  editorSessionId: input.editorSessionId,
  minimapEnabled: this.#minimapEnabled,
  parent: input.parent,
  presentation: input.presentation,
});
```

- [ ] **Step 4: dispose 注销**

在 `dispose` 开头或 `#views.dispose()` 前：

```ts
this.#minimapConfigDispose?.();
this.#minimapConfigDispose = null;
```

- [ ] **Step 5: Fix unit harnesses that construct FileEditorViewSession / coordinator attach**

Search:

```bash
rg -n "new FileEditorViewSession|views\.attach\(|FileEditorViewCoordinator" tests src/plugins/builtin/files --glob '*.ts' --glob '*.tsx'
```

凡直接 `new FileEditorViewSession` 或调用 `attach({...})` 的测试 / 代码，补上 `minimapEnabled: true`（或按用例需要 `false`）。  
已知主路径是 controller → coordinator；优先修 `tests/unit/renderer/file-editor-controller.test.ts` 若 typecheck 失败。

- [ ] **Step 6: Run targeted tests**

```bash
pnpm exec vitest run \
  tests/unit/renderer/files-editor-minimap-settings.test.ts \
  tests/unit/renderer/file-editor-controller.test.ts
```

Expected: PASS（controller 测试不应因 minimap 订阅而破坏；`onDidChange` mock 已返回 dispose fn）

- [ ] **Step 7: Typecheck**

Run: `pnpm typecheck`

Expected: 无与 minimap / FileEditorViewSession 构造相关的错误。

- [ ] **Step 8: Commit（用户确认后）**

```bash
git add src/plugins/builtin/files/renderer/file-editor-controller.ts \
  tests  # 仅实际改动的 harness
# feat(files): sync minimap with plugin configuration
```

---

### Task 4: 主题补丁 + 人工 smoke

**Files:**
- Modify: `src/plugins/builtin/files/renderer/code-mirror-editor-theme.ts`（按需）

- [ ] **Step 1: Dev smoke 安装与导入**

确认：

```bash
node -e "require.resolve('@replit/codemirror-minimap')"
```

或 ESM 下在 `pnpm exec node --input-type=module -e "import '@replit/codemirror-minimap'"` 不抛错。

- [ ] **Step 2: 运行应用目视**

```bash
pnpm dev
```

验收清单：

1. 打开中等长度 `.ts` / `.tsx` source 文件 → 右侧有 minimap。
2. 设置 → Files 插件配置 → 「缩略图 / Minimap」默认开。
3. 关闭 → 已开 tab minimap 立即消失；再开立即出现。
4. Markdown preview / 图片预览无 minimap。
5. 深浅色切换后仍可读。
6. 控制台无 minimap 相关报错。

- [ ] **Step 3: Theme 微调（仅当默认样式与产品冲突时）**

在 `EDITOR_THEME` 中按 **实际 DOM class**（DevTools 确认，常见含 `cm-minimap`）追加，示例：

```ts
".cm-minimap": {
  borderLeft: "1px solid var(--border)",
  backgroundColor: "transparent",
},
".cm-minimap-overlay": {
  backgroundColor: "color-mix(in oklab, var(--foreground) 8%, transparent)",
},
```

无冲突则 **不改** theme（YAGNI）。

- [ ] **Step 4: 回归契约测试**

```bash
pnpm exec vitest run tests/unit/renderer/files-editor-minimap-settings.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit theme（若有改动且用户确认）**

```bash
git add src/plugins/builtin/files/renderer/code-mirror-editor-theme.ts
# style(files): theme minimap with semantic tokens
```

---

## Spec 覆盖自检

| Spec 要求 | Task |
|---|---|
| `pier.files.editor.minimap` default true order 15 | Task 1 |
| 中英文 label/description | Task 1 |
| `@replit/codemirror-minimap` + lint peer 按需 | Task 1 |
| `createMinimapExtension` blocks/always | Task 2 |
| Session Compartment + 构造必填 minimapEnabled | Task 2 |
| Coordinator 透传 / 复用 session 同步 | Task 2 |
| Controller 读配置、onDidChange、dispose | Task 3 |
| attach 使用当前开关 | Task 3 |
| 主题语义 token | Task 4 |
| 契约测试 | Task 1 |
| 人工验收 source-only / 热切换 | Task 4 |
| 非目标（git 色点、大文件阈值、characters 模式） | 不实现 |

**占位符扫描：** 无 TBD /「类似 Task N」悬空引用。  
**类型一致性：** `minimapEnabled: boolean`、`setMinimapEnabled(enabled: boolean)`、`createMinimapExtension(): Extension`、`FILES_EDITOR_MINIMAP_SETTING_KEY` 跨任务一致。

---

## 执行交接

Plan 已保存到 `docs/superpowers/plans/2026-07-17-files-editor-minimap.md`。

**两种执行方式：**

1. **Subagent-Driven（推荐）** — 每任务新开子代理，任务间 review  
2. **Inline Execution** — 本会话按 executing-plans 连续执行并设检查点  

选哪种？
