# Files 路径查询、树搜索与快速打开设计

Date: 2026-07-17  
Status: accepted / partial（path query + Cmd+P 已落地；树搜索展示见 2026-07-18 修正 spec）  
Scope: **path query only**（路径枚举 + 模糊排序）。**不做**内容搜索 `Cmd+Shift+F` / search panel。

## 1. 问题

侧栏文件树搜索当前实现：

1. `loadFilesTreeForSearch` 递归 `files.list` 灌整树进 tree store  
2. Pierre 对已加载路径做 `path.toLowerCase().includes(query)`  

后果：

- 深路径（如 `src/plugins/.../code-mirror-editor-theme.ts`）在「正在搜索…」期间常缺失  
- 大仓库卡顿、内存膨胀  
- 违反 `files-core-stability` 反模式：renderer 不得为搜索递归 list 整树  
- `Cmd+P` 快速打开尚未交付，与树搜索无共用索引  

用户期望：搜 `theme.ts` 能稳定命中 `code-mirror-editor-theme.ts`；树搜索与快速打开同一套路径索引与排序。

## 2. 目标

1. 主进程提供 **可取消的路径查询**，按 root 枚举相对路径并返回 top-K 排序结果。  
2. **`Cmd+P` / `pier.files.quickOpen`** 异步 quick pick 消费该查询。  
3. **侧栏树搜索** 改走同一查询：结果层虚拟展示，**不再**为搜索递归加载整树。  
4. 选中结果后：打开/激活文件，tree store **只**加载目标祖先链并 reveal。  
5. 快速输入：旧查询取消，无旧 batch 闪回。  

### 非目标

- 项目内容搜索（`Cmd+Shift+F`、行命中、正则引擎打包）  
- 跨窗口 / 跨重启 Files MRU  
- 复用命令面板 action MRU  
- 系统 `rg`/`find` PATH 依赖  
- `.cursorignore` 等 Agent 检索规则  
- 把搜索索引绑到 `projectId` 注册表  

## 3. 架构

```text
┌─────────────────┐   ┌──────────────────┐
│ Tree search UI  │   │ Cmd+P Quick Open │
└────────┬────────┘   └────────┬─────────┘
         │ owner: tree-search  │ owner: quick-open
         ▼                     ▼
      files path ranking (renderer) + MRU hints (window/root, ≤100)
         │
         ▼
   context.files.queryPaths / IPC FILE_QUERY_*
         │
         ▼
   main FileQueryService (path mode)
         │ walk + exclude + optional gitignore
         │ score + merge MRU + top 200
         ▼
   directed events: started → batch* → done|error
```

原则：

- **发现在 main，展示在 renderer**  
- tree store 只服务导航/编辑，不服务全量搜索索引  
- 查询会话按 `webContents.id + owner + queryId` 隔离  

## 4. 主进程路径查询

### 4.1 契约（新建 `src/shared/contracts/file-query.ts`）

```ts
type FilePathQueryRequest = {
  queryId: string;
  owner: string; // e.g. "quick-open:<sessionId>" | "tree-search:<instanceId>"
  root: string;  // projectRootPath / 规范化绝对路径
  query: string; // 原始输入；main 负责 normalize
  limit?: number; // 默认 200，硬顶 200
  mruPaths?: readonly string[]; // ≤100，相对 root 的提示
  options?: {
    applyGitIgnore?: boolean; // 默认 true
    applyExcludePatterns?: boolean; // 默认 true
    excludePatterns?: string; // 多行 glob；缺省用 Files 树默认 exclude
  };
};

type FilePathQueryItem = {
  path: string; // root 相对，posix
  score: number;
  // 可选：match ranges 供高亮（v1 可后置）
};

type FileQueryEvent =
  | { kind: "started"; queryId: string }
  | {
      kind: "batch";
      queryId: string;
      items: readonly FilePathQueryItem[];
      // path 模式：batch 可只发一次最终 top-K，或增量 refine
    }
  | {
      kind: "done";
      queryId: string;
      reason: "completed" | "cancelled";
      truncated: boolean;
      scanned: number;
      elapsedMs: number;
    }
  | { kind: "error"; queryId: string; code: string; message: string };
```

IPC（独立通道，不塞巨型数组进单次 command）：

- `PIER.FILE_QUERY_START`  
- `PIER.FILE_QUERY_CANCEL`  
- `PIER.FILE_QUERY_EVENT`（定向 sender）  

权限：start 前 assert `file:read`。

### 4.2 枚举与排除

- 从 `root` 深度优先或宽度优先 walk（实现选稳定可测的一种，推荐 BFS）。  
- 默认排除与 Files 树一致：`**/.git`、`**/.hg`、`**/.svn`、`**/CVS`、`**/.DS_Store`、`**/Thumbs.db`。  
- `applyExcludePatterns` 时合并用户 `pier.files.tree.excludePatterns`。  
- `applyGitIgnore` 时尊重仓库 ignore（与树「显示 git ignored」策略解耦：搜索默认隐藏 ignored，除非显式关闭）。  
- 符号链接：不跟随出 root；环检测。  
- 保护：最大扫描路径数、最大耗时、单次 batch 条数；超限 `truncated: true` 仍 `done`。  

v1 **不强制**长生命周期 path cache。若后续性能证据需要，仅允许「规范化 root + 短 TTL 内存缓存」，**禁止** projectId 注册表。

### 4.3 匹配与排序

对每个相对 path：

1. `normalizeQuery`：trim、`\`→`/`、lower-case。  
2. 空 query：可返回按 MRU + 路径深度的默认 top-K，或空列表（Quick Open 与树搜索统一：**空 query 显示 MRU 优先的最近路径**，无 MRU 则浅路径优先）。  
3. 匹配：至少支持  
   - 全 path 子串（保证 `theme.ts` ⊆ `code-mirror-editor-theme.ts`）  
   - basename 优先加权  
4. 得分（与 files-core-stability 一致方向）：  
   - basename 连续命中 > path 连续命中  
   - 命中位置靠前更好  
   - 路径更浅略加分  
   - MRU 命中加权（仅窗口内、按 root）  
5. 只返回 top `limit`（默认 200）。  

**禁止**把未截断的全量路径数组丢给 renderer。

### 4.4 取消与生命周期

- 同 sender + 同 owner 新 start → 取消旧 query。  
- cancel 幂等；取消后不得再发 batch。  
- 每个 query 恰好一个 `done` 或 `error`。  
- `webContents` destroyed / navigate → 取消该 sender 全部 path query。  
- Quick Open 与树搜索 **不同 owner**，可并行。  

## 5. Renderer：排序提示与打开

### 5.1 路径 ranking 模块

`files-path-ranking.ts`（纯函数，可单测）：

- 也可在 main 实现完整打分；若 main 已打分，renderer 只做展示稳定排序（score desc, path asc）。  
- 单测锁定：`theme.ts` 对 `code-mirror-editor-theme.ts` 的命中与相对 `workspace-theme.ts` 的合理排序。  

### 5.2 MRU

`files-quick-open-mru.ts`：

- 内存、按 `root` 分桶、最多 100 条  
- 打开成功文件时记录  
- 查询时作为 `mruPaths` 提示发给 main  
- **不**持久化、**不**跨窗口  

### 5.3 打开结果

复用现有 files 打开语义：

- 当前 group 同源标签  
- `reveal` 仅 `load` 祖先链 + 目标文件，不预载兄弟大目录  

## 6. 入口行为

### 6.1 快速打开

- 命令：`pier.files.quickOpen`  
- 默认快捷键：`Cmd+P` / `Ctrl+P`（与现有 keybinding 表对齐，冲突时以 files 计划为准并更新文档）  
- 无 `projectRootPath`：可见空态说明，不发起 walk  
- 使用扩展后的异步 quick pick：  
  - `onQueryChange(query, signal)` 防抖 start/cancel  
  - loading / error / truncated 可见  
  - 列表虚拟化；DOM 候选 ≤ 200  
- 接受项：打开文件并更新 MRU  

### 6.2 树内搜索

- 保留侧栏搜索条与 `pier.files.treeSearch` 及 **`PierFileTree` 现有搜索 UI**（`setSearch` / hide-non-matches / 匹配导航）。
- **删除/收缩** `files-tree-search-loader` 的「为搜索灌整树」职责。
- **禁止** 自绘独立结果列表替换树（曾推荐的「路径结果列表」层已作废）。
- 有 query 时：同一 path query → 将 top-K 命中 **物化** 进 tree store（命中路径 + 祖先链目录 load）→ `setSearch(query)`。
- 选择结果：既有树打开 + reveal 祖先链。
- loading 文案保留「正在搜索…」；完成前不得声称「无结果」除非已 `done` 且 items 空。
- 匹配计数 = path query top-K（截断时 `200+`）。
- 细则：`docs/superpowers/specs/2026-07-18-files-tree-search-path-query-keep-tree-ui-design.md`。

### 6.3 与 Pierre 内置搜索关系

- **主发现引擎** 是 FileQuery（main path walk + 打分），不再为搜索递归 list 整树。
- Pierre `setSearch` **仍负责树内展示壳**（hide-non-matches、焦点匹配）；其 includes 作用在「已物化的命中集 + 当前已加载子树」上，而不是全仓 path set。

## 7. 异步 Quick Pick 宿主扩展

按 files-core-stability 任务 8：

- 扩展 quick pick facade：`onQueryChange`、`AbortSignal`、loading/error、`update`/`close`  
- 实现独立适配模块；`host-context` 只组装  
- 使用现有 `replaceQuickPick` 保输入与焦点  
- **不**新建第二套全局键盘系统  

## 8. 错误与反馈

| 情况 | 反馈 |
|---|---|
| 无 project root | 空态文案，不 toast |
| 查询失败 | 短错误 toast 或结果区 error；有技术详情用 `showAppAlert` |
| 截断 | 结果区提示「结果已截断」 |
| 取消 | 静默，无错误 toast |
| 打开失败 | 既有 files 打开错误路径 |

禁止：仅 `console.error` 的静默失败。

## 9. 测试

### 单测

- contract schema：start/cancel/event  
- FileQueryService：  
  - `theme.ts` 命中 `.../code-mirror-editor-theme.ts`  
  - 同 owner 新查询取消旧查询  
  - cancel 后无 batch  
  - exclude / gitignore 开关  
  - limit 截断  
- path ranking / MRU 合并  
- 树搜索 hook：不调用整树 loader；选中只请求祖先链  

### 组件

- 树搜索：无结果层组件；path query 物化后 `setSearch`；无整树 list

### 非目标测试

- 内容搜索、跨 arch 打包 rg 二进制（任务 6/9）  

## 10. 分阶段交付

| 阶段 | 交付 | 验收 |
|---|---|---|
| P0 | path query IPC + service + ranking 单测 | 固定夹具仓库下 `theme.ts` 命中目标文件 |
| P1 | async quick pick + `Cmd+P` | 不灌整树；top ≤200 |
| P2 | 树搜索改接 path query 并 **保持 PierFileTree UI**；移除整树 search loader 与结果层 | 搜 `theme.ts` 在树内稳定命中目标文件；store 不因搜索整树暴涨 |

P0→P2 可同一 PR 串行，但测试与回滚点按阶段切。

## 11. 风险

| 风险 | 缓解 |
|---|---|
| 大仓库首次 walk 仍慢 | 分批事件 + 截断 + 不阻塞 UI；后续再议 TTL cache |
| 异步 quick pick 与现有静态 pick 混用 | 独立适配层，明确 loading 会话状态机 |
| 树搜索误做成独立结果列表 | 以 2026-07-18 keep-tree-ui spec 返工；物化 + setSearch |
| 与未做内容搜索的 API 形状冲突 | path 请求/事件字段命名可扩展，但不实现 content mode |

## 12. 成功标准

1. 在 pier 仓库搜 `theme.ts`，结果含  
   `src/plugins/builtin/files/renderer/code-mirror-editor-theme.ts`（查询 `done` 后稳定存在）。  
2. 搜索过程 **不会** 把 `src/plugins` 整棵递归进 files tree store。  
3. `Cmd+P` 与树搜索对同一 query 的 top-K **路径集合**一致（展示形态可不同：quick pick vs 树内过滤）。  
4. 快速连打字无旧结果闪回。  
5. 无 `projectRootPath` 时两入口均有明确空态。  

## 13. 与既有文档关系

- 本 spec 是 `2026-07-10-files-core-stability` **任务 7（path 子集）+ 任务 8** 的可实施收窄版。  
- 任务 7 的 **content 查询**、任务 6 搜索运行时打包、任务 9 内容搜索面板 **不在本 spec 范围**。  
- 实施时若与总计划字段名冲突，以本 spec 的 path-only 契约为准，并向总计划回写差异。  
- **树搜索 UI 修正**：`2026-07-18-files-tree-search-path-query-keep-tree-ui-design.md` 覆盖 §6.2 原「独立结果列表」推荐。  
