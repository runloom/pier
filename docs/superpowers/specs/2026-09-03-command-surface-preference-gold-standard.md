# 跨表面偏好分工金标准

日期：2026-09-03  
状态：现行权威（创建 / 找回 / 增强输入 / 右键 / 设置的偏好与排序内核）  
范围：命令面板、新建菜单（`+` / `⌘N`）、增强输入 `/` `@` `#` 建议、右键、设置 → 智能体的偏好归属与底层函数单源。  
不包含：分组标题门槛（见命令列表分组标题金标准）、右键组名与槽位（见右键菜单顺序金标准）、弹窗勾选记忆（见 AGENTS.md 弹窗表单规范）、文件路径打分细节（见 2026-07-17 path query 设计）。

相关：[`2026-09-02-command-list-heading-gold-standard.md`](./2026-09-02-command-list-heading-gold-standard.md)、[`2026-08-31-context-menu-order-gold-standard.md`](./2026-08-31-context-menu-order-gold-standard.md)、[`2026-07-17-files-path-query-and-quick-open-design.md`](./2026-07-17-files-path-query-and-quick-open-design.md)、[`2026-09-03-overlay-separator-gold-standard.md`](./2026-09-03-overlay-separator-gold-standard.md)。  
[`2026-06-23-command-palette-mru-design.md`](./2026-06-23-command-palette-mru-design.md) 只保留持久化与 frecency 公式；**组间双层 MRU 排序已作废**。

权威实现：`presentCommandListGroups`、`rankSearchDocuments` / `rankActionsForPalette`、`usageFrecency`、`scoreFilePath`。  
检查点：`tests/unit/renderer/command-surface-preference-governance.test.ts`、`tests/component/workspace/create-menu-preference.test.tsx`、`tests/unit/renderer/terminal/composer-skill-suggest.test.ts`、`tests/unit/renderer/agent/start-actions.test.ts`。

---

## 一句话终态

显式控制改目录；隐式学习只做副本；空间菜单位置永不漂。创建走稳定目录，找回走最近，对象操作走右键，工具箱裁剪走设置。有 query 的命令 / 技能 / 动作列表必须调用同一套 `rankSearchDocuments`，禁止再写一份 `includes` 保序。

---

## 四种偏好

1. **A 热路径。** 默认智能体、快捷键。设置里显式选；Auto 才用 `rankAgents` 的 frecency 决定那一个默认。新建菜单用快捷键 + 「默认」标记表达，**不改排序、不置顶**。
2. **B 目录裁剪。** `disabledAgentIds`。只在设置写入。拥挤的创建面必须能跳到设置（「管理智能体…」）。
3. **C 习惯副本。** `command-palette-mru.json`。只给命令面板空态「最近」（最多 8 条副本）和命令/技能搜索的同分。新建菜单 / 右键 / 空 `/` 不读来排序。
4. **D 情境一次。** 跟这次快照绑定的勾选，不落盘（弹窗表单规范）。

---

## 算法三层（法律一致，空态分叉）

1. **公式层。** 衰减只走 `src/shared/frecency.ts` 的 `usageFrecency`（14 天半衰期）。禁止第二套 `0.5 **`。
2. **搜索内核（有 query）。** 命令 / 技能 / 动作只走 `rankSearchDocuments`：标题/别名主带 > 分类等次带 > frecency 同分 > fuzzy 名次。Action 表面经 `rankActionsForPalette` → `buildActionSearchDocument`。增强输入 `/` 经薄适配把 skill 收成 `SearchDocument`（`kind: "suggest"`），再调同一函数。
3. **空态政策。** 命令面板与新建菜单共用 `presentCommandListGroups`：面板 `recentsLimit: 8`，新建菜单 `0` 且 `foldRemainderInto: workspace`（工作区展示组见分组标题金标准）。空 `/` 是领域目录（内置命令优先，再 skill，各组 id 序），不是命令面板最近块。右键无搜索、无 MRU。

领域打分器可换、优先级不可换：文件路径只走 `scoreFilePath`（Cmd+P / 树搜索 / `@` 已共用），禁止把路径塞进命令标题 uFuzzy。

---

## 底层函数单源

适配器只把领域对象收成 document，不重写 compare。

| 用途 | 唯一实现 | 调用方 |
|------|----------|--------|
| 命令/技能/动作有 query | `rankSearchDocuments` | 命令面板、新建菜单（经 `rankActionsForPalette`）、增强输入 `/` |
| 命令面板 + 新建菜单空态 | `presentCommandListGroups` | 两处只改 `recentsLimit` / `itemCompare` / `categoryOrder` / `foldRemainderInto` |
| 衰减 | `usageFrecency` | 命令 MRU、`rankAgents` |
| 文件路径 | `scoreFilePath` / `fileQuery` | Cmd+P、树搜索、`@` |

禁止：把 skill 伪造成 `Action`；把 `presentCommandListGroups` 套到 `/` 弹出层；为「看起来一致」再抄一份 ranker。

附件 `#` 是会话内短列表，保持本地 filter，不进搜索内核、不接 MRU。

---

## 表面分工

- **快捷键：** 只承载 A。
- **新建菜单：** 稳定目录 + 搜索内核；默认项标记；底部「管理智能体…」（非 cmdk item，先关 Popover 再 `openSection("agents")`）。不设最近。第一项永远「新建终端」。
- **命令面板：** 最近副本 + 稳定目录 + 搜索内核。不挂「管理智能体…」（已有打开设置）。
- **增强输入 `/`：** 空 query 稳定目录；非空 query 走 `rankSearchDocuments`。不套命令最近块，不新建 skill MRU 账本（v1 frecency=0，只比匹配）。
- **增强输入 `@`：** `scoreFilePath`。
- **右键：** 固定组序，不做 MRU。
- **设置 → 智能体：** 写 A / B。

空态默认高亮 = 该表面第一项。禁止「记住上次选中行」。

---

## v1 产品条款

1. 新建菜单 Popover 在 `Command` 外、列表滚动区下固定「管理智能体…」。不进 action registry、不进最近、不参与默认高亮。无智能体时也显示。页脚与列表的分割线贴齐弹层壳（见浮层分割线金标准），禁止收成行高亮宽。
2. 当前默认智能体的 `pier.agent.start.*` 设 `metadata.defaultAffordance: true`。`ActionCommandItem` 在标题与快捷键之间用 `@pier/ui/badge` `variant="outline"` `size="xs"` 显示「默认」。不写进 `title()`。命令面板同一行也显示（A 全局）。禁止 Star / StatusIcon / 置顶。
3. `filterComposerSkillSuggestItems` 非空 query 必须调用 `rankSearchDocuments`。

---

## 明确不做

- 新建菜单「最近」块 / `recentsLimit > 0`
- 组内或组间 frecency 重排、按使用隐藏条目
- 钉选、拖拽重排、默认项置顶
- 打开时高亮上次启动的智能体
- 6–10 项收进「启动智能体」子菜单
- 第三套命令偏好 store
- 增强输入 `@` 改用命令 uFuzzy；空 `/` 套命令面板最近
- 附件 `#` 接 frecency
- 2026-06-23 组间双层 MRU 排序

---

## 文案

| key | zh-CN | en | ja | ko |
|-----|-------|----|----|-----|
| `workspace.addPanelMenu.manageAgents` | 管理智能体… | Manage Agents… | エージェントを管理… | 에이전트 관리… |
| `commandPalette.action.defaultAgentMark` | 默认 | Default | デフォルト | 기본 |
