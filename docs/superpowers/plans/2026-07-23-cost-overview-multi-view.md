# 成本总览多视角 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `core.cost-overview` 从写死总览卡升级为可配置 Cost View：params + 纯函数 query + 设置页 + 多实例，默认外观兼容现网。

**Architecture:** 物料黑盒 `CostOverviewParams` 经 salvage 解析；`costViewQuery(snapshot, params, labelResolver)` 纯函数产出 `CostViewModel`；widget 只负责订阅 store 与渲染；设置页 `updateParams` 即时持久化。官方预设是 params 模板，每次 patch 后用 deep equal 恢复 preset id。

**Tech Stack:** React 19、Zustand usage store、recharts（`BarChart`/`BarStack`/`LineChart`）、`@pier/ui` Field/Select/Chart、Vitest + Testing Library、zod（与自定义卡片一致，可用手工 enum 校验若更轻）。

**Spec:** `docs/superpowers/specs/2026-07-23-cost-overview-multi-view-design.md`

## Global Constraints

- 工作台非 BI：禁止全局时间条、跨卡筛选、Explore、SQL。
- 默认 params 必须通过现有 `tests/component/cost-overview-widget.test.tsx` 外观/testid 契约。
- 改 `rangeDays` 后 KPI `period` 必须按窗口重算，禁止继续盲信 `summary.estimatedCostMicrousd`（其固定近 31 日）。
- `measure === "tokens"` 时不展示未完全计价 badge。
- `groupBy: "model"` → chart 强制 `ranking`；`groupBy: "source"` → 强制 `stackedBar`；`groupBy: "none"` 且 chart 为 `ranking` → 纠正为 `line`。
- 用户文案走 i18n；禁止实现词；数字走 `@pier/ui/format`。
- 文件 soft ~300 / hard 500 行；从 `cost-overview-widget.tsx` 拆出 `cost/` 子目录。
- 不改 main `usage-data` 写盘结构（P2 另项）；P0/P1 只读现有 `UsageAggregateSnapshot`。
- Git：按任务提交；Conventional Commits；不 `git add .`。

## File map

| 路径 | 职责 |
| --- | --- |
| `src/renderer/panel-kits/workbench/core-widgets/cost/cost-overview-params.ts` | 类型、默认、预设、兼容矩阵、parse、patch+preset 恢复 |
| `src/renderer/panel-kits/workbench/core-widgets/cost/cost-view-query.ts` | 纯函数派生 ViewModel |
| `src/renderer/panel-kits/workbench/core-widgets/cost/cost-overview-settings.tsx` | 设置 UI |
| `src/renderer/panel-kits/workbench/core-widgets/cost/cost-overview-widget.tsx` | 自原路径迁入的渲染组件 + refresh actions（或原路径 re-export） |
| `src/renderer/panel-kits/workbench/core-widgets/cost-overview-widget.tsx` | 薄 re-export，避免测试/import 大爆炸（可选；若全量改 import 也可删） |
| `src/renderer/panel-kits/workbench/core-workbench-widgets.ts` | `configurable`/`multiInstance`/`settingsComponent` |
| `src/renderer/i18n/locales/en/workbench.ts` + `zh-CN/workbench.ts` | 设置/预设/空态/范围文案 |
| `tests/unit/renderer/cost-overview-params.test.ts` | params salvage + preset |
| `tests/unit/renderer/cost-view-query.test.ts` | query 口径 |
| `tests/component/cost-overview-widget.test.tsx` | 默认回归 + 新视角 |
| `tests/component/cost-overview-settings.test.tsx` | 设置写 params |

P1 追加：宽卡预设芯片（可放 widget 内）、sources 多选设置、filtered-empty 文案。  
P2：不在本计划实现（见文末）。

---

### Task 1: `CostOverviewParams` 解析与预设

**Files:**
- Create: `src/renderer/panel-kits/workbench/core-widgets/cost/cost-overview-params.ts`
- Test: `tests/unit/renderer/cost-overview-params.test.ts`

**Interfaces:**
- Produces:
  - `CostOverviewRangeDays = 7 | 14 | 31`
  - `CostOverviewMeasure = "cost" | "tokens"`
  - `CostOverviewGroupBy = "none" | "source" | "model"`
  - `CostOverviewChart = "stackedBar" | "line" | "ranking"`
  - `CostOverviewKpiId = "today" | "period" | "periodTokens" | "latestDayTokens"`
  - `CostOverviewPresetId = "overview" | "by-source" | "by-model" | "tokens" | "custom"`
  - `CostOverviewParams`（见 spec §6.1）
  - `DEFAULT_COST_OVERVIEW_PARAMS: CostOverviewParams`
  - `COST_OVERVIEW_PRESETS: Record<Exclude<CostOverviewPresetId, "custom">, CostOverviewParams>`
  - `parseCostOverviewParams(raw: Readonly<Record<string, unknown>>): CostOverviewParams`
  - `normalizeCostOverviewChart(groupBy, chart): CostOverviewChart`
  - `paramsFromPreset(preset: Exclude<CostOverviewPresetId, "custom">): CostOverviewParams`
  - `patchCostOverviewParams(current: CostOverviewParams, patch: Partial<CostOverviewParams>): CostOverviewParams`（合并 → 纠正 chart → deep equal 恢复 preset）
  - `costOverviewParamsToJson(params: CostOverviewParams): Record<string, unknown>`（写回 `updateParams` 用的可序列化对象；`sources` 仅在非空时写入）

- [ ] **Step 1: 写失败单测**

```ts
// tests/unit/renderer/cost-overview-params.test.ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_COST_OVERVIEW_PARAMS,
  normalizeCostOverviewChart,
  paramsFromPreset,
  parseCostOverviewParams,
  patchCostOverviewParams,
} from "@/panel-kits/workbench/core-widgets/cost/cost-overview-params.ts";

describe("parseCostOverviewParams", () => {
  it("returns defaults for empty raw", () => {
    expect(parseCostOverviewParams({})).toEqual(DEFAULT_COST_OVERVIEW_PARAMS);
  });

  it("salvages illegal enums and empty kpis", () => {
    expect(
      parseCostOverviewParams({
        rangeDays: 99,
        measure: "watts",
        groupBy: "account",
        chart: "pie",
        kpis: ["nope"],
        sources: "codex",
      })
    ).toEqual(DEFAULT_COST_OVERVIEW_PARAMS);
  });

  it("keeps valid fields and dedupes kpis in order", () => {
    expect(
      parseCostOverviewParams({
        rangeDays: 7,
        measure: "tokens",
        groupBy: "none",
        chart: "line",
        kpis: ["periodTokens", "today", "periodTokens", "latestDayTokens"],
        sources: ["codex-local-sessions", 1, ""],
        preset: "tokens",
      })
    ).toEqual({
      preset: "tokens",
      rangeDays: 7,
      measure: "tokens",
      groupBy: "none",
      chart: "line",
      kpis: ["periodTokens", "today", "latestDayTokens"],
      sources: ["codex-local-sessions"],
    });
  });

  it("corrects chart for groupBy source on parse", () => {
    expect(
      parseCostOverviewParams({ groupBy: "source", chart: "line" }).chart
    ).toBe("stackedBar");
  });
});

describe("normalizeCostOverviewChart", () => {
  it("maps model to ranking and none+ranking to line", () => {
    expect(normalizeCostOverviewChart("model", "stackedBar")).toBe("ranking");
    expect(normalizeCostOverviewChart("none", "ranking")).toBe("line");
    expect(normalizeCostOverviewChart("source", "line")).toBe("stackedBar");
  });
});

describe("patchCostOverviewParams", () => {
  it("restores preset id when fields match a template", () => {
    const tokens = paramsFromPreset("tokens");
    const customish = { ...tokens, preset: "custom" as const };
    expect(patchCostOverviewParams(customish, {}).preset).toBe("tokens");
  });

  it("marks custom when fields diverge", () => {
    const overview = paramsFromPreset("overview");
    expect(
      patchCostOverviewParams(overview, { rangeDays: 7 }).preset
    ).toBe("custom");
  });

  it("applies preset template when patch.preset is official", () => {
    const next = patchCostOverviewParams(DEFAULT_COST_OVERVIEW_PARAMS, {
      preset: "tokens",
    });
    expect(next).toEqual(paramsFromPreset("tokens"));
  });
});
```

- [ ] **Step 2: 跑测确认失败**

Run: `pnpm exec vitest run tests/unit/renderer/cost-overview-params.test.ts`

Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `cost-overview-params.ts`**

实现要点（完整文件由执行者按接口写出）：

- `DEFAULT_COST_OVERVIEW_PARAMS` = spec 默认（overview / 31 / cost / source / stackedBar / 四 KPI，无 `sources` 或 `sources: undefined`）。
- 预设表与 spec §6.2 一致；`paramsFromPreset` 返回深拷贝。
- `parse`：逐字段白名单；`kpis` 过滤合法 id、去重保序，空则默认四项；`sources` 仅保留非空 string；最后 `chart = normalizeCostOverviewChart(groupBy, chart)`；`preset` 非法则按字段 deep equal 推断，否则 `custom`。
- `patchCostOverviewParams`：若 `patch.preset` 为四个官方之一 → 直接 `paramsFromPreset`；否则 merge → normalize chart → 与四模板（忽略 preset 字段比较）deep equal 设 preset。
- 比较时 `sources`：`undefined` 与 `[]` 视为相等（都表示全部来源）。

- [ ] **Step 4: 跑测确认通过**

Run: `pnpm exec vitest run tests/unit/renderer/cost-overview-params.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add \
  src/renderer/panel-kits/workbench/core-widgets/cost/cost-overview-params.ts \
  tests/unit/renderer/cost-overview-params.test.ts
git commit -m "$(cat <<'EOF'
feat(workbench): add cost overview params and presets

Salvage widget params, chart compatibility matrix, and preset identity
recovery for the multi-view cost widget.
EOF
)"
```

---

### Task 2: `costViewQuery` 纯函数

**Files:**
- Create: `src/renderer/panel-kits/workbench/core-widgets/cost/cost-view-query.ts`
- Test: `tests/unit/renderer/cost-view-query.test.ts`

**Interfaces:**
- Consumes: `CostOverviewParams` from Task 1；`UsageAggregateSnapshot` from `@shared/contracts/usage-data.ts`
- Produces:
  - `CostViewSourceMeta { dataKey: string; label: string; color: string }`
  - `CostViewSeriesRow = { date: string; value?: number; [dataKey: string]: string | number }`
  - `CostViewModel`（spec §6.4；KPI 数值：cost 为 USD number | null，tokens 相关为 number）
  - `costViewQuery(input: { snapshot: UsageAggregateSnapshot | null; params: CostOverviewParams; resolveSourceLabel: (pluginId: string, sourceId: string) => string }): CostViewModel`

颜色：沿用现网 `SOURCE_COLOR_TOKENS` 循环（常量可放 query 文件或 params 旁 `cost-overview-colors.ts`；优先放 query 顶部 const）。

算法（必须写进实现，单测锁定）：

1. `snapshot == null` 或 `sources.length === 0` → `emptyReason: "no-sources"`，空 series/ranking，KPI 零/null，`observedAt: 0`。
2. 若 `params.sources` 为非空数组：过滤 `snapshot.sources` 中 `sourceId` 命中者；过滤后 0 条 → `emptyReason: "filtered-empty"`。
3. `rangeAnchor = snapshot.overall.coverage.to`（`YYYY-MM-DD`）；窗口起点 = anchor 往前 `rangeDays - 1` 个日历日（UTC 日期字符串比较即可，复用或内联简单 `addUtcDays`）。
4. 对每个保留 source，只保留 `date >= from && date <= to` 的 buckets。
5. **KPI**
   - `today`：`coverage.to` 日（或本地「今天」若与 coverage.to 不同——**P0 用 coverage.to 作为 today 锚**，与聚合器 today 字段对齐时优先：若 overall.summary 的 today 有值且未过滤 sources 且 range 含该日，仍应 **从过滤后分源桶重算** `coverage.to` 日 cost/tokens，避免 summary 撒谎）。
   - `period`（cost）：窗口内各日各源 microusd 求和 / 1e6；任一日全 null 且无数值 → 该贡献跳过；若窗口完全无成本点 → `null`。
   - `periodTokens`：窗口内 totalTokens 求和。
   - `latestDayTokens` + `latestDataDate`：窗口内从后往前第一个 `totalTokens > 0` 的日期与 tokens（跨源相加）。
6. **series**
   - 构建日期有序列（窗口内出现过的日期 ∪ overall 截断日期）。
   - `groupBy === "source"`：宽表行 `{ date, source0, source1, ... }`，值按 measure；**行 total==0 则丢弃**。
   - `groupBy === "none"`：`{ date, value }`，值为全日总和；total==0 丢弃。
7. **ranking**
   - `groupBy === "model"`：合并各保留源 `summary.byModel` 同 `modelId`（cost microusd 或 totalTokens）；降序；label = modelId 或 `"unknown"` 字面（i18n 在 widget）。
   - 其他 groupBy：`ranking: []`。
8. `unpricedDayCount`：窗口内、过滤后合并日桶 `pricingStatus !== "complete"` 的天数（按 date 去重）。
9. `emptyReason`：有来源但 series 与 ranking 皆空 → `"no-points-in-range"`；否则 `null`。
10. `chart`/`groupBy`/`measure`/`rangeDays` 原样回传已 normalize 的 params 字段。

- [ ] **Step 1: 写失败单测**

使用与 `tests/unit/renderer/core-cost-metrics.test.ts` 相同的 `bucket` / `simpleTokens` 风格构造双源快照：

- 日期 `2026-07-01` … `2026-07-11` 中至少两端有数据；`coverage.to = "2026-07-11"`。
- 断言默认 params：period cost 与手工求和一致。
- `rangeDays: 7` 不含 7 日前的桶。
- `measure: "tokens"` + `groupBy: "none"` 产出 value 序列。
- `sources: ["only-a"]` 只含一源；全过滤 → `filtered-empty`。
- `groupBy: "model"` 合并两源同模型成本。
- 全日 0 不进 series。

- [ ] **Step 2: 跑测确认失败**

Run: `pnpm exec vitest run tests/unit/renderer/cost-view-query.test.ts`

Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 query**

无 React、无 i18n import；label 只通过 `resolveSourceLabel`。

- [ ] **Step 4: 跑测确认通过**

Run: `pnpm exec vitest run tests/unit/renderer/cost-view-query.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add \
  src/renderer/panel-kits/workbench/core-widgets/cost/cost-view-query.ts \
  tests/unit/renderer/cost-view-query.test.ts
git commit -m "$(cat <<'EOF'
feat(workbench): add pure cost view query

Derive KPIs and chart series from usage snapshots using widget params
so range and filters stay consistent.
EOF
)"
```

---

### Task 3: i18n 文案（P0 设置 + 动态标签）

**Files:**
- Modify: `src/renderer/i18n/locales/en/workbench.ts`
- Modify: `src/renderer/i18n/locales/zh-CN/workbench.ts`

**Interfaces:**
- Produces keys under `workbench.widget.costOverview`（在现有对象上扩展，勿删旧 key）：

```ts
// 逻辑 key 列表（中英都要写可读句子）
settings: {
  title 可省略（宿主弹窗用物料 title）
  preset: "Preset" / "预设"
  presetOverview / presetBySource / presetByModel / presetTokens / presetCustom
  range: "Time range" / "时间范围"
  rangeDays: "{{count}} days" / "近 {{count}} 天"  // 或 range7/14/31 三个死 key
  measure: "Metric" / "度量"
  measureCost / measureTokens
  groupBy: "Group by" / "分组"
  groupNone / groupSource / groupModel
  chart: "Chart" / "图表"
  chartStackedBar / chartLine / chartRanking
  chartAutoHint: "Chart type follows the selected grouping." / "图表类型随分组自动匹配。"
  kpis: "KPI tiles" / "指标"
  kpiToday / kpiPeriod / kpiPeriodTokens / kpiLatestDayTokens
  sources: "Sources" / "来源"          // P1 用，P0 可先加 key
  sourcesAll: "All sources" / "全部来源"
},
rangeLabel: "Last {{count}} days" / "近 {{count}} 天",
periodDynamic: "Last {{count}} days cost" / "近 {{count}} 天成本",
periodTokensDynamic: "Last {{count}} days tokens" / "近 {{count}} 天 tokens",
emptyInRange: "No usage in this range" / "该时间范围内暂无用量",
emptyInRangeHint: "Try a longer range or refresh after using a supported AI CLI." / "可尝试更长范围，或在使用支持的 AI CLI 后刷新。",
emptyFiltered: "No sources match this view" / "当前筛选下没有来源",
emptyFilteredHint: "Open widget settings and include at least one source." / "打开组件设置，至少保留一个来源。",
```

注意：现网 `period` / `periodTokens` 文案写死「31 天」。Widget 在 `rangeDays !== 31` 时改用 `periodDynamic` / `periodTokensDynamic`；`=== 31` 可继续用旧 key 以减少 diff，或统一走 dynamic（推荐 **统一 dynamic**，测试用 role/text 时改断言）。

- [ ] **Step 1: 中英 locale 同步补 key**（无单独测试；治理扫描会抓禁用词）

- [ ] **Step 2: Commit**

```bash
git add src/renderer/i18n/locales/en/workbench.ts src/renderer/i18n/locales/zh-CN/workbench.ts
git commit -m "$(cat <<'EOF'
feat(i18n): add cost overview multi-view copy

Labels for presets, range, measure, grouping, and empty states.
EOF
)"
```

---

### Task 4: Widget 接 ViewModel（默认回归）

**Files:**
- Create/Modify: `src/renderer/panel-kits/workbench/core-widgets/cost/cost-overview-widget.tsx`（从现文件迁入并改写）
- Modify: `src/renderer/panel-kits/workbench/core-widgets/cost-overview-widget.tsx` → re-export `CostOverviewWidget` / `costOverviewWidgetActions`
- Modify: `tests/component/cost-overview-widget.test.tsx`

**Interfaces:**
- Consumes: `parseCostOverviewParams`、`costViewQuery`、`resolveUsageSourceLabel`
- Produces: 同名导出，props 仍为 `WorkbenchWidgetComponentProps`（读 `params`）

- [ ] **Step 1: 扩展组件测试（先红后绿）**

在现有 `loadedSnapshot` 用例旁新增：

```ts
it("renders a line chart when params request tokens over time", () => {
  useUsageDataStore.setState({
    error: null,
    loadStatus: "ready",
    snapshot: loadedSnapshot(),
  });
  renderWidget({
    params: {
      rangeDays: 31,
      measure: "tokens",
      groupBy: "none",
      chart: "line",
      kpis: ["periodTokens", "latestDayTokens"],
      preset: "tokens",
    },
  });
  expect(screen.getByTestId("cost-overview-chart")).toBeInTheDocument();
  expect(screen.getByTestId("cost-overview-chart-line")).toBeInTheDocument();
  expect(screen.queryByTestId("cost-overview-unpriced")).not.toBeInTheDocument();
});

it("hides unpriced badge for token measure even when pricing is partial", () => {
  // loadedSnapshot 含 partial；params measure tokens
});
```

给 unpriced badge 加稳定 `data-testid="cost-overview-unpriced"`（现网可能没有，一并加上且默认用例断言仍在）。

保留：loading / error / empty / kpis / chart / description h 门槛 / refresh action / hidden visible 更新。

- [ ] **Step 2: 跑测确认新用例失败、旧用例仍应在实现后全过**

Run: `pnpm exec vitest run tests/component/cost-overview-widget.test.tsx`

- [ ] **Step 3: 改写 widget**

结构：

```tsx
export function CostOverviewWidget({ params, size }: WorkbenchWidgetComponentProps) {
  const t = useT();
  const parsed = useMemo(() => parseCostOverviewParams(params), [params]);
  const snapshot = useUsageDataStore(s => s.snapshot);
  // loadStatus / error 同现网
  const view = useMemo(
    () =>
      costViewQuery({
        snapshot,
        params: parsed,
        resolveSourceLabel: (pluginId, sourceId) =>
          resolveUsageSourceLabel(t, pluginId, sourceId),
      }),
    [snapshot, parsed, t]
  );
  // emptyReason 分支
  // KPI：map parsed.kpis → KpiTile，label/value 按 measure+range 格式化
  // chart：view.chart === "line" → LineChart + dataKey value + testid chart-line
  //         stackedBar → 现网 BarStack
  //         ranking → 简单列表（model）；P0 即使设置未暴露也要能渲染
  // footer
}
```

格式化：

- cost KPI：`formatCurrency`
- tokens KPI：`formatCompactNumber`
- `rangeLabel`：可选小字 `t("....rangeLabel", { count: view.rangeDays })` 放在 KPI 区上方或 description 旁（`size.h > 2` 时）

刷新 action：原样迁入。

控制文件行数：图表拆本地函数 `CostOverviewChart({ view, ... })` 同文件底部或 `cost-overview-chart.tsx`。

- [ ] **Step 4: 全文件组件测通过**

Run: `pnpm exec vitest run tests/component/cost-overview-widget.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add \
  src/renderer/panel-kits/workbench/core-widgets/cost/ \
  src/renderer/panel-kits/workbench/core-widgets/cost-overview-widget.tsx \
  tests/component/cost-overview-widget.test.tsx
git commit -m "$(cat <<'EOF'
feat(workbench): render cost overview from view model

Wire params and costViewQuery into the widget while keeping the default
stacked overview behavior.
EOF
)"
```

---

### Task 5: 设置页 + 物料声明

**Files:**
- Create: `src/renderer/panel-kits/workbench/core-widgets/cost/cost-overview-settings.tsx`
- Modify: `src/renderer/panel-kits/workbench/core-workbench-widgets.ts`
- Test: `tests/component/cost-overview-settings.test.tsx`

**Interfaces:**
- Consumes: `parseCostOverviewParams`、`patchCostOverviewParams`、`costOverviewParamsToJson`、`WorkbenchWidgetSettingsProps`
- Produces: `CostOverviewSettings`

P0 设置字段（**不暴露** sources；**不暴露** groupBy model——用 Select 仅 `none|source`；preset 含 overview / by-source / tokens，**不含** by-model）：

1. Preset Select  
2. Range 7/14/31  
3. Measure cost/tokens  
4. GroupBy none/source（改 groupBy 时 patch 内自动纠正 chart）  
5. Chart Select：仅展示当前 groupBy 允许项（或 disabled + hint `chartAutoHint`）  
6. KPI：四个 Checkbox 或 Toggle 组，至少保留 1 个（取消最后一个时忽略或 toast 无——**忽略 revert**）

`persist(patch)`:

```ts
const next = patchCostOverviewParams(parseCostOverviewParams(params), patch);
updateParams(costOverviewParamsToJson(next));
```

- [ ] **Step 1: 设置组件测试**

```ts
it("writes tokens preset fields through updateParams", async () => {
  const updateParams = vi.fn();
  render(<CostOverviewSettings params={{}} updateParams={updateParams} />);
  // 选择预设 tokens（用 select / testid）
  // expect updateParams 被调用且 rangeDays/measure/groupBy/chart 匹配 paramsFromPreset("tokens")
});

it("marks custom after changing range on overview", async () => {
  // params = paramsFromPreset("overview") 的 json
  // 改 range 7 → preset custom
});
```

- [ ] **Step 2: 跑测红**

Run: `pnpm exec vitest run tests/component/cost-overview-settings.test.tsx`

- [ ] **Step 3: 实现设置 UI + 注册**

`core-workbench-widgets.ts` 成本声明：

```ts
{
  // ...existing
  configurable: true,
  multiInstance: true,
  searchTerms: [ /* 现有 + "model", "source", "trend", "模型", "来源", "趋势" */ ],
}
// registration:
{
  actions: costOverviewWidgetActions,
  component: CostOverviewWidget,
  icon: DollarSign,
  id: CORE_COST_OVERVIEW_WIDGET_ID,
  previewComponent: CostOverviewWidgetPreview,
  settingsComponent: CostOverviewSettings,
}
```

Field 布局对齐 `custom-card-settings.tsx`（FieldSet / FieldGroup / Select size=sm）。

- [ ] **Step 4: 跑测绿 + 快速回归成本 widget**

Run:

```bash
pnpm exec vitest run \
  tests/component/cost-overview-settings.test.tsx \
  tests/component/cost-overview-widget.test.tsx \
  tests/unit/renderer/cost-overview-params.test.ts \
  tests/unit/renderer/cost-view-query.test.ts
```

Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add \
  src/renderer/panel-kits/workbench/core-widgets/cost/cost-overview-settings.tsx \
  src/renderer/panel-kits/workbench/core-workbench-widgets.ts \
  tests/component/cost-overview-settings.test.tsx
git commit -m "$(cat <<'EOF'
feat(workbench): add cost overview settings and multi-instance

Expose P0 view controls and allow side-by-side cost widgets.
EOF
)"
```

---

### Task 6: P0 验收与治理扫描

**Files:** 仅修复本阶段引入的问题

- [ ] **Step 1: 跑相关单测/组件测**

```bash
pnpm exec vitest run \
  tests/unit/renderer/cost-overview-params.test.ts \
  tests/unit/renderer/cost-view-query.test.ts \
  tests/unit/renderer/core-cost-metrics.test.ts \
  tests/component/cost-overview-widget.test.tsx \
  tests/component/cost-overview-settings.test.tsx
```

Expected: PASS

- [ ] **Step 2: 类型与治理（若本机 hook 未跑）**

```bash
pnpm exec tsc --noEmit -p tsconfig.web.json 2>/dev/null || pnpm typecheck
```

若有 `user-copy-governance` / 文件行数失败，当场修。

- [ ] **Step 3: 手工验收清单（执行者在 dev 勾选）**

1. 工作台添加「成本」→ 默认仍为 4 KPI + 来源堆叠。  
2. 设置 → Token 趋势预设 → 主图为线、无未计价 badge。  
3. 再添加第二张成本卡 → 库可再次添加；两卡 params 独立。  
4. range=7 时 period KPI 数字小于 31 日（有足够历史数据时）。  
5. 刷新 spinner 仍覆盖 `refreshAll`。

- [ ] **Step 4: 若有修复则 commit，否则跳过**

```bash
git commit -m "fix(workbench): polish cost multi-view P0 after verification"
```

---

### Task 7: P1 — 模型分组、来源过滤、发现性

**Files:**
- Modify: `cost-overview-settings.tsx`（preset by-model、groupBy model、sources 多选）
- Modify: `cost-overview-widget.tsx`（`emptyReason: filtered-empty` 文案；可选宽卡预设芯片）
- Modify: tests（settings + widget + query 若需补 sources UI 测）
- Modify: locales（若 Task 3 已预置 key 则只接 UI）

**Interfaces:**
- 设置增加：
  - preset `by-model`
  - groupBy 选项 `model`
  - sources：基于 `useUsageDataStore` 当前 sources 列出 checkbox；空选择 = 清除过滤（全部）；`patch` 写入 `sources: string[] | undefined`
- Widget：`filtered-empty` / 已有 `no-points-in-range` 用 Task 3 文案
- 宽卡芯片（可选但推荐）：`size.w >= 4` 或 container `@[36rem]` 时显示 overview / by-source / by-model / tokens 四个按钮，点击 `updateParams(costOverviewParamsToJson(paramsFromPreset(...)))`——**需要 props 已有 `updateParams`**，直接用。

- [ ] **Step 1: 测试**

- settings：勾选单一 sourceId → updateParams 含 sources  
- settings：选 by-model → groupBy model + chart ranking  
- widget：params.sources 全无效 id → filtered-empty 文案  

- [ ] **Step 2: 实现并跑测**

```bash
pnpm exec vitest run \
  tests/component/cost-overview-settings.test.tsx \
  tests/component/cost-overview-widget.test.tsx \
  tests/unit/renderer/cost-view-query.test.ts
```

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(workbench): cost view model ranking and source filters

P1 multi-view: by-model preset, source allowlist, and clearer empties.
EOF
)"
```

---

### Task 8: P1 验收

- [ ] **Step 1: 双实例手工** — 一卡 by-source，一卡 by-model ranking，互不影响  
- [ ] **Step 2: 过滤全部来源** — 空态 + 设置可恢复  
- [ ] **Step 3: 相关测试再跑一遍**  
- [ ] **Step 4: 需要则 fix commit**

---

## P2（本计划不实施）

仅当产品确认需要时另开 plan/spec 增量：

- aggregator `daily×model` 后 model 也可 stackedBar  
- measure 扩展 input/output/cached  
- account scope 过滤  
- `core.cost.*` 与 query 共享截断  

禁止借 P2 打开全局 filter。

---

## Spec coverage（自审）

| Spec 项 | Task |
| --- | --- |
| params + salvage + 矩阵 | T1 |
| 预设 deep equal | T1 |
| costViewQuery 重算 KPI/range | T2 |
| sources 过滤逻辑 | T2（UI 在 T7） |
| model ranking 数据 | T2 + T7 UI |
| i18n | T3 |
| widget line/stack/ranking + 默认兼容 | T4 |
| unpriced 仅 cost | T4 |
| 设置页 P0 字段 | T5 |
| configurable + multiInstance | T5 |
| P0 验收 | T6 |
| P1 model/sources/芯片 | T7–T8 |
| P2 数据加厚 | 明确排除 |
| 非 BI 边界 | Global Constraints |
| 文件拆分硬上限 | File map + T4 |

## Placeholder scan

无 TBD/「类似 Task N」；类型名在 Task 1–2 Interfaces 固定。

## Type consistency

- 全程 `CostOverviewParams` / `costViewQuery` / `patchCostOverviewParams` / `paramsFromPreset`  
- JSON 写盘经 `costOverviewParamsToJson`，读盘经 `parseCostOverviewParams`  
- 空态三枚举：`no-sources` | `no-points-in-range` | `filtered-empty`

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-23-cost-overview-multi-view.md`.

**Two execution options:**

1. **Subagent-Driven（推荐）** — 每任务新子代理 + 任务间 review  
2. **Inline Execution** — 本会话按 `executing-plans` 批量推进并设检查点  

Which approach?
