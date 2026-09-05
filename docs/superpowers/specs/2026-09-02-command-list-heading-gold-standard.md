# 命令列表分组标题金标准

日期：2026-09-02  
状态：现行权威（空态分组标题）  
范围：命令面板空态（无查询）与新建菜单空态（`+` / `pier.panel.openCreateMenu`）的分组标题、分隔和顺序。  
不包含：有查询时的搜索结果、Quick Pick 的 section、右键菜单、应用菜单、设置 → 快捷键页。

相关：右键仍以 [`2026-08-31-context-menu-order-gold-standard.md`](./2026-08-31-context-menu-order-gold-standard.md) 为准（分隔线、位置稳定、不用频次热排）。本文不把标题加回右键。最近块归属、搜索内核复用与新建菜单「管理智能体…」以 [`2026-09-03-command-surface-preference-gold-standard.md`](./2026-09-03-command-surface-preference-gold-standard.md) 为准。发丝线怎么画以 [`2026-09-03-overlay-separator-gold-standard.md`](./2026-09-03-overlay-separator-gold-standard.md) 为准。

权威实现：`src/renderer/lib/command-palette/present-groups.ts`。  
渲染：`CommandsView`（`src/renderer/components/common/command-palette/action-rows.tsx`）。新建菜单与命令面板空态都必须调用它，禁止再各写一套 `CommandGroup heading={categoryHeading(...)}`。

检查点：`tests/unit/renderer/command-list-group-heading-governance.test.ts`、`tests/unit/command/present-groups.test.ts`。

2026-09-05 重设计提案见 [工作台体验与人体工程学](./2026-09-03-workbench-ux-and-ergonomics-design.md) §5 / §9.1：将新建菜单收为「开始」，工具视图另有可见入口；默认快捷动作、提供方二级目录、工作树启动与插件面板归属的字符稿和迁移约束已在同文说明。该提案待实施，届时须明确替换本文的新建菜单内容 / 顺序政策并同步治理；当前正文仍是实现基线。共享 CommandsView、标题门槛、固定排序、搜索内核保留，不能另写菜单绕过。

---

## 一句话终态

命令列表里，**标题只表示「这一块有多条同类命令」**。标题门槛、合并规则和 `CommandsView` 两入口同构。新建菜单在运行 / 智能体之后把其余条目收成展示组「工作区」（`foldRemainderInto: workspace`）；命令面板仍按领域分桶。单项禁止写与条目同义的领域标题。使用频次只能出现在命令面板的「最近」块，禁止把整组提前。

---

## 原则

1. **标题门槛。** `heading` 当且仅当该展示组 `actions.length >= 2`。1 条一律 `heading: null`。禁止「工作树」+「新建工作树」这种同义标题。
2. **规则同一、入口同构。** 新建菜单与命令面板空态走同一个 `presentCommandListGroups` 和同一个 `CommandsView`。允许的分叉只有政策参数：命令面板 `recentsLimit: 8`，新建菜单 `recentsLimit: 0` 且 `foldRemainderInto: workspace`。禁止再发明第三套 band，也不把命令面板收成「工作区」。
3. **相邻无标题组合并。** 连续 `heading == null` 的分类组合并成一块，避免每项一个 `CommandGroup` 的内边距看起来仍是四组。
4. **分类顺序稳定。** 分类块按表面固定序，不按组内最高频次整组提前。组内也不按频次排。
5. **频次只进「最近」。** 仅命令面板空态有「最近」块（最多 8 条）。新建菜单列表短，**不设**「最近」。`excludeFromMru` 的命令不进「最近」。最近块里的命令仍出现在下面的分类块（目录完整性）。两行必须用不同的 cmdk value（`commandListItemValue(groupId, actionId)`），禁止都用 `action.id`。
6. **智能体子组。** `pier.agent.start.*` 在数量 ≥ 2 时从 `run` 抽出展示组 `agent`，标题用产品词「智能体」。1 条时仍留在 `run`。动作上的 `categoryKey` 仍是 `run`，不扩展 `ActionCategoryKey`。
7. **新建菜单工作区。** 运行 / 智能体以外的条目（新建标签、新建文件、新建工作树、新建窗口、任务跟踪等打开面板的命令）收成展示组 `workspace`，标题用产品词「工作区」。组内顺序：新建标签 → 文件 → 工作树 → 窗口 → 其余（插件面板）。动作上的 `categoryKey` 不变，不为插件加 `createMenuBand`。
8. **搜索与挑选不套本规则。** 有查询 → 一块「搜索结果」（1 条也保留该模式标题）。Quick Pick 的「当前窗口」等是内容标题，1 条也保留；空 section 仍不渲染。

---

## 算法

空查询列表只走 `presentCommandListGroups`：

1. **最近块（可选）。** `recentsLimit > 0` 时，在当前列表里取有 frecency、且 `excludeFromMru` 不为 true 的项，按分数降序截断。0 条则省略。标题：条数 ≥ 2 为「最近」，1 条为 `null`。该块永不与后面的分类块合并。若后面还有分类块，最近块 `separatorAfter: true`（渲染一条 `CommandSeparator`）。
2. **按 `categoryKey` 分桶**（`actionCategoryKey`）。
3. **智能体抽出。** 若 `pier.agent.start.*` ≥ 2：从 `run` 移出，形成 `agent`。插入位置紧跟非智能体的 `run`（排序键 = `run` 的 order + 0.5）。不足 2 条则留在 `run`。抽出后空的 `run` 不占位。
4. **新建菜单工作区折叠。** 仅当 `foldRemainderInto` 有值：把 `run` / `agent` 以外的桶合成一块，id 为该值（`workspace`），再按新建菜单组内序重排。命令面板不折叠。
5. **桶排序。** 命令面板用 `CATEGORY_META.order`；新建菜单会话块用 `CREATE_MENU_CATEGORY_ORDER` 的 run（agent 紧随其后）。未知分类走 `100 + CATEGORY_META.order`。
6. **桶内排序。** 命令面板：`sortOrder` 升序再 `id`。新建菜单：运行块为终端 → 智能体目录序 → 运行任务；工作区为新建标签 → 文件 → 工作树 → 窗口 → 其余。禁止组内 frecency。
7. **标题。** 每桶 `length >= 2` → 分类文案；否则 `null`。`agent` 用 `commandPalette.category.agent`；工作区用 `commandPalette.category.workspace`。
8. **合并。** 连续无标题的分类桶合成一块。最近块不参与合并。无标题桶不相邻（中间夹着有标题的组）时不跨组合并。

有查询不走本函数，仍是 `rankActionsForPalette` + `SearchResultsView`。

分类块之间不额外画分隔线，标题本身就是断点。

---

## 草图

`|` 表示最近块后的分隔线。无标题则条目顶格。

### 新建菜单 · 稀疏（无智能体）

```
运行
  新建终端
  运行任务…
工作区
  新建标签
  新建文件
  新建工作树
  新建窗口
```

无「运行任务」、运行块只剩新建终端时，该条无「运行」标题；工作区仍 ≥ 2 则有标题。

### 新建菜单 · 多个智能体

```
运行
  新建终端
  运行任务…
智能体
  启动 Claude
  启动 Codex
工作区
  新建标签
  新建文件
  新建工作树
  新建窗口
  任务跟踪
```

非智能体 `run` 若只剩 1 条，该条无「运行」标题，紧挨「智能体」块。任务跟踪与其它打开面板的插件命令放在工作区末尾，不另起「面板」组。

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

同一条「新建窗口」在命令面板仍没有「窗口」小标题；在新建菜单里出现在「工作区」下。

---

## 文案

| key | zh-CN | en | ja | ko |
|-----|-------|----|----|-----|
| `commandPalette.recent` | 最近 | Recent | 最近 | 최근 |
| `commandPalette.category.agent` | 智能体 | Agents | エージェント | 에이전트 |
| `commandPalette.category.workspace` | 工作区 | Workspace | ワークスペース | 워크스페이스 |

沿用现有 `commandPalette.category.*`。不要为新建菜单另做一套分类文案，也不要用「其他 / 面板 / 新建」当剩余块标题。

---

## 反例

- 四个单项各写一块「工作树 / 面板 / 文件 / 窗口」
- 把命令面板也收成「工作区」，或为插件加 `createMenuBand`
- 按组内最高频次把整块工作树顶到第一
- 剩余块标题用「其他 / 面板 / 新建」
- 把 window 并进 panel、worktree 并进 git 来消灭命令面板的单项组
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
