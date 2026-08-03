# Tooltip 聚焦默认策略设计

> 日期：2026-08-02
>
> 状态：已实施并验证

## 目标与完成标准

将共享 `TooltipTrigger` 的聚焦行为改为默认不展示 Tooltip。鼠标悬停仍可展示；调用方仅在已经确认聚焦提示确有必要时，显式传入 `openOnFocus={true}` 开启。

完成标准：

1. 键盘或程序化聚焦一个未配置 `openOnFocus` 的触发器时，不展示 Tooltip。
2. 悬停同一触发器时，Tooltip 仍按既有延迟和抑制逻辑工作。
3. `openOnFocus={true}` 仍能显式恢复键盘聚焦展示。
4. 视觉焦点环、`aria-label`、受控 `open` 和全局 Tooltip 抑制逻辑不改变。
5. 不为每个页面重复传入 `openOnFocus={false}`，也不新增全局用户偏好。

## 当前结构为何不足

`packages/ui/src/tooltip.tsx` 中的共享 `TooltipTrigger` 当前将 `openOnFocus` 默认设为 `true`。因此，任何未声明该属性的调用点都会将普通焦点变化视为展示 Tooltip 的触发条件。

已有代码只能在少数高频区域（工作区标签、状态栏）逐点传 `openOnFocus={false}`。这会遗漏新旧调用点，且已经导致“聚焦时莫名出现 Tooltip”的体验问题。组件测试也把默认聚焦打开作为现状行为覆盖，说明问题位于共享策略而非单个调用点。

## 方案比较

| 方案 | 做法 | 结论 |
| --- | --- | --- |
| A. 逐个调用点关闭 | 继续在每个 `TooltipTrigger` 上传 `openOnFocus={false}` | 不采用；遗漏风险高，无法保证默认策略。 |
| B. 在 `TooltipProvider` 增加全局开关 | 由 Provider 传递是否允许聚焦打开 | 不采用；Provider 管理延迟与悬停内容，不应承担单个触发器的交互策略。 |
| C. 在共享触发器收紧默认值 | 将 `TooltipTrigger` 默认设为 `false`，调用方显式 `true` 才开启 | 采用；策略所有权清晰，现有悬停能力不受影响，例外可审查。 |

## 所有权划分

| 层级 | 负责内容 |
| --- | --- |
| `TooltipTrigger` | 聚焦是否允许触发 Tooltip 的默认策略；保留显式 `openOnFocus` 例外。 |
| Radix Tooltip | Tooltip 的定位、悬停、受控打开、可访问性关联和生命周期。 |
| 调用方 | 为图标按钮等控件提供可访问名称；只有确认需要键盘聚焦提示时显式传 `openOnFocus={true}`。 |
| 全局抑制逻辑 | 继续处理菜单、拖拽、键盘操作和窗口失焦时的 Tooltip 关闭与抑制。 |
| 测试 | 锁定默认不因聚焦打开、悬停仍可打开、显式例外可打开。 |

这里没有新增持久化状态、设置项或跨进程数据流。

## 控制流

```text
触发器获得焦点
  → TooltipTrigger.handleFocus
  → 未显式配置或 openOnFocus=false：阻止 Radix 的焦点打开
  → openOnFocus=true：沿用现有键盘聚焦打开路径

指针悬停
  → Radix 原有 hover 路径
  → Tooltip 按既有延迟与全局抑制规则展示
```

聚焦只保留产品规定的 `focus-visible` 焦点环；Tooltip 不是焦点反馈的组成部分。

## 最小实施方案

1. 将 `TooltipTrigger` 的 `openOnFocus` 默认值从 `true` 改为 `false`，并更新注释，明确“默认关闭、显式开启”的规则。
2. 将现有“默认键盘聚焦会打开”的组件测试改为“默认不会打开”。
3. 新增或调整一项测试，证明 `openOnFocus={true}` 仍能打开；保留现有悬停测试以证明悬停行为未回退。
4. 审阅现有调用点：除非 Tooltip 内容没有等价的可访问名称且确有已验证的键盘发现需求，否则不添加显式开启。

## 禁止的反模式

- 在业务调用点继续无系统地补 `openOnFocus={false}`，把共享策略问题分散为局部补丁。
- 通过移除 Tooltip、禁用悬停或干预 `TooltipProvider` 延迟来规避聚焦误弹。
- 为了不展示 Tooltip 而移除键盘焦点环或将可操作控件移出 Tab 序。
- 用隐式约定保留例外；任何例外必须在调用点写出 `openOnFocus={true}`。

## 验收矩阵

| 需求 | 证据 |
| --- | --- |
| 默认聚焦不展示 | `tests/component/app/tooltip.test.tsx` 的默认触发器聚焦测试。 |
| 悬停保持可用 | 同文件既有 hover 测试。 |
| 可选支持 | 同文件 `openOnFocus={true}` 的聚焦测试。 |
| 不破坏 TypeScript 和 UI 组件边界 | `pnpm typecheck:packages` 与相关组件测试。 |
| 不引入无关调用点改动 | `git diff --check` 与变更审阅。 |
