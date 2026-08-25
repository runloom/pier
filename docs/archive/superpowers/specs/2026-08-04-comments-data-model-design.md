# 统一评论能力数据模型设计

日期：2026-08-04
状态：设计评审中（数据模型先行，未开始实现）

## 1. 背景与目标

Pier 需要统一的评论管理能力：用户与智能体可以在工作产物（git 变更、代码、markdown、canvas）上留评论，评论按**项目**聚合（不同 git worktree 严格区分），并在对应智能体终端的状态栏可见。

目标：

1. **统一模型**：一套评论数据模型服务所有锚点类型（git diff / 代码行 / markdown 块 / canvas 节点），消费端（各插件的渲染 UI）按需实现，不各自发明存储。
2. **项目隔离**：评论以路径（`worktreeKey`）为主键区分，不同 worktree 之间互不可见、互不污染；支持按项目删除。
3. **状态栏可见**：智能体终端状态栏展示当前项目评论状态（未解决数 / 未读数），点击可打开评论中心。
4. **分期交付**：第一期只实现 git 评论（diff 行内 + 文件级兜底）；code / markdown / canvas 在数据模型上预留扩展位，不提前实现消费端。

## 2. 范围界定

### 2.1 第一期（v1）

- 宿主级统一评论服务：持久化、增删改查、项目区分、广播。
- 锚点类型：`git-diff`（diff 行内线程）+ `git-file`（文件级线程，兜底）。
- 作者：用户与智能体双向（`CommentAuthor` 判别联合）。
- 消费端 UI：git 插件 review diff 渲染行内评论 + 评论中心列表。
- 终端状态栏：core 评论状态项（未解决 / 未读计数）。

### 2.2 预留（v2+，模型已留位，不提前写 schema）

- `code`：编辑器内行评论（文件 + 行）。
- `markdown`：markdown 预览块 / 标题锚点评论。
- `canvas`：canvas 节点评论。
- 智能体运行时消费评论（注入 agent 上下文）。
- 嵌套回复（`replyTo`）。
- outdated 标记：commit / branch review 目标推进后，旧评论显式标记「过时」（对齐 GitHub，见 §4.6），讨论上下文保留为时间线。

### 2.3 非目标

- 评论的权限/ACL（本地单用户应用）。
- 独立评论中心列表视图（v1 不做）。业界调研结论：GitHub / GitLab 主流无独立列表，评论挂在它评论的位置（diff 行内），漂移评论用 outdated 折叠在原位处理，顶部只做未解决/已解决/过时导航；独立列表仅在跨版本追踪（Gerrit patch set）或多源聚合（VS Code Comments view）场景才出现，Pier v1 单源本地 + 单版本 review target，不命中。漂移评论兜底改走文件级折叠区（§4.5），状态栏点击改走导航式跳转（§7）。
- 跨项目统一收件箱（评论按项目隔离，无跨项目聚合视图）。
- 富文本 / 附件 / 表情回应（v1 只存 markdown 文本，字段可后加）。

## 3. 架构落点

评论是**宿主统一能力**，不属于任何单一插件：

| 层 | 位置 | 职责 |
|---|---|---|
| 主进程服务 | `src/main/services/comments/` | 唯一写方：持久化、身份校验、广播 |
| 契约 | `src/shared/contracts/comments/` | zod schema（本文 §4） |
| 广播 | `pier://comments:changed` | 项目级快照 + 单调 revision |
| 渲染镜像 | `src/renderer/stores/comments.store.ts` | 按 `worktreeKey` 镜像，多窗同步 |
| 插件门面 | `RendererPluginContext.comments` | 插件消费端读写 API（git 插件用） |
| 状态栏 | core 声明 `CORE_COMMENT_STATUS_ITEMS` 追加一项 | 项目评论计数（§7） |
| git 消费端 | git 插件 `renderer/review/` | diff 行内评论 UI（第一期） |

边界纪律：git 插件（builtin）只可 import `plugins/api` + `shared` + `packages/ui`，因此评论读写必须经 `RendererPluginContext.comments` 门面，不能直连宿主 store；`git:read` 等现有 capability 之外新增 `comments:read` / `comments:write`。

## 4. 数据模型

### 4.1 存储顶层（单项目文件）

```ts
const commentProjectStoreSchema = z.strictObject({
  version: z.literal(1),
  /** 项目区分主键：绝对路径（git worktree 根或项目根），与 PanelContext.worktreeKey 同源。 */
  worktreeKey: z.string().min(1),
  /** 全部线程，按 updatedAt 降序维护（评论中心直接消费）。 */
  threads: z.array(commentThreadSchema),
});
```

### 4.2 评论线程（CommentThread）

线程是评论的基本单元：一个锚点一个线程，线程内评论扁平排列（v1 无嵌套回复）。

```ts
const commentThreadSchema = z.strictObject({
  /** uuid，跨项目唯一。 */
  id: z.string().uuid(),
  /** 锚点（§4.5）：线程创建后不可变。 */
  target: commentTargetSchema,
  /** 工作流状态：open（未解决）/ resolved（已解决）。与阅读状态正交。 */
  state: z.enum(["open", "resolved"]),
  createdAt: z.number(),
  /** 最后一条评论时间或状态变更时间：评论中心排序与未读判定的单一来源。 */
  updatedAt: z.number(),
  comments: z.array(commentItemSchema),
  /** 创建时的面板上下文 id（审计用，可选）。 */
  originContextId: z.string().max(64).optional(),
});
```

### 4.3 评论条目（CommentItem）

```ts
const commentItemSchema = z.strictObject({
  id: z.string().uuid(),
  author: commentAuthorSchema,
  /** markdown 正文。 */
  body: z.string().min(1).max(64 * 1024),
  createdAt: z.number(),
  editedAt: z.number().optional(),
  /** 软删标记：保留作者与时间用于审计，UI 显示「已删除」。 */
  deletedAt: z.number().optional(),
  /** 预留：嵌套回复目标（v2）；v1 恒缺省。 */
  replyTo: z.string().uuid().optional(),
});
```

### 4.4 作者（CommentAuthor）

```ts
const commentAuthorSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("user") }),
  z.strictObject({
    kind: z.literal("agent"),
    /** 智能体稳定 id；displayName 是快照——智能体可被删除/改名，评论不随主体消亡。 */
    agentId: z.string().min(1),
    displayName: z.string().min(1),
  }),
]);
```

### 4.5 锚点（CommentTarget）

锚点是评论与工作产物的绑定点，判别联合按 `kind` 分派。**v1 schema 只注册 git 两种**；code / markdown / canvas 只出现在类型枚举与本文档中，待对应消费端落地时经版本迁移加入（§9）。

```ts
/** 类型层完整枚举（forward-compat）；schema 层 v1 只收 git 两种。 */
export type CommentTargetKind =
  | "git-diff"
  | "git-file"
  | "code"      // v2+
  | "markdown"  // v2+
  | "canvas";   // v2+

const gitCommentScopeSchema = gitReviewScopeSchema;
// 复用 git-review 现有身份：{ contextId, gitRootPath, target(commit/branch/uncommitted) }
// 保证评论身份与 review 文档身份同源（contextId + gitRootPath 双重校验）。

const gitDiffCommentTargetSchema = z.strictObject({
  kind: z.literal("git-diff"),
  scope: gitCommentScopeSchema,
  /** 对齐 review render slot 的 group：unstaged/staged/conflict/committed。
   *  同文件同行的 staged 与 unstaged 是两套 diff，group 是必要消歧字段。 */
  group: z.enum(GIT_REVIEW_GROUP_ORDER),
  /** 相对 gitRoot 的新路径；重命名场景 diff 渲染需要旧路径。 */
  path: gitReviewRelativePathSchema,
  oldPath: gitReviewRelativePathSchema.nullable(),
  side: z.enum(["old", "new"]),
  /** 1-based 行号（对应 side 一侧）。 */
  line: z.number().int().positive(),
  /** 评论行所在文件版本的 blob OID（new 侧=工作区/索引对应版本，old 侧=HEAD/父提交）。
   *  版本判定的确定性指纹：渲染时 blob 一致 → 行号精确；不一致 → 显式标记「代码已修改」，
   *  不猜测新位置（§4.6 锚定策略）。创建时随 diff 解析取得（§4.6 实现注记）。 */
  blobOid: z.string().regex(/^[0-9a-f]{40}$/u).optional(),
  /** 预留：模糊重锚定上下文指纹（行内容 + 前后 N 行摘要拼接 hash），v2 启用。 */
  anchor: z.string().max(256).optional(),
});

const gitFileCommentTargetSchema = z.strictObject({
  kind: z.literal("git-file"),
  scope: gitCommentScopeSchema,
  path: gitReviewRelativePathSchema,
});

const commentTargetSchema = z.discriminatedUnion("kind", [
  gitDiffCommentTargetSchema,
  gitFileCommentTargetSchema,
]);
```

**锚定策略**：commit / branch target 锚定不可变 OID，行号永不漂移（对齐 GitHub PR review：评论身份 = 这一版代码的某行，而非现在的某行）。uncommitted 是活数据，v1 用 **blob OID 确定性判定**：渲染时按 `(group, path, side, line)` 匹配当前 review 文档，同时校验 `blobOid`——blob 一致 → 行号精确；blob 不一致 → 显式标记「此评论对应的代码已修改」（不猜测新位置，不静默错位）。匹配不到的评论**不丢失**，降级到文件级折叠区显示（文件 header 下「X 条评论已无法定位到行」，对齐 GitHub outdated 折叠在原位——原位 = 文件，而非独立列表）。模糊重锚定（`anchor` 上下文指纹）为 v2 可选项。取舍论证见 §4.6。

### 4.6 锚点策略：业界对照与取舍

业界对「评论锚定」有两条技术路线，分界是评论锚定在**不可变快照**还是**活文档**上：

**路线 A：不可变锚定（GitHub / GitLab / Gerrit）**。评论锚定 commit SHA + 文件 + diff 行号；commit 不可变 → 行号永不漂移，零算法成本。内容更新后**不跟随**，显式标记 outdated（评论身份 = 这一版代码的某行），线程列表永久保留，形成可追溯的时间线。评审场景业界没有第三种做法——PR/MR 本质是 commit 集合，评论从不锚定工作区。

**路线 B：活文档锚定（Google Docs / Figma / Notion / VS Code inline chat）**。Google Docs 用稳定元素 ID + 操作日志（底层 CRDT），文字插入删除时评论自动跟随；Figma 锚节点 ID；Notion 锚 block ID + 文本偏移。VS Code inline chat 用文档变更事件维护「旧位置 → 新位置」映射（position tracking），官方承认「可能漂移」，只保证尽力跟随。模糊重锚定（内容指纹 + 附近文本匹配）是最后手段——相似度启发式需校准，**误挂比不挂更糟**。所有产品的共同底线：**线程列表永不失效**。

**Pier 的取舍**：

1. **commit / branch target 走路线 A**（v1 已天然正确）：不可变 OID 锚定；v2 补 outdated——review 目标推进后旧评论标记过时（`scope.target` 已记录 OID，无需新字段）。
2. **uncommitted 用 git 原生确定性指纹替代自研算法**：这是 Pier 相对 Google Docs 路线的结构性优势——Google 要自建 CRDT 才能获得「内容身份」，而 **blob OID 就是 git 免费提供的确定性内容指纹**。blob 未变 → 行号精确；blob 变了 → 确定性标记「代码已修改」。零模糊匹配、零误挂风险。
3. **行号平移（blob 变但行还在）v1 保守处理为「已修改」**（不猜测位置）；如使用反馈证明高频，v2 再组合 position tracking 或上下文重锚定（`anchor`）。
4. **线程列表兜底保留**——业界共同底线。

**实现注记（blobOid 来源）**：tracked 文件从 git diff 输出 `index <oldBlob>..<newBlob>` 头解析；untracked 文件经 `git hash-object`（git-review patch 管线已具备，见 `main/services/git-review/document/patch.ts`）。若 patch 契约当前未透出 index 头，需在 patch-contract 增加字段（实现期确认）。

### 4.7 阅读状态（readState）

阅读状态与线程工作流状态（`state`）正交，单独存储：

```ts
const commentReadStateSchema = z.strictObject({
  /** 项目级：用户最后「看过评论」的时间戳（打开评论中心 / diff 行内浏览时刷新）。 */
  lastReadAt: z.number(),
});
```

未读判定：`thread.updatedAt > lastReadAt` 且存在未删除条目 → 未读。v1 是**项目级粗粒度**（看一遍即全已读，对齐「打开评论中心」的自然语义）；thread 级 `readAt` 是 v1.1 的可选细化，模型上不再另设字段——未来按 thread 记 `readAt` 时把它放进 `commentThreadSchema`（版本迁移新增可选字段，向后兼容）。

## 5. 项目区分与存储布局

- **主键**：`worktreeKey`（绝对路径）。`contextId`（`ctx:<sha256(worktreeKey) 前 16 位>`）由 `panel-context-resolver.ts` 稳定派生，与路径一一对应，**不单独持久化**，运行时随时可重算。
- **文件布局**：`{userData}/comments/{contextId}.json`。contextId 是安全文件名（16 位 hex），文件内记录 `worktreeKey` 绝对路径，用于审计、跨项目浏览与孤儿回收。
- **加载策略**：懒加载。启动只读当前项目（按需）；`listProjects` IPC 扫描目录、读各文件 `worktreeKey` 返回已知项目清单（评论中心跨项目浏览与「清空某项目评论」入口的数据源）。
- **孤儿策略**：git worktree 被删除后评论文件保留（数据安全优先，不主动删）；用户经评论中心「项目列表」显式清空。worktree 删除命令联动清理为可选项，v1 不做。

## 6. 事件与广播

对齐 notification-center 既有模式（main 唯一写方 + 快照广播 + 镜像 store）：

- 通道：`pier://comments:changed`
- 载荷：`{ worktreeKey, revision, snapshot }`——项目级全量快照 + 单调 revision（合并重复广播用；评论 v1 量级小，全量快照可接受）。
- 写路径全部走 main `CommentsService`（zod 解析 → 身份校验 → 持久化 → 广播），renderer 与插件都不得直接改文件。
- 多窗口：广播天然同步；`markRead` 等无内容变更也走同通道（revision +1）。

**IPC 面**（宿主 renderer 直连；插件经门面）：

| 操作 | 说明 |
|---|---|
| `list(worktreeKey)` | 加载项目快照（懒加载触发点） |
| `listProjects()` | 已知项目清单（只读 `worktreeKey`） |
| `createThread(target, body)` | 建线程 + 首条评论（原子） |
| `addComment(threadId, body)` | 回复 |
| `updateComment(threadId, commentId, body)` | 编辑（置 `editedAt`） |
| `deleteComment(threadId, commentId)` | 软删（置 `deletedAt`） |
| `setResolved(threadId, state)` | 解决 / 重新打开 |
| `markRead(worktreeKey)` | 项目级已读 |
| `deleteProject(worktreeKey)` | 清空项目评论（孤儿清理入口） |

**身份校验**：`scope.gitRootPath` / `contextId` 的 canonicalize 归 main 侧所有权（对齐 git-review 既有纪律：renderer 不得把词法路径当授权身份），写入前校验 `gitRootPath` 与 `worktreeKey` 的派生一致性。

## 7. 终端状态栏展示

- 贡献方式：core 声明追加 `CORE_COMMENT_STATUS_ITEM_ID`（`src/shared/plugin-core-contribution-ids.ts` + `core-terminal-status-items.ts`，与 agent status 项并列）。评论是跨锚点类型的宿主能力，不进 git 插件。
- 数据源：当前面板上下文（终端面板的 `PanelContext.worktreeKey`）→ 评论镜像 store 取计数；无评论 / 全已读时不占位。
- 展示语义（v1 推荐，可调）：
  - 主计数：**未解决线程数**（`state === "open"`）——无论作者是谁，是「还有多少事没处理」的工作量语义。
  - 未读高亮：存在 `updatedAt > lastReadAt` 的线程时加重点样式（agent 新评论的场景）。
- 点击：**导航式跳转**（对齐 GitHub Conversations 菜单，不做独立列表）——打开 git changes 面板并滚动到第一个未解决评论位置（经面板 params 传 `scrollTarget` + `PierDiffViewHandle` line 级 `scrollTo` 透传）。无未解决时不响应或静默。

## 8. 插件消费端与 capability

- git 插件 manifest 声明 `comments:read` / `comments:write`，运行时经 `assertPluginCapability` 断言（纪律边界，对齐现有模式）。
- `RendererPluginContext.comments` 门面：`list(worktreeKey)`（订阅走事件） / `createThread` / `addComment` / `updateComment` / `deleteComment` / `setResolved` / `markRead`，与 dialogs / notifications 门面同构。
- 消费端 UI（v1，git 插件 `renderer/review/`）：
  - `code-view.tsx` diff 渲染行内线程（gutter 锚点 + 展开卡片 + 计数徽标，对齐 orca PR 行内评论交互形态）。
  - 文件级线程渲染在文件 header / 评论中心。
- 后续 code / markdown / canvas 插件各自实现消费端，数据层零改动（新锚点类型随版本迁移加入 schema）。

## 9. 版本迁移与扩展路径

`versionedJsonStore` 迁移链已就绪，评论存储从 v1 起步：

| 版本 | 变更 |
|---|---|
| v1 | git-diff（含 blobOid 确定性判定）/ git-file 两种锚点 |
| v2（预期） | 加 `code` / `markdown` / `canvas` 锚点；outdated 标记（commit 推进）；`thread.readAt`、`item.reactions`、嵌套 `replyTo`；`anchor` 上下文重锚定启用 |

- 新锚点类型是**新增判别成员**，存量线程数据无需改写，migration 只升级 schema 版本号（或对缺省字段补默认值）。
- 旧版本程序读新文件：同一仓库同步发版，不做跨版本前向兼容；但**存储文件永远只被当前版本写**（读旧版本文件 → 迁移链升级 → 写回），保证磁盘状态恒为最新 schema。

## 10. 关键决策记录

1. **锚点粒度**：diff 行内 + 文件级兜底（已确认）。行内线程价值最高（GitHub review 式），文件级保证行号漂移后评论不丢。
2. **作者模型**：用户 + 智能体双向（已确认）。判别联合成本为零，智能体侧 v1 只留 API，UI 以用户创建为主。
3. **项目主键**：`worktreeKey` 绝对路径（用户要求「使用路径标识」）；`contextId` 不单独持久化。
4. **存储形态**：按项目分文件（`{userData}/comments/{contextId}.json`）而非单文件——评论是内容型数据、量可增长，项目隔离便于删除与按需加载。
5. **阅读状态粒度**：v1 项目级 `lastReadAt` 粗粒度；thread 级细化留 v1.1。
6. **评论服务归属**：宿主（跨锚点统一能力），插件只做消费端；状态栏项走 core 声明。
7. **锚定策略**：commit / branch 走不可变锚定（GitHub 模式，天然稳定）；uncommitted 用 blob OID 做确定性版本判定（blob 变 → 显式标记「代码已修改」，不做位置猜测）；线程列表兜底；`anchor` 上下文指纹留 v2 模糊重锚定。业界对照见 §4.6。

## 11. 风险与待确认

- **group 漂移**：uncommitted 的 staged/unstaged 分组随 stage 操作变化，评论可能从当前 diff 消失（降级到文件级折叠区兜底）。v1 接受，观察使用反馈后决定是否做跨组迁移或按 `anchor` 重锚定。
- **blob 判定的保守性**：blob 变化时即使评论行仍存在，也标记「代码已修改」而非猜测新位置——确定性优先；「跟随」体验（position tracking）是 v2 可选项，取决于使用反馈。
- **blobOid 获取**：依赖 diff 输出 index 头与 `git hash-object`（patch 管线已具备）；若 patch 契约未透出 index 头需补字段（实现注记见 §4.6）。
- **状态栏计数语义**（未解决 vs 未读）v1 取「未解决数 + 未读高亮」，评审时确认。
- **跳转跨域参数传递**：状态栏（宿主 renderer）点击 → 打开 git changes 面板（git 插件）并滚到行，需经面板 params 传 `scrollTarget` + `PierDiffViewHandle` line 级 `scrollTo` 透传（agent 1 勘察确认是小改动）；v1 若跨域传递成本超预期，可降级为「仅打开面板不滚到行」，行定位留 v1.1。
