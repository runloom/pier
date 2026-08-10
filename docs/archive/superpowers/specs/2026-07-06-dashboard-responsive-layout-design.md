# 大盘固定格宽与流式重排设计

日期：2026-07-06
状态：已确认（用户逐节确认于本日会话）
前置：`2026-07-05-dashboard-kit-and-codex-accounts-design.md`（大盘 panel kit 地基）

## 1. 背景与问题

现状大盘用 react-grid-layout（RGL）固定 12 列，列宽 = 容器宽 ÷ 12。拖拽 dockview 分栏时，
卡片的格子占位（x/y/w/h）不变，只有像素宽度被等比压缩——用户感知为"内容被挤扁"而不是
"布局随空间变化"。两个现有 widget（ActivityWidget、AccountsWidget）也不感知实际宽度：
统计块写死 `grid-cols-3`，窄卡下被压得不可读。

另有两个评审确认的相关缺陷一并在本设计内修复：

- 量宽 bug：`containerWidth` 量的是外层无 padding 容器，网格却渲染在 `p-6` 内，恒定比
  实际内容区宽 48px，满 12 列时右缘裁切并出现横向滚动条。
- 数据丢失 bug：大盘 params 整体 `safeParse` 失败时静默回退空数组，用户下一次编辑就把
  空布局永久写回，一条脏数据毁掉整个大盘组装。

## 2. 业界调研结论

| 产品 | 模型 | 面板变窄时 |
| --- | --- | --- |
| Grafana（Custom 布局）、Datadog | 比例缩放 | 卡片等比变窄，移动断点下单列堆叠 |
| Home Assistant sections、iPadOS / Windows 11 小组件 | 固定尺寸 + 流式重排 | 列宽恒定，容器只决定放几列，放不下换行下移 |
| Azure Portal 仪表盘 | 完全固定网格 | 永不重排，横向滚动 |
| codux（workspace_stats 页） | 静态响应式组合 | 图表卡 `flex_wrap` + `min_w(360px)`，放不下换行 |

结论：比例缩放主要留存于运维大屏（为投屏铺满设计）；消费级仪表盘的主流演进方向是
固定尺寸 + 流式重排。codux 没有用户可编辑网格，但它的"最小宽度 + 换行"策略验证了
widget 内容层的响应方式。本设计采用 Home Assistant 模型做网格层，container query 做内容层。

## 3. 目标与非目标

### 目标

1. 格子像素恒定：卡片尺寸只由用户手动拖拽改变，与面板宽度解耦。
2. 面板宽度只决定可用列数；放不下的卡片按阅读序换行下移（流式重排）。
3. widget 内部内容按卡片实际宽度重排（容器查询），而非被动挤压。
4. 派生排布不持久化：面板拉回全宽后，基准布局分毫不差。
5. 顺手修复量宽 48px 溢出与 params 整体丢弃两个缺陷。

### 非目标

- 不做多套断点布局记忆（每断点独立持久化被明确否决）。
- 不改 widget 插件 API 形状（`DashboardWidgetComponentProps` 不变）。
- 不做大盘横向滚动兜底（Azure 模型被否决）。
- 不动 dockview 面板本身的分栏行为。

## 4. 设计

### 4.1 数据模型：基准布局语义（零迁移）

持久化格式不变：`widgets: [{id, x, y, w, h}]`。语义升级为 **12 列基准布局**——它描述
"空间充足时"的排布，是所有派生排布的唯一真相源。

params 解析从整体 `safeParse` 改为**逐条抢救**：`widgets` 数组逐条校验，非法条目丢弃、
合法条目保留；解析结果只用于渲染，不主动回写（避免打开面板即触发写盘），用户下一次
真实编辑时才随之持久化。

### 4.2 几何模型：格子像素恒定

`src/renderer/panel-kits/dashboard/dashboard-grid-geometry.ts` 新增：

```ts
export const CELL_WIDTH = 88; // 与 ROW_HEIGHT = 88 对齐成方格
```

- 卡片像素宽 = `w × 88 + (w − 1) × 12`，与面板宽度无关。
- RGL `containerPadding` 显式设为 `[0, 0]`（外围留白由 `p-6` 容器负责；不显式设置时
  RGL 默认取 margin 值，公式会差 24px）。
- 网格像素宽 = `k × 100 − 12`（RGL `width` 入参）；可用列数
  `k = clamp(1, floor((contentWidth + 12) / 100), 12)`。
- 网格容器左对齐，面板四边留白恒等于卡间距 12px（用户定稿：否决 HA 式居中，
  "边距 = 间距"的节奏优先；面板宽度贴合内容时四边等距）。
- 量宽修正：`useContainerWidth` 的 ref 从外层无 padding div 移到 `p-6` 内容 div 上
  （ResizeObserver `contentRect` 即内容盒宽度），根除 48px 溢出。

### 4.3 派生重排：纯函数 `deriveLayout(basis, k)`

`k ≥ 12` 时基准布局原样渲染；`k < 12` 进入派生模式：

1. 基准项按阅读序排序（y 优先、x 其次、id 兜底保证确定性）。
2. 逐个**保序装箱**进 k 列网格（禁止回填）：候选位置按阅读序 (y,x) 从游标——上一项
   落位的下一格——开始扫描，取第一个可容纳位；游标随落位推进。不变量：显示阅读序 ==
   基准阅读序。`w > k` 的卡 clamp 到 k，h 不变。

纯函数、确定性、无状态：面板宽度在阈值附近抖动时输出稳定，派生结果不持久化。

### 4.4 交互语义

| 模式 | resize（改 w/h） | 拖拽（改位置） |
| --- | --- | --- |
| 全宽（k≥12） | 直存基准 | 直存基准 |
| 派生（k<12） | 直存基准条目的 w/h（尺寸与列数无关） | 重排序：映射回基准阅读序 |

派生模式使用 `noCompactor`（全宽保持 `verticalCompactor`）：保序输出可能带竖向空隙，
不是 verticalCompactor 的不动点——压实会在挂载时把差异误判为用户拖拽并触发写盘。

派生模式拖拽 = 重排序（iPadOS 式）：

1. RGL `onLayoutChange` 给出的新派生坐标按阅读序排序，得到 id 的新顺序。
2. 若新顺序与旧顺序相同（纯位置微调被 RGL 压实回原位），不写盘。
3. 顺序变了：按新顺序把基准项保序装箱回 12 列基准网格并持久化。

**关键守卫**：派生模式下绝不能把 k 列坐标直接写回 params——那会让窄态一次拖动毁掉
基准布局。此守卫必须有组件测试锁住。

已知语义代价（可接受，见 §5）：窄态重排序会把基准布局按序重新装箱，用户在宽态刻意
留白的摆位会被压实。

### 4.5 widget 内容级响应：container queries

- 宿主在 `DashboardWidgetCard` 的 `CardContent` 上声明容器上下文（Tailwind v4 原生
  `@container`），纯 CSS，零 JS 重渲染。
- `ActivityWidget`：统计块 `grid-cols-1 @[14rem]:grid-cols-3`——窄卡纵排、宽卡三列。
- `AccountsWidget`：账号行窄时 Badge 与切换按钮折行收纳，进度条保持全宽。
- 插件接入规范补充指引：内容响应一律用 container query，不要依赖 `size` prop 换算像素
  （`size` 是格子数，保留用于逻辑分支，如"高度 ≥ 4 才显示列表"）。

## 5. 关键权衡

- **重排序 vs 窄态只读**：窄态只读实现最简单，但侧边竖条大盘（常驻窄面板）永远没法调
  顺序，被否决。重排序的反向映射代价是"重新装箱压实留白"，明确接受。
- **固定 88px vs 可配置格宽**：先写死常量。做成设置项属过早抽象，等真实需求。
- **12 列上限**：面板超宽时不再加列（基准语义即 12 列），富余空间留白居中。
- **逐条抢救不回写**：打开面板不触发写盘，代价是脏条目会留在磁盘直到下次编辑——
  比"打开即静默改写用户数据"安全。
- **保序 vs 紧凑**：first-fit 回填会让窄态拖拽"不粘"——靠后的小卡钻进靠前空隙，
  松手瞬间显示顺序对调。改保序装箱（落位阅读序严格递增，禁回填），代价是混合宽度
  下多留白（用户拍板）。

## 6. 影响面

| 文件 | 变更 |
| --- | --- |
| `src/renderer/panel-kits/dashboard/dashboard-grid-geometry.ts` | 新增 `CELL_WIDTH`、`deriveLayout`、重排序映射函数 |
| `src/renderer/panel-kits/dashboard/dashboard-panel.tsx` | k 列计算、派生模式渲染与写回守卫、量宽 ref 移位、params 逐条抢救、网格居中 |
| `src/renderer/panel-kits/dashboard/dashboard-widget-card.tsx` | `CardContent` 容器查询上下文 |
| `src/renderer/panel-kits/dashboard/core-widgets/activity-widget.tsx` | 统计块容器查询变体 |
| `src/plugins/builtin/codex/renderer/accounts-widget.tsx` | 账号行容器查询变体 |
| `src/shared/contracts/dashboard.ts` | 不变（如逐条抢救需要导出条目 schema 已具备） |
| 插件接入文档（AGENTS.md §dashboardWidgets 或插件 API 注释） | 内容响应指引 |

## 7. 测试

- `deriveLayout` 单元测试：阅读序、保序装箱（禁回填）、w clamp、k=1 全堆叠、确定性（同输入同输出）。
- 重排序映射单元测试：顺序未变不写盘；顺序变化后基准阅读序与新顺序一致。
- params 逐条抢救单元测试：混合合法/非法条目只丢非法项。
- 组件测试：窄容器（mock ResizeObserver 宽度）渲染派生布局；派生模式拖拽不把 k 列
  坐标写回 params；派生模式 resize 正确写回基准 w/h。
- widget 容器查询断言：jsdom 不执行 container query，测试只断言类名存在。

## 8. 风险

- RGL 动态 `cols`：我们始终传显式 layout（基准或派生），不依赖 RGL 自身的越界修正；
  需验证 cols 切换瞬间 RGL 不触发多余的 `onLayoutChange`（守卫测试覆盖）。
- 重排序映射的体验：压实留白可能让部分用户意外；文档与提交说明中写明语义。
- 现有用户的窄面板首开视觉变化：从"挤扁的 12 列"变成"换行的 k 列"，属预期改进。
- container query 需要 Chromium 支持：Electron 42 的 Chromium 版本远高于支持线（105），无兼容风险。
