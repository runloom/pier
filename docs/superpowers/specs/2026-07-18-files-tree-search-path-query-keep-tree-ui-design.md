# 文件树搜索：路径查询物化进现有树 UI

Date: 2026-07-18  
Status: draft for review  
Scope: 修正 `2026-07-17-files-path-query-and-quick-open` 中 **侧栏树搜索展示** 的实现偏差。  
前置：主进程路径查询、IPC、client、Cmd+P 快速打开仍有效；本 spec 只改树搜索接法。

## 1. 问题

已交付的树搜索（Task 7）在侧栏上盖了一层自绘结果列表（`FilesTreeSearchResults`），用独立列表替代 `PierFileTree` 的搜索展示。

这与产品意图不符：

- 任务是 **优化搜索发现逻辑**（去掉整树递归 `files.list` + 仅靠已加载路径的 `includes`），不是重做树搜索 UI。
- Cmd+P 正确复用了命令面板 quick pick；树搜索应同样复用 **现有** `FilesSearchBar` + `PierFileTree`。
- 原设计 §6.2 写过「推荐独立结果列表」，该推荐 **作废**，以本 spec 为准。

## 2. 目标

1. 侧栏搜索条与 `PierFileTree` 的交互壳 **不变**（打开/关闭搜索、输入、`setSearch` / hide-non-matches、上下匹配、Enter 打开）。
2. 发现改走与 Cmd+P **同一** path query（`owner: tree-search:<instanceId>`）。
3. 查询结果 **物化** 进 tree store（命中路径 + 祖先链），再 `treeApi.setSearch(query)`，让现有树 UI 展示命中。
4. **禁止** 为搜索再跑 `loadFilesTreeForSearch` 式整树 BFS list。
5. 删除结果层组件与侧栏覆盖层逻辑。

### 非目标

- 不改 Cmd+P / 异步 quick pick 宿主（除非为共享物化 helper 的纯抽取）。
- 不改 Pierre 内核匹配算法（仍为 path includes；命中集合由 path query + 物化保证）。
- 不做内容搜索、不引入第二套列表 UI、不扩展 `@pier/ui` 外部 match set API（若后续需要另开 spec）。

## 3. 架构

```text
FilesSearchBar  (保留)
      │
      ▼
useFilesTreeSearch
      │ path query client (owner: tree-search:<id>)
      ▼
main FileQueryService → top-K items
      │
      ▼
materializePathQueryHits(root, items, list)
  · ensureAncestorDirectoryEntries
  · 仅沿祖先 loadFilesTreeDirectory（不整仓 BFS）
      │
      ▼
PierFileTreeApi.setSearch(query)   // 现有树 UI
      │
Enter / 打开 → 既有 onOpenFile + reveal
```

原则：

- **发现在 main，导航壳在现有树**。
- tree store 只为命中集服务有界增长（≤ top-K 相关节点），不为全仓索引服务。
- 与 Cmd+P 共享 ranking / exclude / MRU 语义；仅展示密度不同。

## 4. 行为细则

### 4.1 打开搜索

- 仍走 `openFilesTreeSearch` / 搜索条；`open === true` 时显示 `FilesSearchBar`。
- **始终渲染** `PierFileTree`（或空/错/加载态的现有 content），**不再** `showResultLayer` 替换树。

### 4.2 有 query

1. debounce 后 `client.search({ owner, root, query, excludePatterns })`。
2. 收到 batch/done 的 items：调用物化 helper。
3. 物化完成后 `setSearch(query)`（与输入一致的 normalize 由 main/client 负责；树侧传当前搜索框值即可，与现网一致）。
4. `loading`：path query `status === "loading"`；文案「正在搜索…」。
5. **完成前** 不得以「无匹配」空态结束；仅 `done && items.length === 0` 时依赖 Pierre 空匹配 + 搜索条计数 `0`。
6. `truncated`：匹配计数展示 `200+`（或现有 i18n），不另做结果层横幅也可——优先复用搜索条 `matchText`。

### 4.3 空 query

与 Cmd+P 对齐：

- 仍可发起 path query（空 query → MRU / 浅路径 top-K）。
- 物化这些路径后：若产品上「空串不 hide-non-matches」，则 `setSearch(null)` 并仅保证 MRU 路径在树上可导航；若现网空串会 `setSearch("")` 过滤，则保持与 `useFileTreeSearch` 旧行为一致。  
  **实现锁定**：对照 `packages/ui` 的 `useFileTreeSearch`——空/whitespace 时 `setSearch(null)`，非空才 `setSearch(query)`。本修正遵循该行为：空 query 可后台 path query 预热/物化，但 **不** 进入 hide-non-matches。

### 4.4 选中与打开

- 上下匹配 / Enter：继续 `treeApi.focusSearchMatch` / `activateFocusedSearchMatch`（由 `useFileTreeSearch` 或等价封装）。
- 打开文件：既有 sidebar `onOpenFile`；祖先应已物化，`revealPath` 可用。
- 记录 MRU：打开成功路径时 `recordFilesPathMru`（与 Cmd+P 一致）。

### 4.5 关闭搜索

- `setSearch(null)`，取消 path query session。
- **不**要求卸载已物化节点（避免抖树）；与「搜索不应暴涨 store」的验收以「不再整树 list」为准。

### 4.6 排除与 gitignore

- 请求带上 `pier.files.tree.excludePatterns` 全量字符串（与 57c86171 修正一致）。
- `applyGitIgnore` 默认 true，与 Cmd+P 一致。

## 5. 物化 helper

建议新文件（名可微调）：

`src/plugins/builtin/files/renderer/files-path-query-materialize.ts`

```ts
async function materializePathQueryHits(input: {
  root: string;
  paths: readonly string[];
  list: FilesTreeList;
  signal?: AbortSignal;
}): Promise<void>
```

规则：

- 对每个 path：`ensureAncestorDirectoryEntries(root, path)`。
- 对每个祖先目录：若尚未 loaded/empty，则 `loadFilesTreeDirectory(root, ancestor, list)`。
- **禁止** 发现队列式 BFS 扫全仓。
- 支持 `AbortSignal`：新 query 或关闭搜索时中止未完成物化。
- 并发：可对多个 hit 的祖先 load 做有限并发（例如 8），但不得演化成整树 loader。

命中文件本身：若父目录 load 后 list 结果已含该 file entry，则无需额外 inject；若 list 被 visibility 滤掉，应保证 path query 已按同一 exclude 过滤，正常应可见。

## 6. 删除清单

| 项 | 动作 |
|----|------|
| `files-tree-search-results.tsx` | 删除 |
| `file-tree-sidebar.tsx` 结果层覆盖 / `invisible` 树挂载 hack | 恢复为单一 `content` 树渲染 |
| `use-files-tree-search.ts` 的 `showResultLayer` / 自绘列表状态机 | 改为 path query + 物化 + `useFileTreeSearch`/`setSearch` |
| 依赖结果层 testid 的测试 | 改为断言树内 / `setSearch` / 无整树 list |
| `loadFilesTreeForSearch` | 保持删除或 hard-fail stub（不得再被搜索调用） |

## 7. 与原 design 关系

- `2026-07-17-files-path-query-and-quick-open-design.md` §6.2 / §6.3 / 风险表中「独立结果列表」**superseded by this doc**。
- 成功标准 1–5 仍成立；第 3 条「UI 展示密度不同」改为：Cmd+P 为 quick pick 列表，树搜索为树内 hide-non-matches，**排序与 top-K 集合一致**。
- Status of 2026-07-17 doc：改为 `accepted / partial`（Cmd+P 与 path query 已落地；树搜索展示需按本 spec 返工）。

## 8. 测试

### 单测

- `materializePathQueryHits`：只 load 祖先目录；不出现兄弟大目录全扫。
- `useFilesTreeSearch`：不调用整树 loader；query `theme.ts` 后对 mock treeApi `setSearch` 被调用；命中路径进入 store。
- 新 query abort 旧物化 / 旧 query。

### 组件

- 搜索打开时 **存在** `data-slot="pier-file-tree"` 且 **不存在** `files-tree-search-results`。
- 无整树递归 list；`theme.ts` 相关打开路径仍走 `onOpenFile`。

### 回归

- Cmd+P、path query client、excludePatterns、`preserveItemOrder` 套件保持绿。

## 9. 风险

| 风险 | 缓解 |
|------|------|
| 物化后 `setSearch` includes 与 main 打分不完全同构 | top-K 已由 main 截断；树上顺序以 Pierre 导航为准，**集合**与 Cmd+P 对齐即可 |
| 祖先 `list` 仍带入同目录兄弟 | 可接受；有界于命中路径深度，远小于整树 |
| sidebar 行数贴 500 上限 | 删除结果层后应回落；逻辑尽量放进 hook/helper |

## 10. 成功标准

1. 侧栏搜索 **没有** 独立结果列表组件。
2. 搜 `theme.ts` 时现有树 UI 能稳定暴露  
   `src/plugins/builtin/files/renderer/code-mirror-editor-theme.ts`（通过 setSearch 命中集 / 打开）。
3. 搜索过程 **不会** 递归 list 全仓进 store。
4. 与 Cmd+P 同一 query 的 top-K **路径集合**一致（允许展示形态不同）。
5. 快速输入无整树 load 风暴；旧 query/物化可取消。
