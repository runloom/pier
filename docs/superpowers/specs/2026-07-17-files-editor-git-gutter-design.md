# Files 编辑器 Git 变更条（Gutter）

**日期**：2026-07-17  
**范围**：`pier.files` 源码编辑器在行号旁显示相对 HEAD 的磁盘变更条  
**关联文档**：

- [2026-07-02-project-file-tree-design.md](2026-07-02-project-file-tree-design.md)（Files 树与项目锚点）
- [2026-07-14-git-diff-review-polish-design.md](2026-07-14-git-diff-review-polish-design.md)（Git 插件完整 diff / review，职责不抢）
- 现有实现：`files-tree-git-decorations.ts`（目录树状态色）、`file-editor-view-session.ts`（CodeMirror 会话）

## 1. 背景与问题

目录树已通过 `git.getStatus` / `git.watch` 对变更路径着色（`files-tree-git-decorations.ts` + `file-tree-sidebar.tsx`）。

打开同一变更文件时，CodeMirror 源码编辑器只有语法高亮与行号，**没有行级 git 装饰**。用户能在树上看到「这个文件改了」，却无法在编辑器里看到「改了哪几行」。

已有能力：

- 插件 facade：`context.git.getDiffPatch(cwd, { from, path, … })`、`getFileContent`、`watch`
- 编辑器：CodeMirror 6，扩展经 `FileEditorViewSession` + `Compartment` 装配
- `FilesLineDiff` 仅用于保存冲突 Compare，不是编辑中 gutter

目标是补上 VS Code 风格的编辑器变更条，且与「磁盘相对 HEAD」语义对齐。

## 2. 目标 / 非目标

### 目标

1. 磁盘路径、source 模式下的源码编辑器，在行号旁显示相对 **HEAD** 的变更条。
   删除行红条在 gutter 里向上覆盖被删区间（按删除行数撑高），不再压缩为单条。
2. 基准为**磁盘文件**相对 HEAD（等价 `git diff HEAD -- path`，含已 stage + 未 stage）；**不**纳入未保存缓冲。
3. 三种标记：新增 / 修改 / 删除（删除带行数、向上覆盖）；颜色走产品语义 token。
4. 打开文档、保存成功写盘、git watch 相关更新时刷新；失败静默降级为空 gutter。
5. 纯函数映射可单测；不新增 IPC / capability。

### 非目标

- 未保存缓冲 vs HEAD 的实时 gutter（后续可选）
- staged / unstaged 分色或双层条
- 点击 gutter 展开删行内容、hover 预览、跳转 Git Changes
- 完整 inline / side-by-side diff 视图（归 Git 插件 review）
- 设置项开关（本轮默认开启；无 prefs）
- 目录树装饰改动、Markdown preview / rich / 冲突 Compare 模式

## 3. 产品决策（已确认）

| 决策点 | 选择 | 原因 |
|---|---|---|
| 形态 | Gutter 竖条 | 编辑时可用、噪音低 |
| 对比基准 | HEAD 工作区 diff | 「相对最后提交改了啥」 |
| 缓冲 | 始终比磁盘 | 与 `git status` 一致；避免每键重算 |
| 数据 | `getDiffPatch` | 复用现成解析与 IPC |

## 4. 设计

### 4.1 数据流

```
触发：attach view / 保存成功 / git.watch 命中该 path（或全量 status 刷新）
  → 解析 gitRoot + 相对 path（仅 disk source）
  → context.git.getDiffPatch(gitRoot, { from: "HEAD", path })
  → 取对应 GitDiffFilePatch（或空）
  → hunks → Map<lineNumber(1-based), "added" | "modified" | "deleted">
  → FileEditorViewSession 经 Compartment 重配 git gutter 扩展
```

边界：

| 条件 | 行为 |
|---|---|
| untitled / 非 disk | 不请求、无 gutter |
| 无 gitRoot / 非 git 仓库 | 空 gutter |
| binary / 空 patch / 路径不在 diff | 空 gutter |
| IPC 失败 / 超时 | 静默清空（不 toast） |
| 超大 patch（host 既有上限） | 空 gutter；不本地 LCS 兜底 |
| 编辑缓冲 dirty | **不**因此重算 |

已知取舍：dirty 时编辑器缓冲行号可能相对磁盘偏移，gutter 仍按**上次磁盘 diff** 的行号绘制，可能与当前缓冲视觉错位，直到保存后刷新。这是「只比磁盘」的预期行为，不是 bug。

### 4.2 Hunk → 行标记规则

输入：`GitDiffFilePatch.hunks`（unified diff 语义：`add` / `del` / `context`）。
输出：当前**磁盘新文件**侧 1-based 行号 → `{ kind, count }`。同一行多规则时优先级：`modified` > `added` > `deleted`。

终态算法（对齐 VS Code SCM **line range mapping** + 行内容 LCS；实现与单测锁定）：

1. 按 hunk 遍历，维护 `newLine` 游标（对齐 hunk header 的 `newStart`）。
2. `context`：new 行号 +1，不标记。
3. **纯 add 块**（前面无配对 del）：每行 `added`，count=1。
4. **纯 del 块**（后面无配对 add）：`deleted` 锚在**删除块结束后的下一 new 行**（删除发生在该行上方），`count = pureDel`；渲染时红条按 count 向上覆盖。若删除直达文末：锚在最后出现过的 new 行；整 hunk 无 new 侧行：锚在 `hunk.newStart`。锚行已有更高优先级标记时，删除标记不覆盖。
5. **替换 range**（连续 del 后紧随连续 add，且两侧均非空）—— VS Code 语义：
   - 对 del/add 行文本做 LCS；LCS 命中的**相等行不标记**；
   - 其余每一 new 行标 `modified`（count=1），**即使 new 比 old 更长也不再拆成 green remainder**；
   - **禁止**在存活邻行上画 `deleted`（缩减替换不得污染下一行 context/new）。
6. 多 hunk 独立应用后合并 map。

删除红条按 count × `view.defaultLineHeight` 绝对定位向上撑高；非删除标记单行高 100%。
不在本轮做「删除行文本悬浮 / hover 预览」。


### 4.3 CodeMirror 接入

- 新模块（建议）：
  - `files-editor-git-markers.ts`：纯函数 `markersFromDiffPatch(patch | null): ReadonlyMap<number, GitGutterKind>`
  - `files-editor-git-gutter.ts`：`createGitGutterExtension(markers)` + theme 类名
- `FileEditorViewSession`：
  - 增加 `#gitGutterCompartment: Compartment`
  - `setGitGutterMarkers(markers)` → `reconfigure`
  - 初始 extensions 挂空 markers 的 gutter（或条件挂载；优先常挂空实现以免反复增删 gutter 导致布局抖动）
- 样式（`code-mirror-editor-theme.ts` 或 gutter 模块内 `EditorView.baseTheme`）：
  - 独立窄 gutter，约 3–4px 实心竖条
  - 位置：行号 gutter **左侧**（对齐常见 IDE）
  - 颜色：
    - added → `var(--status-success-fg)`
    - modified → `var(--status-info-fg)`
    - deleted → `var(--status-danger-fg)`
  - 变更行整行浅底（added/modified）：`color-mix(in oklch, var(--status-*-bg) 55%, transparent)`；deleted 不铺行底（无文档行）。行底色向左负 margin（`-0.5rem`）延伸覆盖 content 左 padding，紧贴 gutter 右缘与色条连贯；文字位置不变。文字对比度不破。
  - 禁止硬编码 hex / 固定色阶

Gutter 仅展示，无点击 handler、无 tooltip。

### 4.4 刷新编排

编排放在 files 插件编辑器控制路径（`FileEditorController` 或等价 panel 绑定层），**不要**塞进 React `CodeMirrorEditor` 展示组件：

1. **资格**：`document.source.kind === "disk"`、当前视图为 source 模式、能解析 `gitRoot` 与相对 path。
2. **触发**：
   - view attach / 文档 path 切换到 disk
   - 保存成功且内容已落盘
   - `context.git.watch(gitRoot, …)` 回调（debounce 150–300ms，按 path 合并）
3. **竞态**：每次请求递增 `generation`；仅最新 generation 写回 markers。
4. **生命周期**：detach view / 文档关闭 → 取消 inflight、清空 markers、解除 watch 引用（若采用按 root 共享 watch，用引用计数，避免与树侧 watch 互相拆掉；可复用已有 git watch 语义，新增订阅必须可 dispose）。
5. **与树装饰的关系**：树继续用 `getStatus` 路径级着色；编辑器用 `getDiffPatch` 行级标记。两者独立，不要求共享 React state。

### 4.5 模式边界

| 模式 | Gutter |
|---|---|
| source + disk | 启用 |
| source + untitled | 否 |
| preview / rich | 否 |
| diff（冲突 Compare / `FilesLineDiff`） | 否（已是全文 diff） |

### 4.6 与 Git 插件职责

| | Files 编辑器 gutter | Git Changes / review |
|---|---|---|
| 场景 | 边看边写时的行级提示 | 提交前审查、stage、导航 |
| 数据 | 单文件 `getDiffPatch` from HEAD | review index / 多文件 patch |
| 交互 | 只读色条 | 完整 diff UI |

不在 Files 内复制 Git 插件的 review 面板。

## 5. 测试

- **单元（必须）**：`markersFromDiffPatch`
  - 纯新增、纯删除、修改（del+add）、多 hunk
  - 文首删除、文末删除、空 patch、null patch
  - 同行优先级（modified 覆盖）
- **可选**：CM gutter 在给定 markers 下 DOM class 存在（仅当现有测试基建成本低）
- **不强制** e2e

## 6. 验收标准

1. 相对 HEAD 有磁盘变更的文件打开 source 编辑器：变更行旁出现对应色条。
2. 保存新的磁盘变更后，gutter 在短 debounce 内更新。
3. 外部 git 操作（如 CLI stage/commit 使文件变干净）经 watch 后 gutter 清空。
4. 仅编辑未保存：gutter **不变**（仍反映磁盘 vs HEAD）。
5. untitled / 非 git / 失败：无条、无错误 toast。
6. 深浅色主题下色条可读，且只用语义 token。

## 7. 实现提示（非绑定细节）

主要触点：

- `src/plugins/builtin/files/renderer/files-editor-git-markers.ts`（新）
- `src/plugins/builtin/files/renderer/files-editor-git-gutter.ts`（新）
- `src/plugins/builtin/files/renderer/file-editor-view-session.ts` — Compartment + setMarkers
- `src/plugins/builtin/files/renderer/file-editor-controller.ts`（或 view coordinator）— 拉取与 watch
- `src/plugins/builtin/files/renderer/code-mirror-editor-theme.ts` — 如需主题补丁
- 单测：`tests/unit/…` 对齐现有 files 插件测试目录惯例

复用：

- `context.git.getDiffPatch`（`host-git-context` 已支持 `path` → `paths: [path]`）
- `GitDiffFilePatch` / `GitDiffHunk`（`src/shared/contracts/git.ts`）
- 树侧 watch 模式作订阅/dispose 参考（`file-tree-sidebar.tsx`），但 markers 状态不进 tree store

## 8. 后续可选（不在本 spec）

- 缓冲 vs HEAD 实时 gutter（需 HEAD blob 缓存 + 本地行 diff + 输入节流）
- staged / unstaged 分色
- 删除条 hover 显示删行文本
- 点击跳转 Git Changes 对应文件
