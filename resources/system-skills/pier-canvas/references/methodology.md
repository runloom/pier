# Canvas methodology axes

Canvas is Pier's **product-core overview**. Methodology mode makes overviews
scannable and reproducible without inventing a second skill entry.

## Three axes

| Axis | Pack root | Question |
| --- | --- | --- |
| content | `packs/content/<id>/` | What must be written? |
| presentation | `packs/presentation/<id>/` | How is the overview navigated? |
| ui | `packs/ui/<id>/` | How is it drawn with `pier/canvas`? |

Do not mix axes:

- Content packs never prescribe Tab chrome.
- Presentation packs never invent domain fields missing from content.
- UI packs never change required content fields.

## Defaults

```text
content      = design-doc
presentation = resolved from content (see Pack selection)
ui           = pier-default
mode         = methodology
```

Bare `/pier-canvas` → `design-doc` + `decision_nav_4`.  
`content=closed-loop` with no presentation → `primary_nav_5`.

## Pack selection

Content decides the default presentation. Five-tab **Day 1** is not a universal
gold standard — it is the closed-loop / Day-1 recipe slot.

| Job | content | presentation | Tabs (en) |
| --- | --- | --- | --- |
| Architecture, RFC, product decision | `design-doc` | `decision_nav_4` | Overview → Problem → Design → Landing |
| Short BLUF | `design-doc` | `one_pager` | none (single scroll) |
| Runtime / CLI “tomorrow run these ≤4 commands” | `closed-loop` | `primary_nav_5` | Overview → Problem → Design → **Day 1** → Landing |

Rules:

1. **Do not** open a Day-1 / `path` tab unless `day1Commands` (≤4) or a copyable
   recipe exists. Migration phases belong on **Landing**.
2. **Day 1** is the English user-facing label for view id `path` (`i18n/nav.json`).
   Historical name 日路径 means the same slot; do not use it as a product term.
3. Presentation packs declare `fitsContent`; content packs declare
   `preferredPresentation`. Explicit `presentation=` still wins.
4. Industry design docs (Google Design Doc, RFC, ADR) have no Day-1 chapter.
   Getting-started / runbooks do. Match that split.

## Built-in packs (P0)

### content

- `design-doc` — goals / non-goals / design / alternatives + BLUF; preferred presentation `decision_nav_4`
- `closed-loop` — hard constraints, loops, day-1 commands, rails, acceptance; preferred presentation `primary_nav_5`

### presentation

- `decision_nav_4` — four tabs for design-docs (default)
- `primary_nav_5` — five tabs including **Day 1**; closed-loop only
- `one_pager` — single scroll, BLUF first

### ui

- `pier-default` — pier/canvas desktop-tool discipline

## Recipes (not methodology axes)

`packs/recipes/design` and the `pier.tasks` islands (`task-list`,
`task-dag`) are **freeform** starters (`recipe=` on `/pier-canvas`).
The project kanban is the plugin panel, not a canvas recipe. They do
not add a fourth axis, do not invent overview tabs, and do not replace
`design-doc` / `closed-loop`. See SKILL.md **Stage selection**.

## Resolve order

1. `.pier/canvas-packs/{axis}/{id}/pack.json` (project)
2. This skill's `packs/{axis}/{id}/pack.json` (built-in)

Missing id → hard fail.

## Overview obligations

1. First screen answers "what did we decide?" in under ~30 seconds of reading.
2. Exactly one primary view when using multi-view presentations.
3. ≤5 top-level navigation entries.
4. Implementation DAGs and research appendices are secondary.

## Expression selection（方案怎么表达）

Methodology overviews are **product design proposals**, not feature demos and
not acceptance-table dumps. Choose expression by job-to-be-done:

| 形态 | 何时用 | 长什么样 | 禁止 |
| --- | --- | --- | --- |
| **静态方案（默认）** | 决策、分层、落地（闭环才加首日配方） | BLUF + 对照表 + ≤1 主图 | 无洞见的 Play/Step、「演示感」空转 |
| **静态对照** | before/after、Do/Don't、旧误区 vs 新默认 | 双列表 / 双卡 / 默认对照表 | 用动画假装对比 |
| **短任务说明（可选）** | 需要「人手敲什么」 | 配方代码块 + 四命令表 | 冒充机制证明 |
| **机制交互讲解（例外）** | **仅当**不可见机制必须逐步展开，且每帧有洞见+图变 | 播放/单步 + 结构图状态变化 | CLI 导览高亮、无 before/after 的节点走马灯 |

### 硬规则

1. **默认静态。** `templates/overview.canvas.tsx` 与 closed-loop 金标路径不包含交互演示壳。
2. **不为「显得高级」加演示。** 若去掉播放控件后方案仍完整可读，就不要加播放控件。
3. **验收表不进首页。** C0–C10 / L0–L7 放落地（或实现）页；速览只放决策与路径。
4. **竞品与过程考古不进首页。** 附录或落地末尾。
5. **图必须服务洞见。** Mermaid 回答「分层/主环/状态」之一；禁止装饰性空图。
   分层/主环给每个节点 `kind`（人 / 智能体 / CLI·工具 / 画面·事实 / 产品外）。
   状态机、错误出口、交付完成态用 `tone`。不要用 `tone` 当角色色，不要画左色条。

### 与业界对齐（一句话）

- Explainer 动画适合抽象机制论文页，**不是** CLI harness 方案默认形态。
- 产品方案默认：**问题 → 决策 → 设计 → 形态 → 落地**。
- 真 UI/CLI 录屏若需要，放在仓外或单独资产；不要用假交互冒充。

## Recommended information architecture

### `decision_nav_4` (design-doc default)

| Tab id | Label | Role |
| --- | --- | --- |
| `overview` | `i18n/nav.json` | insight + decision (BLUF) + three summary cards |
| `problem` | `i18n/nav.json` | pains + anti-goals |
| `design` | `i18n/nav.json` | layers, alternatives, product frames |
| `landing` | `i18n/nav.json` | phases, acceptance, risks |

Start from `templates/decision.canvas.tsx`.

### `primary_nav_5` (closed-loop only)

| Tab id | Label | Role |
| --- | --- | --- |
| `overview` | `i18n/nav.json` | insight + decision (BLUF) + three summary cards |
| `problem` | `i18n/nav.json` | pains + anti-goals |
| `design` | `i18n/nav.json` | layers, settled/states, identity, hard constraints |
| `path` | `i18n/nav.json` | main path diagram + day-1 commands + recipe |
| `landing` | `i18n/nav.json` | defaults before→after, phases, acceptance, rails |

Start from `templates/overview.canvas.tsx`.

## Freeform recipes

`recipe=` is **not** a fourth methodology axis. Packs live under
`packs/recipes/` and force Workflow B (freeform). Known ids: `design`
(world mockup), `task-list` / `task-dag` (tracker islands in flow).
There is no canvas kanban recipe and no local `board.json` ledger.

## Entry

Only `/pier-canvas` (or `$pier-canvas`). Packs are resources, not extra slash
commands. CLI is not the product path for this protocol.
