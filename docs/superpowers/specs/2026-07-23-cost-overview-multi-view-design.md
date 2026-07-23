# 成本总览多视角设计

**日期**：2026-07-23  
**状态**：待用户审阅  
**范围**：宿主工作台 `core.cost-overview` 升级为可配置成本视角；沿用现有 `UsageAggregateSnapshot` 日聚合；自定义卡片与指标目录只做补充，不替代主路径  
**关联**：

- 调研结论：本会话（业界 Console / Grafana panel / 受治理自助分析对照）
- `docs/superpowers/specs/2026-07-09-workbench-professional-ux-gap-analysis.md`（工作台非 BI 边界）
- `docs/superpowers/specs/2026-07-10-workbench-responsive-ordered-grid-design.md`（物料 `params` 黑盒与多实例）
- `docs/design/codex-workbench-widgets.md`（成本色与图表原语约定）
- 实现锚点：`cost-overview-widget.tsx`、`core-metrics.ts`、`usage-data.ts`、`custom-card/*`

## 1. 目标与完成标准

把写死的成本总览卡升级为**受控的成本视角（Cost View）**：用户用预设和实例参数切换度量、分组、时间窗与主图形态；多实例可并排看不同角度。数据仍来自本机 AI CLI 会话日志的 API 等价成本聚合，不引入查询语言或全局筛选条。

完成标准：

- 默认参数下的视觉与信息架构与现网总览兼容（副标题 + KPI + 按来源堆叠柱 + 新鲜度 / 未完全计价）。
- 实例 `params` 可配置并随工作台布局持久化；非法字段 salvage，不拖垮面板。
- 纯函数 `costViewQuery(snapshot, params)` 是唯一派生入口；widget、设置预览、单测共用。
- 官方预设可一键套用；P0 至少覆盖总览、按来源、Token 趋势；P1 补按模型与来源过滤。
- 物料改为 `configurable: true` 且 `multiInstance: true`；设置走宿主物料设置弹窗。
- 不出现工作台级全局时间范围、跨卡筛选、自由钻取或 SQL。

## 2. 当前结构为什么不足

| 层 | 现状 | 缺口 |
| --- | --- | --- |
| UI | 固定 4 KPI + 仅按来源堆叠柱 | 无 params、无预设、不能换度量/时间窗/分组 |
| 数据 | 日桶、period `byModel`、分来源快照 | UI 只用了 overall + source 堆叠；模型与 token 分项未进主卡 |
| 指标目录 | `core.cost.*` 六个固定投影 | 可供自定义卡片，但拼不出「完整成本叙事」 |
| 产品边界 | 工作台明确非 BI | 需要多角度，又不能滑成 Explore |

根因：缺少一层在既有快照上的**视角模型**（度量 × 维度 × 范围 × 图类型），而不是缺图表库。

## 3. 非目标

- 工作台全局时间条、跨物料联动筛选、下钻 Explore。
- 任意日历范围、小时/会话级序列、自由 SQL / 查询语言。
- 模型 × 来源热力图（无日×模型矩阵前不做）。
- 把成本主路径沉到「自定义卡片」拼装；自定义卡片只服务单指标边角需求。
- 改定价所有权或让各源自报金额（仍：源报 token，宿主定价）。
- 为「像 Grafana」而引入 dashboard 变量体系。

## 4. 所有权划分

| 层 | 负责 |
| --- | --- |
| `usage-data` 契约与服务 | 日聚合快照、计价、广播；P2 才扩展 daily×model 等写盘结构 |
| `costViewQuery` | snapshot + params → 视图模型；无 React、无 I/O |
| `CostOverviewParams` | zod/salvage、预设模板、图类型兼容矩阵 |
| `CostOverviewWidget` | 订阅 store、渲染 KPI/主图/页脚、消费 `size` 做结构取舍 |
| 物料设置 | range / measure / groupBy / chart / kpis / sources / 套用预设 |
| 指标目录 `core.cost.*` | 保持固定投影供自定义卡片；P2 可与 query 共享截断逻辑，不阻挡 P0 |
| 宿主物料壳 | 多实例、设置弹窗、刷新 action spinner |
| 测试 | query 纯函数、params salvage、兼容矩阵、组件三态与预设 |

## 5. 推荐架构

采用**精简面板式成本视角**（对标 Grafana 单 panel 的受控配置，叙事密度对标 OpenAI / Claude Console），而不是 Metabase 式自助分析。

```text
UsageDataBridge / useUsageDataStore
        │
        ▼
UsageAggregateSnapshot（只读）
        │
        ▼
costViewQuery(snapshot, params)  ──纯函数──► CostViewModel
        │
        ├─► CostOverviewWidget（主路径）
        └─► 设置页预览（可选，P1）

params 随 workbench panel widget.params 持久化
preset 只是 params 模板，落盘仍是展开后的字段
```

### 5.1 与自定义卡片的分工

| 需求 | 路径 |
| --- | --- |
| KPI + 趋势 + 分布的完整成本叙事 | `core.cost-overview` 视角 |
| 只要单个「今日成本」或「模型榜」 | 自定义卡片 + `core.cost.*` |
| 并排两个不同角度 | 两个成本物料实例，不同 params |
| CPU 与成本拼一卡 | 自定义卡片（杂凑指标） |

## 6. 视角参数与视图模型

### 6.1 Params（物料黑盒）

```ts
// 逻辑形状；实现时用 zod + parseCostOverviewParams salvage
type CostOverviewParams = {
  /** 仅用于设置页展示「当前像哪个官方预设」；缺省或与字段不一致时视为 custom */
  preset?: "overview" | "by-source" | "by-model" | "tokens" | "custom";
  rangeDays: 7 | 14 | 31;
  measure: "cost" | "tokens"; // P1+ 可扩 inputTokens / outputTokens / cachedInputTokens
  groupBy: "none" | "source" | "model";
  chart: "stackedBar" | "line" | "ranking";
  kpis: Array<
    "today" | "period" | "periodTokens" | "latestDayTokens"
  >; // 去重后至少 1 个；上限 4
  /** sourceId 白名单；缺省或空 = 全部来源 */
  sources?: string[];
};
```

**默认值（= 现网行为）**：

```ts
{
  preset: "overview",
  rangeDays: 31,
  measure: "cost",
  groupBy: "source",
  chart: "stackedBar",
  kpis: ["today", "period", "periodTokens", "latestDayTokens"],
}
```

**Salvage 规则**（对齐自定义卡片）：

- 未知字段忽略；枚举非法 → 回退默认。
- `kpis` 非数组或全非法 → 默认四项；合法项去重并保持用户顺序。
- `sources` 非字符串数组 → 视为未设置（全部来源）。
- 图类型与分组不兼容时，**按兼容矩阵自动纠正 chart**（见 6.3），不丢整份 params。
- P0 读到 `groupBy: "model"` 或尚未支持的 measure 时：保留字段以便升级后生效，渲染期按矩阵降级（model → ranking；未知 measure → cost），设置页显示可理解说明。

### 6.2 官方预设模板

| 预设 | rangeDays | measure | groupBy | chart | kpis |
| --- | --- | --- | --- | --- | --- |
| `overview` | 31 | cost | source | stackedBar | 四项全开 |
| `by-source` | 31 | cost | source | stackedBar | today, period |
| `by-model` | 31 | cost | model | ranking | period, periodTokens |
| `tokens` | 31 | tokens | none | line | periodTokens, latestDayTokens, period |

套用预设 = 写入上表字段并设 `preset` 为对应 id。用户随后改任一字段 → `preset` 置 `custom`（或与模板 deep equal 时保持原预设 id，二选一在实现计划写死；推荐 **deep equal 恢复预设 id**，避免无谓 custom）。

### 6.3 图类型兼容矩阵

| groupBy | 允许 chart | 默认纠正 |
| --- | --- | --- |
| `none` | `line`, `stackedBar`（单序列 bar） | 若 `ranking` → `line` |
| `source` | `stackedBar` | 其他 → `stackedBar` |
| `model` | `ranking`（P0/P1 仅 period 排名）；若未来有日×模型再开 `stackedBar` | 其他 → `ranking` |

`measure: "tokens"` 时：

- 金额格式改为 compact token 数。
- 未完全计价 badge：**仅**在 `measure === "cost"` 时展示（token 不依赖定价目录）。

### 6.4 `CostViewModel`（query 输出）

```ts
type CostViewModel = {
  rangeDays: 7 | 14 | 31;
  measure: "cost" | "tokens";
  groupBy: "none" | "source" | "model";
  chart: "stackedBar" | "line" | "ranking";
  /** 截断并过滤后的序列行；stackedBar 为宽表，line 为 date+value */
  series: readonly SeriesRow[];
  /** ranking 用；按 value 降序 */
  ranking: readonly { label: string; value: number }[];
  kpis: {
    today: number | null;
    period: number | null;
    periodTokens: number;
    latestDayTokens: number;
    latestDataDate: string | null;
  };
  /** 与 series 列对齐的来源图例元数据 */
  sourceMetas: readonly { dataKey: string; label: string; colorToken: string }[];
  unpricedDayCount: number; // 仅 measure=cost 有意义
  observedAt: number;
  emptyReason: null | "no-sources" | "no-points-in-range" | "filtered-empty";
};
```

数值口径：

- 成本：microusd → USD（`/ 1_000_000`），与现网一致。
- `rangeDays`：对 bucket 日期做闭区间截断，锚在 snapshot coverage 的 `to`（或 overall 最后一天），取最近 N 个**日历日**内有定义的桶；全 0 日是否保留与现网一致（现网堆叠图丢弃全日 0，line 可保留以显示断层——P0 line 与 stacked 统一**丢弃全日 0**，避免空柱占位；若产品要连续轴再开 P1 开关）。
- KPI `today` / `period`：在过滤 sources 后重算；`period` 为截断窗口内总和，**不是**永远用 snapshot.summary 的 31 日字段（改 range 后必须一致）。
- `groupBy: "model"` 的 ranking：P1 起用过滤后各源 `summary.byModel` **合并同 modelId**；P0 若尚未做 model，设置项可隐藏或禁用。

### 6.5 来源过滤

- `params.sources` 匹配 `source.sourceId`（稳定 id，如 `codex-local-sessions`），**不用**显示名。
- 过滤后无来源 → `emptyReason: "filtered-empty"`，文案引导到设置里恢复来源。
- 未知 sourceId 静默忽略（来源卸载后不炸）。

## 7. UI 行为

### 7.1 物料正文

保持现网 dense 仪表盘风格：

1. `size.h > 2` 时显示描述；可在描述行或 KPI 下增加**范围标签**（如「近 7 天」），避免用户改 range 后无感知。
2. KPI 网格：只渲染 `params.kpis` 选中项；1/2/4 列 container query 规则不变。
3. 主图：
   - `stackedBar`：现有 `BarStack` + 按来源色板。
   - `line`：单序列 `measure` 时间线（`ChartContainer` + 现有 chart 原语）。
   - `ranking`：水平条或现有 ranking 块样式（可复用自定义卡片 ranking 视觉，但不依赖自定义卡片模块反向 import；共享 UI 抽到 `core-widgets/cost/` 或 `@pier/ui` 仅当已有合适原语）。
4. 页脚：相对更新时间；`measure=cost` 且存在未完全计价日 → outline badge + hover 说明。
5. 三态：`WidgetSkeleton` / `WidgetError` / `WidgetEmpty`（区分无数据 / 过滤为空 / 窗口内无点）。

### 7.2 卡面控件密度

- **P0**：卡面不放筛选条；配置全部进设置，避免窄卡控件爆炸。
- **P1**：宽卡（container 足够，如 `@[36rem]`）可显示只读预设芯片或 2–3 个高频预设按钮；窄卡仍只走设置。芯片切换 = 写 params，强自然反馈，无 success toast。

### 7.3 设置页

- 声明 `configurable: true`，注册 `settingsComponent`（对齐自定义卡片）。
- 分区建议：
  1. 预设（Select 或按钮组）
  2. 时间范围（7 / 14 / 31）
  3. 度量（成本 / Token）
  4. 分组与图表（受兼容矩阵约束；改 groupBy 时自动纠正 chart 并在 Field 说明中提示）
  5. KPI 多选（最多 4）
  6. 来源多选（P1；选项来自当前 snapshot.sources + 已知 source 标签表）
- 每次变更 `updateParams`；列表/表单即反馈，不加 toast。
- 文案走 `workbench.widget.costOverview.*` i18n；中英同步；禁止实现词。

### 7.4 物料声明变更

`CORE_WORKBENCH_WIDGETS` 中成本项：

- `configurable: true`
- `multiInstance: true`（并排多角度的前提）
- 保持 `refreshable: false` + 现有 async refresh action
- `minSize` / `defaultSize` 可维持；若 ranking 预设默认更高，用预设建议尺寸而非抬高全局 min
- `searchTerms` 可补「模型」「来源」「趋势」等中英词

### 7.5 刷新与可见性

- 数据仍为 app-shell 级 push store；`visible` 不卸载订阅（保持现网「切回不闪 skeleton」）。
- 自定义 refresh action 继续调用 `usageData.refreshAll()`，spinner 覆盖真实耗时。
- 成功：图表/KPI 自然更新；现有 `refreshSuccess` toast 策略保持一致（若现网有）。
- 失败：`showAppAlert` / 既有错误路径，禁止只 `console.error`。

## 8. 分阶段交付

### P0 — 可配置视图最小闭环

1. `cost-overview-params.ts`：类型、默认、parse/salvage、兼容矩阵、预设表（含 by-model 模板，但 UI 可暂不暴露 model）。
2. `cost-view-query.ts`：range 截断、source 过滤接口预留（P0 可忽略 sources 字段）、measure cost/tokens、groupBy `none|source`、KPI 重算、series/ranking 输出。
3. Widget 按 ViewModel 渲染 line / stackedBar；默认 params 像素级对齐现网测试。
4. 设置页：预设（overview / by-source / tokens）、range、measure、groupBy（none/source）、chart（只读或受限）、kpis。
5. 声明 `configurable` + `multiInstance`。
6. 单测：query、params；组件：默认外观回归 + 切换 tokens/line。

**P0 验收**：用户可添加两张成本卡——一张近 31 天按来源成本，一张近 7 天 Token 折线——刷新与未完全计价行为正确。

### P1 — 模型角度与发现性

1. `groupBy: "model"` + ranking；合并多源 byModel。
2. 预设 `by-model` 进入设置与（可选）宽卡芯片。
3. `sources` 过滤 UI + `filtered-empty` 空态。
4. 范围标签、设置页与字段 deep equal 恢复 preset id。
5. 物料库描述/searchTerms 更新，说明可多开实例。

**P1 验收**：一张卡可只看来源，一张卡可看模型花费榜；过滤掉全部来源时有明确空态与下一步。

### P2 — 数据加厚（有明确需求再开）

1. aggregator 产出 daily×model（或等价结构）后，模型也可 stackedBar 趋势。
2. measure 扩展 input/output/cached；可选 cache hit 类 KPI。
3. account scope 过滤（`scope.kind === "account"`）。
4. `core.cost.*` 指标与 query 共享截断/过滤，避免双轨口径。
5. 非目标仍然成立：不做全局 filter、不做 Explore。

## 9. i18n 与文案

新增/调整 key 建议挂在 `workbench.widget.costOverview` 与必要时 `workbench.metrics`：

- 预设名：总览、按来源、按模型、Token 趋势
- 字段标签：时间范围、度量、分组、图表、显示指标、来源
- 范围：近 7 / 14 / 31 天
- 度量：估算成本、Token
- 空态：窗口内无消耗、当前过滤无来源（带下一步）
- 兼容提示：该分组下已改用某图表

中文界面避免 Agent、worktree、选区等禁用词；「Token」可作为产品词保留并与英文 locale 一致。

## 10. 测试计划

| 层级 | 内容 |
| --- | --- |
| 单元 | `parseCostOverviewParams` salvage；兼容矩阵；`costViewQuery` 截断、过滤、KPI 重算、全日 0 丢弃、model 合并 |
| 组件 | 默认外观与现网 testid 契约；tokens+line；设置改 params 后重渲；filtered-empty；unpriced 仅 cost |
| 指标 | 现有 `core-cost-metrics` 回归（P0 不改口径则保持） |
| E2E | 工作台画布成本卡仍可发现 content/kpis；多实例为 P1 可选 |
| 治理 | 设置 Alert 布局、i18n、颜色 token 不引入硬编码 |

## 11. 风险与决策记录

| 风险 | 处理 |
| --- | --- |
| 改 range 后仍读 summary 31 日字段导致 KPI 撒谎 | 强制 query 内按窗口重算 |
| 多实例放大刷新压力 | 共享 store，refreshAll 一次；不每实例轮询 |
| 设置项过多像 BI | P0 字段 enumeration 上限；卡面不放 filter 条 |
| model 无日序列被做成假堆叠 | 矩阵锁死 model→ranking，直到 P2 有数据 |
| 与「非 BI」文档冲突 | 本文非目标显式继承；禁止全局时间与跨卡筛选 |
| 文件体积 | widget 拆 `params` / `query` / `settings` / `view`；遵守 soft ~300 / hard 500 行 |

## 12. 需求到证据

| 需求 | 证据 |
| --- | --- |
| 默认兼容现网 | 组件测试沿用 `cost-overview-kpis` / `chart` 等 testid |
| 可配置多视角 | params 单测 + 设置组件测 + 双实例手动/组件 |
| 纯函数派生 | `cost-view-query` 单测无 store |
| 非 BI 边界 | 规格非目标 + 代码无全局 filter 入口 |
| 多实例 | 声明 `multiInstance: true` + 布局可添加第二张 |
| 未完全计价诚实 | cost 度量下 badge；tokens 度量下不出现误导 badge |

## 13. 建议实现锚点

- 新建：`src/renderer/panel-kits/workbench/core-widgets/cost/cost-overview-params.ts`
- 新建：`src/renderer/panel-kits/workbench/core-widgets/cost/cost-view-query.ts`
- 新建：`src/renderer/panel-kits/workbench/core-widgets/cost/cost-overview-settings.tsx`
- 调整：`cost-overview-widget.tsx`（变薄，委托 query）
- 调整：`core-workbench-widgets.ts`（configurable / multiInstance / settingsComponent）
- 调整：`src/renderer/i18n/locales/**/workbench.ts`
- 测试：`tests/unit/renderer/cost-view-query.test.ts`、`cost-overview-params.test.ts`、扩展 `tests/component/cost-overview-widget.test.tsx`

## 14. 实现顺序建议

1. params + query + 单测（无 UI）
2. widget 接 ViewModel，默认回归绿灯
3. 设置页 + 声明 multiInstance/configurable
4. P0 预设与 measure/range/groupBy 手工验收
5. P1 model / sources / 宽卡芯片
6. P2 仅在数据契约具备后单独立项
