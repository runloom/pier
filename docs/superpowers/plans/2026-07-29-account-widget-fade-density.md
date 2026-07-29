# 账号组件渐隐与紧凑密度实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 让账号组件在短滚动区中正确呈现顶部／底部动态渐隐，并只在紧凑模式收敛配额数字和间距。

**架构：** `AccountWidgetFrame` 继续使用公共 `ScrollArea`，通过 viewport class 配置 shadcn 渐隐深度和显隐距离，不增加覆盖层或滚动监听。`WidgetDensity` 从账号组件显式传到共享 `AccountUsageMetrics`，由共享组件统一控制三个账号提供方的数字和间距。

**技术栈：** React 19、TypeScript、Tailwind CSS v4、shadcn `scroll-fade`、Radix ScrollArea、Vitest、Playwright。

## 全局约束

- 每张卡只有一个实际纵向滚动所有者。
- 渐隐只作用于 Radix viewport，ScrollBar 保持为 viewport 的兄弟节点。
- 禁止使用覆盖层、负边距和 JavaScript 滚动监听模拟渐隐。
- 紧凑模式标签、账号名和重置时间不得低于现有字号；交互控件保持 28px。

---

### 任务一：锁定短滚动区的动态渐隐状态

**文件：**
- 修改：`tests/e2e/workbench-canvas.spec.ts`
- 修改：`tests/unit/renderer/scroll-area.test.tsx`
- 修改：`packages/ui/src/scroll-area.tsx`
- 修改：`packages/plugin-api/src/account-usage/account-widget-frame.tsx`

**接口：**
- 产出：`ScrollAreaProps.viewportFadeProfile`
- 消费：账号 viewport 的 `short` 渐隐配置

- [x] **步骤 1：编写失败的端到端断言**

在真实账号 viewport 中注入受控溢出内容，分别把 `scrollTop` 设为顶部、中部和底部，读取
`--scroll-fade-t`、`--scroll-fade-b`。要求顶部为 `0 / >0`，中部为 `>0 / >0`，
底部为 `>0 / 0`，并保持右缘误差不超过 `1px`。

- [x] **步骤 2：运行并确认测试因短滚动区底部渐隐不足而失败**

运行：

```bash
env -u ESBUILD_BINARY_PATH pnpm exec playwright test tests/e2e/workbench-canvas.spec.ts --grep "Codex accounts 在 dark"
```

预期：渐隐状态断言失败，其他结构断言继续通过。

- [x] **步骤 3：配置 shadcn 渐隐参数**

在公共 `ScrollArea` 中提供 `short` 预设，确保 Tailwind 从 `packages/ui` 的受扫描源码生成
不对称渐隐深度和短显隐距离；`AccountWidgetFrame` 只消费结构化接口：

```tsx
<ScrollArea
  viewportFade="vertical"
  viewportFadeProfile="short"
/>
```

- [x] **步骤 4：重新构建并确认端到端测试通过**

```bash
env -u ESBUILD_BINARY_PATH pnpm build:electron
env -u ESBUILD_BINARY_PATH pnpm exec playwright test tests/e2e/workbench-canvas.spec.ts --grep "Codex accounts 在 dark"
```

### 任务二：统一紧凑模式字号和间距

**文件：**
- 修改：`packages/plugin-api/src/account-usage/account-usage-metrics.tsx`
- 修改：`packages/plugin-codex/src/renderer/usage-meter.tsx`
- 修改：`packages/plugin-claude/src/renderer/usage-meter.tsx`
- 修改：`packages/plugin-grok/src/renderer/usage-meter.tsx`
- 修改：三个提供方的 `accounts-widget.tsx`
- 修改：`tests/unit/renderer/account-usage-metrics.test.tsx`

**接口：**
- 消费：`WidgetDensity`
- 产出：`AccountUsageMetricsProps.density?: WidgetDensity`

- [x] **步骤 1：编写失败的共享组件测试**

渲染 `density="compact"`，验证百分比使用 `text-base`、单项间距使用 `gap-1`、集合间距使用
`gap-2`；渲染默认模式，验证百分比仍使用 `text-lg`。

- [x] **步骤 2：运行并确认测试因缺少 density 契约而失败**

```bash
pnpm vitest run tests/unit/renderer/account-usage-metrics.test.tsx
```

- [x] **步骤 3：实现最小密度数据流**

给共享指标与三个 `UsageMeter` 增加可选 `density`，账号组件传入现有 `density`。紧凑模式只
调整数字与布局间距，不改变标签、重置时间、进度条和设置页默认样式。

- [x] **步骤 4：运行账号组件和共享组件回归**

```bash
pnpm vitest run \
  tests/unit/renderer/account-usage-metrics.test.tsx \
  tests/unit/renderer/codex-accounts-widget.test.tsx \
  tests/unit/renderer/claude-accounts-widget.test.tsx \
  tests/unit/renderer/grok-accounts-widget.test.tsx
```

### 任务三：完整验证

**文件：**
- 验证本计划所有修改文件

- [x] **步骤 1：运行格式、类型与依赖边界检查**

```bash
pnpm exec ultracite check \
  packages/plugin-api/src/account-usage/account-widget-frame.tsx \
  packages/plugin-api/src/account-usage/account-usage-metrics.tsx \
  packages/plugin-codex/src/renderer/accounts-widget.tsx \
  packages/plugin-codex/src/renderer/usage-meter.tsx \
  packages/plugin-claude/src/renderer/accounts-widget.tsx \
  packages/plugin-claude/src/renderer/usage-meter.tsx \
  packages/plugin-grok/src/renderer/accounts-widget.tsx \
  packages/plugin-grok/src/renderer/usage-meter.tsx \
  tests/unit/renderer/account-usage-metrics.test.tsx \
  tests/e2e/workbench-canvas.spec.ts
pnpm typecheck
pnpm depcruise
git diff --check
```

- [x] **步骤 2：运行相关单元、组件和端到端测试**

确认公共 ScrollArea、工作台滚动所有权、三个账号组件、共享用量指标和 Codex 真实
Electron 尺寸路径全部通过。

### 任务四：补足滚动终点的底部安全间距

**文件：**
- 修改：`tests/e2e/workbench-canvas.spec.ts`
- 修改：`packages/plugin-api/src/account-usage/account-widget-frame.tsx`

**接口：**
- 消费：`AccountWidgetFrameProps.density`
- 产出：用量滚动内容容器的密度化底部安全间距

- [x] **步骤 1：编写失败的真实样式断言**

在 `assertAccountScrollViewport` 中读取
`[data-slot="account-widget-usage-content"]` 的计算后 `padding-bottom`。紧凑模式必须不小于
`12px`，普通模式必须不小于 `16px`；该断言必须针对真实 Electron 构建产物运行。

- [x] **步骤 2：运行并确认旧间距失败**

```bash
env -u ESBUILD_BINARY_PATH pnpm exec playwright test \
  tests/e2e/workbench-canvas.spec.ts --grep "Codex accounts 在 dark"
```

预期：旧值紧凑 `10px` 或普通 `12px` 不满足安全间距。

- [x] **步骤 3：只修改共享滚动内容容器**

把 `AccountWidgetFrame` 的底部内边距改为：

```tsx
compact ? "px-2.5 pb-3" : "px-3 pb-4"
```

不得修改 Badge、各账号插件或滚动条几何。

- [x] **步骤 4：重新打包、构建并验证**

```bash
env -u ESBUILD_BINARY_PATH pnpm plugins:pack
env -u ESBUILD_BINARY_PATH pnpm build:electron
env -u ESBUILD_BINARY_PATH pnpm exec playwright test \
  tests/e2e/workbench-canvas.spec.ts --grep "Codex accounts 在 dark"
```
