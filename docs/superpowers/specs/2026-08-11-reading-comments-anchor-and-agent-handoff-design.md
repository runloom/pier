# 阅读评论锚定与智能体交接设计

日期：2026-08-11  
状态：设计评审中  
前置：[`2026-08-04-comments-data-model-design.md`](./2026-08-04-comments-data-model-design.md)（统一评论数据模型；git 消费端 v1）

## 1. 背景与目标

### 1.1 背景

统一评论底座（宿主 `CommentsService`、契约、状态栏、git review 行内评论、提交到智能体 composer）已落地。当前缺口：

1. **阅读场景**：用户在 Markdown 预览、Canvas 预览上批注后，需要同一条「状态栏 → 列表 → 提交智能体」回路。  
2. **内容变更**：原文改写后，评论不得**空挂**（以精确附着展示但证据已失效）。  
3. **底层未闭环**：`blobOid` 设计有、创建路径未稳写；`processable` / composer 文案仅认 uncommitted `git-diff`；`markdown` / `canvas` 仅在 kind 枚举占位。

本设计在数据模型文档之上，锁定 **锚定与投影策略**、**防空挂原则**、**智能体交接扩展** 与 **三阶段实施路径**。

### 1.2 目标

1. **不空挂**：精确原位展示只允许确定性证据；失败则漂移展示或目标缺失，禁止静默钉错位置。  
2. **一套账本**：git / markdown / canvas 共用 `CommentsService`；消费端分插件，存储不分库。  
3. **同一交接**：智能体终端状态栏聚合可处理评论，格式化写入 structured composer，提交后清除（与 git v1 同构）。  
4. **分三步交付**：先夯实底层与 git，再 Markdown，再 Canvas（见 §8）。

### 1.3 非目标

- 编辑器内 durable `code` 行评论（审查继续走 git-diff；写代码时用选区 / 提及，不落评论库）。  
- 模糊相似度重挂、OT/CRDT 位置跟随、Canvas 视口坐标 pin。  
- 嵌套回复、表情、跨项目收件箱、把评论写进源文件旁 `.comments.json`。  
- 后台因内容变更自动软删评论（stash / 临时 clean 会误删）。

---

## 2. 业界调研摘要

### 2.1 路线对照

| 路线 | 代表 | 内容变更行为 | 错挂风险 |
|------|------|--------------|----------|
| **A. 不可变快照 + Outdated** | GitHub / GitLab PR review | 行所属版本变了 → Outdated；Conversation 保留 | 极低 |
| **B. 稳定对象 ID** | Notion `block_id`、Figma 对象钉 | ID 仍在则跟随；删除则失效 | 低 |
| **C. 编辑器 Range 映射** | VS Code Comments API | 文档变更尽力更新 range，官方承认会漂 | 中 |
| **D. 模糊重挂 / 坐标 pin** | 部分「智能」方案、早期 Figma 坐标钉 | 猜新位置或钉画布坐标 | **高** |

GitHub 立场：行已改时工具无法判断旧意见是否仍适用于新行，故标 Outdated，而不是猜挂点。  
Notion / Figma 能跟随，是因为内容树有一等公民 ID；普通 Markdown 源文件默认没有 block id。  
共同底线：**讨论线程不静默消失**；原位视图可以折叠，列表 / 会话仍可追溯。

### 2.2 对 Pier 的含义

| 场景 | 应采用的路线 |
|------|----------------|
| Git 审查 | A（blob / hunk + 文件级兜底），与现有设计 §4.6 一致 |
| Markdown 阅读 | B 的弱形式（heading slug）+ **整块内容指纹精确匹配**；无指纹不得当精确 |
| Canvas 阅读 | 文件级（零错挂）→ 声明式 `anchorId`（类 Figma 对象钉）；禁坐标 pin |
| 代码编辑 | 不做 durable 行评论；避免 C 当唯一真相 |

---

## 3. 防空挂原则（硬约束）

空挂定义：

> UI 以「精确附着」展示评论，但投影证据已不成立。

硬规则：

1. **错挂严于假消失**：宁可 `drifted` / `missing`，也不把评论画在错误内容上。  
2. **存储锚点创建后不可变**；变更只产生 renderer **投影态**，不改写 `target`。  
3. **精确附着只允许确定性证据**（见 §4.2）。  
4. **禁止默认模糊重挂**（相似度、最近标题、最近行）。  
5. **创建时必须留下 excerpt（原文摘录）**；漂移后人和智能体仍知「评的是哪句」。  
6. **线程不因内容变更后台静默删除**；删除 = 用户清除 / 提交并清除 / 失效跳转确认。  
7. **交给智能体的文案必须带定位状态**（located / stale）+ excerpt，避免智能体把过时行号当真理。

---

## 4. 统一投影模型

### 4.1 投影三态

投影由纯函数根据「线程 target + 当前表面快照」计算，**不落盘**：

```ts
type CommentProjectionStatus = "located" | "drifted" | "missing";

type CommentProjection = {
  status: CommentProjectionStatus;
  /** 仅 located：供原位 UI / scroll */
  locate?: {
    kind: "git-line" | "markdown-heading" | "markdown-block" | "canvas-file" | "canvas-anchor";
    // kind 相关字段由实现侧收窄
  };
  reason?:
    | "content-changed"
    | "out-of-range"
    | "blob-mismatch"
    | "anchor-gone"
    | "file-gone"
    | "path-not-in-live-set";
};
```

| 状态 | 原位 UI | 列表 / 状态栏 | 提交智能体 |
|------|---------|---------------|------------|
| **located** | 允许钉住与高亮 | 普通条目 | 是，正常锚点文案 |
| **drifted** | **禁止**当精确钉；文件级折叠 / 角标列表 | 标「原文已变 / 无法精确定位」 | 是，标 stale + excerpt |
| **missing** | 无 | 「目标不可用」；跳转失败可引导清除 | 默认否（或仅正文无路径断言，产品取否） |

实现落点建议：

- 共享：`src/renderer/lib/comments/project-thread.ts`（纯函数 + 单测）。  
- Git 现有 `classifyInlineDrift` 收敛为该投影的 git 分支输入之一。  
- Markdown / Canvas 消费端只消费投影结果，不各自发明状态枚举。

### 4.2 确定性证据（唯一允许的 located 条件）

| kind | located 当且仅当 |
|------|------------------|
| `git-diff` | 行仍在当前 patch 合法 hunk 范围内，**且**（无 `blobOid` 或 当前 blob 与存储一致） |
| `git-file` | 文件仍在当前 review 文档 / 索引中（文件级，无行钉） |
| `markdown` | 文件存在，且（`headingId` 命中 **或** 某 block 的 `contentHash` 全等命中） |
| `canvas`（文件级） | `path` 仍指向可读 canvas 文件 |
| `canvas`（节点级） | 文件存在，且运行时注册表 / DOM 仍有 `anchorId` |

**明确禁止单独用行号判定 markdown located**（前文插入空行会导致错挂）。行号仅作弱提示与 agent 文案，UI 不得仅凭行号画精确高亮。

### 4.3 生命周期

```text
内容 / 表面变更
  → 重算投影（不写盘）
  → located | drifted | missing
  → 原位 UI / 文件级列表 / processable 各自消费
  → 用户提交智能体 → 清除对应存活评论（与 git v1 同构）
  → 用户点 missing/失效跳转 → 可显式软删
```

---

## 5. 数据模型扩展

在 `commentTargetSchema` 上**新增判别成员**（存量 git 线程无需改写；存储 `version` 策略对齐数据模型文档 §9）。

### 5.1 Markdown

```ts
{
  kind: "markdown",
  path: string,                 // 相对 worktree / projectRoot
  headingId?: string,           // GithubSlugger 产物，可空
  startLine: number,            // 1-based，创建快照；不可单独当 located
  endLine?: number,
  contentHash: string,          // 必填：规范化块文本 hash
  excerpt: string,              // 必填：创建时摘录，有界长度
}
```

规范化建议：统一换行、折叠连续空白后再 hash；粒度 = 用户点击的 block 全文（heading 评论可用标题文本或标题+首段）。

**创建校验**：缺 `contentHash` 或 `excerpt` → 拒绝创建（或创建路径由 IR 自动填充，填充失败则失败）。

### 5.2 Canvas

**阶段 3a 文件级：**

```ts
{
  kind: "canvas",
  path: string,
  excerpt?: string,             // 建议有；文件级可放用户短描述
  label?: string,
}
```

**阶段 3b 节点级（可选同迭代或紧随）：**

```ts
{
  kind: "canvas",
  path: string,
  anchorId: string,             // 作者声明的稳定 id
  label?: string,               // 创建时展示名快照
  excerpt?: string,
}
```

`pier/canvas` 或约定：`data-pier-comment-id` / `<CommentAnchor id="…">`。无 `anchorId` 的线程永不画在随机组件旁。

### 5.3 Git 补齐

- 创建 `git-diff` 线程时写入 `blobOid`（与 patch / `hash-object` 同源）。  
- 投影：hunk 内 **且** blob 一致 → located；否则 drifted（`blob-mismatch` 或 `out-of-range`）。  
- `anchor` 上下文字符串指纹仍为后续可选项，**本设计默认关闭**。

### 5.4 与「单条批注」瘦身的关系

当前服务端 v1 瘦身：无回复、无 resolve、每锚点实质一条存活评论。本设计 **不强制** 恢复 `setResolved`；漂移用投影态表达，不新增存储字段 `outdated`。若日后恢复 resolve，outdated 与 open/resolved 正交。

---

## 6. 智能体交接扩展

### 6.1 可处理集合（processable）

现状：`listProcessableComments` 仅 uncommitted `git-diff` + livePaths。

扩展后按 kind 策略：

| kind | 计入 processable 的条件 |
|------|-------------------------|
| `git-diff` | 保持现有：uncommitted + 存活正文 + path 仍在 livePaths |
| `markdown` | 存活正文 + 同 worktree；**不**要求 uncommitted；`missing` 默认不计 |
| `canvas` | 同 markdown；节点级 `missing` 不计，`drifted` 可计 |

`drifted` 可计入，以便用户仍能把「可能过时」的意见交给智能体，但 payload 必须标 stale。

### 6.2 格式化文案

扩展 `formatCommentsForComposer`（或改名为中性 `formatProcessableComments`）：

```text
Please address these comments:

## Review
- [located] `src/a.ts:42`: …
- [stale] `src/b.ts:10` (code changed): …

## Document
- [located] `docs/plan.md#api-surface` (L42–L58): …
- [stale: content changed] `docs/plan.md` excerpt «…»: …

## Canvas
- [located] `design/login.canvas.tsx` [login-submit]: …
- [stale: anchor gone] `design/login.canvas.tsx`: …
```

Composer chip 标签改为中性「N 条批注」（i18n），避免写死「审查」。提交并清除语义与 git v1 相同。

### 6.3 Reveal 路由

| kind | 跳转 |
|------|------|
| git | 现有 `openGitChangesForComments` + line reveal |
| markdown | 打开 files 预览该 path → heading / block scroll（复用 TOC / `data-source-offset`） |
| canvas | 打开 canvas 预览；有 `anchorId` 则滚到节点，否则仅打开文件 |

---

## 7. 消费端交互（概要）

### 7.1 Markdown（预览）

- 入口：块旁 / 选区「添加评论」（预览态，不进 CM 编辑态画同一套 UI）。  
- 创建：从 IR 取 range、hash、excerpt、可选 headingId。  
- located：块旁徽标；TOC 可选小圆点。  
- drifted / missing：预览角或文件级列表，展示 excerpt，**不高亮错误段落**。  
- capability：files 插件声明 `comments:read` / `comments:write`。

### 7.2 Canvas

- **3a**：工具栏「评论」列表 + 文件级创建。  
- **3b**：仅当节点带 `anchorId` 时 hover 出入口；热更新按 id 重绑。  
- 评论不写回 `.canvas.tsx` 源文件。

### 7.3 Git

- 保持行内 + drift 折叠；补 blob 投影。  
- 状态栏弹窗可混排多 kind（分组）。

---

## 8. 实施路径（三步）

与产品确认一致：**三步串行**，每步可独立合并、独立验收；后一步依赖前一步的投影与 processable 地基。

### 步骤 1 — 优化当前实现与底层能力完善

**目标**：git 防空挂闭环 + 多 kind 可扩展的共享层，尚无 md/canvas UI。

| 工作项 | 说明 |
|--------|------|
| Schema 扩展骨架 | `commentTargetSchema` 加入 `markdown` / `canvas` 成员（可先实现校验与单测，无 UI） |
| 创建写 `blobOid` | git-diff 创建路径补齐 |
| 投影模块 | `projectComment` 纯函数；git 分支接入 hunk + blob；单测锁定「无证据不得 located」 |
| processable / 格式化 | 多 kind 联合类型；composer 文案带 `[located\|stale]`；chip 中性文案 |
| Reveal 分发骨架 | kind 路由表；md/canvas 可先 stub 或仅 list |
| 服务端校验 | markdown 强制 hash+excerpt；canvas path 必填 |
| 治理 / 单测 | 契约测试 + 投影表驱动测试 + processable 回归 |

**验收要点**：

- 行在 hunk 内但 blob 不一致 → drifted，不原位当精确。  
- 模糊重挂无代码路径。  
- 新 target 可经 IPC 创建并通过 schema（即便尚无 UI）。

**非本步**：Markdown / Canvas 预览入口与原位 UI。

---

### 步骤 2 — Markdown 能力支持

**目标**：阅读批注 → 投影 → 状态栏 → 智能体，完整闭环。

| 工作项 | 说明 |
|--------|------|
| files 插件 capability | `comments:read` / `comments:write` + 门面调用 |
| 预览创建 / 编辑 / 删除 | IR 驱动 hash、excerpt、headingId |
| 原位与 drift UI | 遵循 §4；禁止仅行号高亮 |
| Reveal | 打开预览 + scroll 到 heading/block |
| processable 计入 markdown | 不依赖 git livePaths |
| i18n | 用户文案走 locale，禁实现词 |

**验收要点**（防空挂）：

1. 改被评段落一字 → 不得再精确块高亮；须 drifted 且仍见 excerpt。  
2. 整段剪切到文末且正文不变 → hash 命中 → 允许钉到新位置。  
3. 仅在文前插入空行、被评块未改 → 跟随块，不死钉旧行号。  
4. 提交智能体 payload 含状态与 excerpt；提交后清除。

**非本步**：Canvas UI；编辑器 code 评论。

---

### 步骤 3 — Canvas 能力支持

**目标**：设计稿批注进入同一账本与智能体回路。

| 子步 | 工作项 |
|------|--------|
| **3a 文件级** | toolbar 列表、文件级 target、processable、打开预览 reveal |
| **3b 节点级** | `CommentAnchor` / `data-pier-comment-id` 约定；运行时 id 注册表；located/drifted 投影 |

**验收要点**：

1. 无 `anchorId` 的评论 **从不** 出现在随机组件旁。  
2. `anchorId` 删除后 → drifted，不 pin 到其它节点。  
3. 热更新 id 仍在 → 保持 located。  
4. 与 markdown/git 同窗提交智能体，分组清晰。

**非本步**：坐标 pin、自动截图附件（可后置）。

---

## 9. 架构落点汇总

| 层 | 步骤 1 | 步骤 2 | 步骤 3 |
|----|--------|--------|--------|
| `shared/contracts/comments` | 扩展 target + 校验 | — | 若需收紧 canvas 字段 |
| `main/services/comments` | 校验 excerpt/hash；blob 透传 | — | — |
| `renderer/lib/comments` | 投影、processable、format、reveal 路由 | md reveal 实装 | canvas reveal |
| git 插件 | blob 创建 + 投影接入 | — | — |
| files 插件 | — | markdown 消费端 | canvas 消费端 |
| 终端状态栏 / composer | 多 kind chip 与文案 | 混排展示 | 同左 |
| `pier/canvas` | — | — | CommentAnchor 约定（3b） |

纪律：插件只经 `RendererPluginContext.comments`；宿主唯一写方；不新增并行评论存储。

---

## 10. 风险与决策记录

| 风险 | 缓解 |
|------|------|
| Markdown hash 过敏感（改标点即 drift） | 可接受的保守；v2 可提供「仅标题锚」粗粒度选项 |
| 步骤 1 先扩 schema 无 UI | 契约测试锁字段；避免半套 target 流入 |
| Canvas 作者不写 anchorId | 3a 文件级已可用；文档与 skill 引导 3b |
| 状态栏条数膨胀 | 仅 agent 面板显示；弹窗分组；与现网 git 同交互 |
| 与数据模型文档 v1 范围表述冲突 | 本文为后续阶段权威；数据模型文档 §2.2 预留位由本文落地 |

**已确认决策**：

1. 实施路径固定为 **三步**：底层完善 → Markdown → Canvas。  
2. 防空挂优先于「永远跟像素」。  
3. 提交智能体后清除（与 git v1 同构）。  
4. 本期不做编辑器 `code` durable 评论。  
5. 不做模糊重挂与坐标 pin。

---

## 11. 与既有文档关系

| 文档 | 关系 |
|------|------|
| `2026-08-04-comments-data-model-design.md` | 存储、IPC、git 锚点、状态栏归属的权威基础；本文扩展阅读锚点与投影，不推翻项目主键与广播模型 |
| 本文 | 阅读场景、防空挂、投影三态、智能体多 kind 交接、三步实施与验收 |

实现计划（writing-plans）应拆成与 §8 对齐的三个可合并 PR 序列（或 Graphite 栈），每步附带 §8 验收用例的单测 / 组件测。

---

## 12. 成功标准（总览）

1. 任意 kind：**无确定性证据不得 `located` 原位展示**。  
2. 漂移评论：列表可见、excerpt 可见、可提交（标 stale）、不可装成精确钉。  
3. 智能体 payload：含路径、状态、excerpt；提交后对应评论清除。  
4. 三步可独立发布；步骤 2 不依赖 Canvas；步骤 3 不破坏 Markdown 投影。  
5. 无后台静默删除；无模糊重挂代码路径。
