# 命令列表分组标题金标准

日期：2026-09-02  
状态：现行权威（空态分组标题）  
范围：命令面板空态（无查询）与新建菜单空态（`+` / `pier.panel.openCreateMenu`）的分组标题、分隔和顺序。  
不包含：有查询时的搜索结果、Quick Pick 的 section、右键菜单、应用菜单、设置 → 快捷键页。

相关：右键仍以 [`2026-08-31-context-menu-order-gold-standard.md`](./2026-08-31-context-menu-order-gold-standard.md) 为准（分隔线、位置稳定、不用频次热排）。本文不把标题加回右键。

权威实现：`src/renderer/lib/command-palette/present-groups.ts`。  
渲染：`CommandsView`（`src/renderer/components/common/command-palette/action-rows.tsx`）。新建菜单与命令面板空态都必须调用它，禁止再各写一套 `CommandGroup heading={categoryHeading(...)}`。

检查点：`tests/unit/renderer/command-list-group-heading-governance.test.ts`、`tests/unit/command/present-groups.test.ts`。

---

## 一句话终态

命令列表里，**标题只表示「这一块有多条同类命令」**。同一条命令在新建菜单和命令面板里，会不会套着领域小标题，只取决于「它所在的那一组这会儿有几条」，不取决于用户点的是 `+` 还是命令面板。单项禁止写与条目同义的领域标题。使用频次只能出现在命令面板的「最近」块，禁止把整组提前。

---

## 原则

1. **标题门槛。** `heading` 当且仅当该展示组 `actions.length >= 2`。1 条一律 `heading: null`。禁止「工作树」+「新建工作树」这种同义标题。
2. **规则同一、入口同构。** 新建菜单与命令面板空态走同一个 `presentCommandListGroups` 和同一个 `CommandsView`。禁止新建菜单另做 band 分类、命令面板另做标题政策。
3. **相邻无标题组合并。** 连续 `heading == null` 的分类组合并成一块，避免每项一个 `CommandGroup` 的内边距看起来仍是四组。
4. **分类顺序稳定。** 分类块按表面固定序，不按组内最高频次整组提前。组内也不按频次排。
5. **频次只进「最近」。** 仅命令面板空态有「最近」块（最多 8 条）。新建菜单列表短，**不设**「最近」。`excludeFromMru` 的命令不进「最近」。最近块里的命令仍出现在下面的分类块（目录完整性）。两行必须用不同的 cmdk value（`commandListItemValue(groupId, actionId)`），禁止都用 `action.id`。
6. **智能体子组。** `pier.agent.start.*` 在数量 ≥ 2 时从 `run` 抽出展示组 `agent`，标题用产品词「智能体」。1 条时仍留在 `run`。动作上的 `categoryKey` 仍是 `run`，不扩展 `ActionCategoryKey`。
7. **搜索与挑选不套本规则。** 有查询 → 一块「搜索结果」（1 条也保留该模式标题）。Quick Pick 的「当前窗口」等是内容标题，1 条也保留；空 section 仍不渲染。

---

## 算法

空查询列表只走 `presentCommandListGroups`：

1. **最近块（可选）。** `recentsLimit > 0` 时，在当前列表里取有 frecency、且 `excludeFromMru` 不为 true 的项，按分数降序截断。0 条则省略。标题：条数 ≥ 2 为「最近」，1 条为 `null`。该块永不与后面的分类块合并。若后面还有分类块，最近块 `separatorAfter: true`（渲染一条 `CommandSeparator`）。
2. **按 `categoryKey` 分桶**（`actionCategoryKey`）。
3. **智能体抽出。** 若 `pier.agent.start.*` ≥ 2：从 `run` 移出，形成 `agent`。插入位置紧跟非智能体的 `run`（排序键 = `run` 的 order + 0.5）。不足 2 条则留在 `run`。抽出后空的 `run` 不占位。
4. **桶排序。** 命令面板用 `CATEGORY_META.order`；新建菜单用 `CREATE_MENU_CATEGORY_ORDER`（run → panel → file → worktree → window）。未知分类走 `100 + CATEGORY_META.order`。
5. **桶内排序。** 命令面板：`sortOrder` 升序再 `id`。新建菜单：终端 → 智能体目录序 → 运行任务，再 `sortOrder` / `id`。禁止组内 frecency。
6. **标题。** 每桶 `length >= 2` → 分类文案；否则 `null`。`agent` 用 `commandPalette.category.agent`。
7. **合并。** 连续无标题的分类桶合成一块。最近块不参与合并。无标题桶不相邻（中间夹着有标题的组）时不跨组合并。

有查询不走本函数，仍是 `rankActionsForPalette` + `SearchResultsView`。

分类块之间不额外画分隔线，标题本身就是断点。

---

## 草图

`|` 表示最近块后的分隔线。无标题则条目顶格。

### 新建菜单 · 稀疏（无智能体）

```
新建终端
新建标签
新建文件
新建工作树
新建窗口
```

「运行」里同时有终端和运行任务时：

```
运行
  新建终端
  运行任务…
新建标签
新建文件
新建工作树
新建窗口
```

### 新建菜单 · 多个智能体

```
运行
  新建终端
  运行任务…
智能体
  启动 Claude
  启动 Codex
新建标签
新建文件
新建工作树
新建窗口
```

非智能体 `run` 若只剩 1 条，该条无「运行」标题，紧挨「智能体」块。

### 命令面板 · 空态

```
最近              ← ≥ 2 条才有标题
  （最多 8 条，按 frecency）
|
视图
  …
重置布局          ← 工作区仅 1 条，无「工作区」；若工作树也是 1 条则与它合并
工作树            ← ≥ 2 条才有标题
GIT
  …
运行
  …
智能体            ← 仅当启动项 ≥ 2
  …
面板
  …
新建窗口          ← 窗口仅 1 条，无「窗口」
设置
  …
文件
  …
```

同一条「新建窗口」在两个入口都没有「窗口」小标题。

---

## 文案

| key | zh-CN | en | ja | ko |
|-----|-------|----|----|-----|
| `commandPalette.recent` | 最近 | Recent | 最近 | 최근 |
| `commandPalette.category.agent` | 智能体 | Agents | エージェント | 에이전트 |

沿用现有 `commandPalette.category.*`。不要为新建菜单另做一套分类文案。

---

## 反例

- 四个单项各写一块「工作树 / 面板 / 文件 / 窗口」
- 只改新建菜单、命令面板仍按领域出单项标题
- 按组内最高频次把整块工作树顶到第一
- 新建菜单再发明 pane / run / workspace 三带，和命令面板分叉
- 把 window 并进 panel、worktree 并进 git 来消灭单项组
- 给 Quick Pick 的「当前窗口」套标题门槛（1 条也要留下）
- 有查询时按领域拆搜索结果
- 「最近」与分类里同一条命令共用 `action.id` 当 cmdk value（两行会一起高亮）

---

## 明确不做

- 不改 `ActionCategoryKey`，不为插件加 `createMenuBand`
- 不给 6–10 项做「新建…」子菜单
- 不改右键、应用菜单、设置快捷键列表
- 不改 `⌘N` 锚定 Popover、终端全屏 overlay、失败 `showAppAlert`、禁用态仍显示原因
- 新建菜单不设「最近」块
