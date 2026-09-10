# Mermaid 纸面着色金标准

日期：2026-09-10  
状态：现行权威（Markdown 围栏 mermaid、全屏预览、Canvas `Mermaid` 卡片）  
范围：official mermaid 11 闭集图种的默认铬如何映射到纸面语义令牌。  
不包含：Canvas `WorkflowDiagram` / `ScreenFlow`（见流程图金标准）、作者 `classDef` 语义色、闭集外图种的完整映射。`look: handDrawn` 由作者显式声明时保留，宿主不保证其填色。

颜色令牌所有权仍在 [`2026-09-09-color-token-gold-standard.md`](2026-09-09-color-token-gold-standard.md)。本文只拥有「第三方图默认铬 → 纸面令牌」这一张表。

---

## 一句话终态

作者只写 mermaid 语法。宿主用同一支 `themeCSS` 把闭集图种的默认铬映射到纸面语义令牌；流程图再开 `look: neo` 与 rounded 折线，镖是小 point 而不是 classic 大三角。暗色纸面不得再出现 mermaid `base` 的奶油底、近白分组盒、粉笔记或信息蓝边。作者 `classDef` 仍是内容色，继续赢。

## 终态表

| 属性 | 终态 |
|---|---|
| 引擎 | 单例 official mermaid **≥ 11.14**（neo 进 OSS；钉 11.16.x 与 Codex 同代），`theme: "base"` + `MERMAID_THEME_CSS`。`htmlLabels` 恒 true。禁止第二套引擎，禁止按纸面 / 图种重新 `initialize` |
| 色从哪来 | 只消费 `globals.css` 语义令牌。禁止往 `themeVariables` 写 CSS 变量（khroma 会解析色值并拒绝） |
| 闭集 | flowchart / graph、sequence、class、er、state、mindmap |
| 默认节点 | `--card` 底 + `--border` 边 + `--foreground` 字 |
| 分组盒 | `--secondary` 底 + `--border` 边 + `--foreground` 标题。含 flowchart `subgraph`、状态图 `.inner`、ER 关系标签底。不用 `--muted`（暗色上相对 `--background` 约 0.09 L，会消失） |
| 流程图外观 | `graph` / `flowchart` 默认 `look: neo` + `flowchart.curve: rounded`。时序 / 类 / ER / 状态 / 思维导图保持 classic。只在源上合并 `%%{init}%%`（插在 YAML 之后），禁止全局 `look: neo` |
| 默认连线 / 实心镖 | `--muted-foreground`（结构铬，与线同色）。流程图 neo 用 point 镖（`.arrowMarkerPath`），不是 classic 大三角。不是 `--status-info-fg` |
| 空心镖 | `fill: none`，`stroke: var(--muted-foreground)`。ER 乌鸦脚、类图继承 / 聚合。禁止对所有 `.marker` 实心填充 |
| 笔记 | `--secondary` 底（与时序图现状一致） |
| 思维导图分区 | 压成 `--card` / `--foreground` / 连线 `--muted-foreground`。不映射 `--chart-1..5` |
| 作者色 / look | `classDef` 在 themeCSS 之后追加 `!important`，仍然赢。不剥 `%%{init}%%`。作者已写 `look`（`%%{init}%%` 或 YAML `config.look`，含 `handDrawn` / `classic` / `neo`）则不覆盖 |
| 纸面 | 内联 SVG 继承 Markdown / 全屏 `data-color-mode` 的变量；换纸面靠变量，不靠重烤 hex |
| 字 | `--font-sans`，不吃阅读正文字体 |

## 硬规则

1. **规格先于补丁。** 闭集每个默认铬表面必须能在本文映射表里找到令牌；`MERMAID_THEME_CSS` 必须有对应选择器。禁止只修一只漏网形状。
2. **一张映射表。** 新增 mermaid 图种的默认铬必须先改本文，再改 CSS。
3. **选择器对着引擎，不靠猜。** 以 mermaid 11 的 `getStyles` 与一次真实 `renderMermaid` 的 SVG class 为准。
4. **文字规则与形状规则分开。** 禁止把 `.actor` 盒子和 `nodeLabel` 写在同一条 `fill` 里。
5. **镖分空心 / 实心。** 实心镖走 `marker path` / `.arrowheadPath` / `.arrowMarkerPath` / `.composition` / `.dependency`。空心镖按类型：`.extension` / `.aggregation` / `.onlyOne` / `.zeroOrOne` / `.oneOrMore` / `.zeroOrMore`，显式 `fill: none`，且必须盖过泛化的 `marker path`。禁止 `.marker { fill: none }`（mermaid 11.16 给每个镖都打 `class="marker"`，会掏空 neo point）。镖与线同色；不改 mermaid 镖宽高。
6. **themeCSS 只许语义令牌 + `!important`。** 禁止 hex / `rgb()` / `hsl()` 进 `MERMAID_THEME_CSS`。引擎里的 KaTeX `#000` 用 `currentColor` 盖掉。
7. **单例覆盖层。** Markdown 围栏、全屏、Canvas 卡片走同一 `renderMermaid`。禁止按纸面或图种重新 `initialize`。`htmlLabels` 恒 true。
8. **默认边不是状态色。** 无角色拓扑走 `--muted-foreground`。禁止 `--status-info-fg` / 其它 `status-*` 当 mermaid 默认边或镖。
9. **流程图才 neo。** `look: neo` 与 `curve: rounded` 只合并进 flowchart / graph 的 `%%{init}%%`。图种看 YAML / 指令剥掉之后的图头，不把 YAML 键 `flowchart:` 当成图种。作者已声明 `look`（`%%{init}%%` 或 YAML `config.look`）则不动。新指令插在 YAML 之后，避免 mermaid 的 `^---` 解析失败。禁止全局 `initialize({ look: "neo" })`。
10. **neo 镖停车。** 渲染后若 neo 实线仍用 4 段 `stroke-dasharray` 让镖，宿主只修实际带 `point*Margin` 的那一端的 `refX` 与 dash 间隙。缺 `marker-start` / `marker-end` 不加间隙。不改 path `d`。幂等。

## 闭集映射

选择器以 `packages/ui/src/mermaid/theme-css.ts` 的 `MERMAID_THEME_CSS` 为真源。下表是合同。

### 共用

| 表面 | 令牌 |
|---|---|
| `.node rect, .node circle, .node ellipse, .node polygon, .node path, .node .label-container, .node .basic` | 底 `--card`，边 `--border` |
| 默认字（`nodeLabel` / `edgeLabel` / 各图种 title 与 `tspan`） | `--foreground`，字体 `--font-sans` |
| 边标签底 | `--background`；`.edgeLabel rect` 透明（禁止粉胶囊） |
| `.flowchart-link, .edgePath .path, .relation, .relationshipLine, .transition, .messageLine0, .messageLine1, .actor-line, .loopLine, .edge` | 描边 `--muted-foreground`，`fill: none` |
| 实心镖：`.arrowheadPath, .arrowMarkerPath, marker path, .composition, .dependency` | 填 / 描 `--muted-foreground` |
| 空心镖：`.extension, .aggregation, .onlyOne, .zeroOrOne, .oneOrMore, .zeroOrMore`（含 path / polygon / circle） | `fill: none`，描边 `--muted-foreground` |

### flowchart

默认 `look: neo` + `curve: rounded`。neo 节点圆角用 `--radius`：`.node[data-look="neo"] rect { rx/ry: var(--radius) }`。

| 表面 | 令牌 |
|---|---|
| `.cluster rect, .cluster path` | `--secondary` / `--border` |
| `.cluster-label, .cluster text, .cluster span, .flowchartTitleText` | `--foreground` |
| neo 实心镖 `.arrowMarkerPath` / `pointEnd` | 填 / 描 `--muted-foreground` |

### sequence

| 表面 | 令牌 |
|---|---|
| `rect.actor` / `.note` / `.labelBox` | `--secondary` / `--border` |
| activation | `--muted` / `--border` |
| `#sequencenumber`（序号圆） | `--secondary` |
| `.sequenceNumber` 与 actor / note / loop 的 `tspan` | `--foreground` |

### class

| 表面 | 令牌 |
|---|---|
| `g.classGroup rect` | `--card` / `--border` |
| `g.classGroup text`、`.classLabel .label`、`.classTitleText` | `--foreground` |
| `.classLabel .box` | `--secondary` |
| `g.classGroup line` | `--border` |
| `<|--` 继承 / 聚合镖 | 空心 |
| `*--` 组合 / 依赖镖 | 实心 |

### er

| 表面 | 令牌 |
|---|---|
| `.entityBox`（mermaid 类名；不要求同时有 `er`） | `--card` / `--border` |
| `.relationshipLabelBox` | `--secondary` |
| `.relationshipLine` | `--muted-foreground` |
| 乌鸦脚 `.marker` | 空心 |

### state

| 表面 | 令牌 |
|---|---|
| `.statediagram-state rect` / `.statediagram-cluster rect` | `--card` / `--border` |
| `.statediagram-cluster .inner`、`.statediagram-cluster-alt .inner` | `--secondary` |
| `.statediagram-note rect` | `--secondary` |
| 起止圆（写在泛化 `.node circle` **之后**） | start / fork `--foreground`；end 外圈 `--foreground`；`.end-state-inner` `--background` |

### mindmap

| 表面 | 令牌 |
|---|---|
| `.mindmap-node` 几何与 `.section-root` 几何 | `--card` / `--border` |
| 分区文字 | `--foreground` |
| `.edge` / `[class^="section-edge-"]` | `--muted-foreground`，`fill: none` |

覆盖 mermaid `cScale*` / `git0` 烤色。本轮不把分区映射到 `--chart-1..5`。

### slotted Canvas 卡

`.pierSlot` 几何透明；Lucide path 继续 `fill: none; stroke: currentColor`。不得回退。

## 禁止

1. 只补 `.cluster rect` 却不锁闭集。
2. `theme: "dark"` 或按 `colorMode` 重新 `initialize`。
3. `themeVariables` 里写 CSS 变量或 hex 充当产品色。
4. 全局 `marker { fill: … }` 把空心镖涂实；`.marker { fill: none }` 把实心 point 掏空；用 `--status-info-fg` 或其它 `status-*` 当 mermaid 默认边 / 镖。
5. 文字与形状共用一条 `fill`（`.actor` 混进 `nodeLabel`）。
6. 为 gantt / pie / gitGraph / journey / kanban / C4 等闭集外图种另起引擎或 Empty。
7. 把 mermaid 默认铬的 hex 写进 `globals.css` 或 hex allowlist。
8. 全局 `initialize({ look: "neo" })`；为 neo 关掉 `htmlLabels`；按图种重新 `initialize`。
9. 升级到 mermaid 12（默认 ELK / redux，超出本对照）。

## 不是缺陷

- 作者 `classDef` / `class` 把节点或分组涂成高对比色。
- `%%{init: { flowchart: { defaultRenderer: "elk" } }}%%`。
- 闭集外图种在暗色纸面上仍偏浅色。
- 作者显式 `look: handDrawn`（rough.js 内联 fill，CSS 覆盖不保证）。
- neo 实线已不再写 4 段 dasharray 时，镖停车 helper 空转。
- 文案语义、图是否画对（语法错走现有失败 Alert）。
- Canvas `WorkflowDiagram` 的主 / 旁 / 返回 / 失败色义——那是另一支笔。

## 检查点

- `tests/unit/ui/mermaid-theme-governance.test.ts`
- `tests/unit/ui/mermaid-theme-closed-set.test.ts`
- `tests/unit/ui/mermaid-render.test.ts`
- `tests/unit/ui/mermaid-source-prepare.test.ts`
- `tests/unit/ui/mermaid-neo-markers.test.ts`
