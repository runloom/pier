# shadcn 组件使用规范 — 金标准

日期：2026-09-09
状态：已确认。本文是 shadcn 组合边界的唯一权威细则；AGENTS.md「shadcn 组件使用规范」只保留不变量与指针。正文 2026-09-09 自 AGENTS.md 迁入，规则文字不变。

宿主 renderer 与官方插件 renderer 的业务界面统一以 `packages/ui` 中的 shadcn 组件为
组合边界：

- 头像必须使用 `Avatar` 并提供 `AvatarFallback`；有独立卡片标题的卡片使用完整的
  `CardHeader` / `CardContent` 组合。设置页一级标题位于卡片外，不得为了补齐
  `CardHeader` 把页面标题移入卡片；列表项、提示、空态、进度、骨架和分隔线分别使用
  `Item`、`Alert`、`Empty`、`Progress`、`Skeleton` 和 `Separator`。
- 表单使用 `FieldSet` / `FieldGroup` / `Field`；输入内附加元素使用 `InputGroup`；
  选项组使用 `ToggleGroup`。业务代码不得直接渲染原生 `input`、`select`、`textarea`
  或 `hr`。
- `SelectItem`、菜单条目、`CommandItem` 和 `TabsTrigger` 必须处于对应 Group / List
  容器中；对外拆出的条目渲染函数也必须由调用方在同一文件内提供容器。
- Button 和菜单中的图标不设置尺寸类，由组件变体控制；Button 图标必须声明
  `data-icon`。组件 `className` 只承担布局、尺寸约束和交互状态，不覆盖组件色彩或字体。
- 不得用上一条机械删除产品语义：命令、路径、环境变量和格式标识继续使用等宽字体，
  `Kbd` 只表示键盘输入；终端状态栏、搜索栏和响应式物料可保留已验证的紧凑几何。
- 禁止 `space-x-*` / `space-y-*`、`className` 模板字符串、手写加载占位、提示卡、
  徽标和普通交互按钮。条件类统一走 `cn()`。
- 允许保留专用渲染：Dockview tab 原生动作、shadcn Sidebar 自身实现、终端/调试几何
  画布、图表及物料静态预览。这些例外不得扩展为普通业务表单或信息卡。

检查点在 `tests/unit/renderer/app/shadcn-governance.test.ts`；新增例外必须写明组件边界和
无法使用现有 shadcn 原语的原因。
