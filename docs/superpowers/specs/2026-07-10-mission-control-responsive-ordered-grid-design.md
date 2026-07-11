# 指挥中心响应式有序网格设计

**日期**：2026-07-10
**状态**：已实施

## 目标和完成标准

指挥中心采用始终自动生效的响应式有序网格：删除后立即压实，添加追加到末尾，拖拽只改变阅读顺序，调整尺寸只改变用户的 `w/h` 偏好。Dockview 宽度变化自动换行，不写持久化参数，也不产生普通横向滚动。

完成标准：

- 全局菜单只保留“添加组件”和“全部刷新”，没有整理、锁定和方向模式。
- 持久化参数为 v3：实例数组顺序、`w/h` 和私有 `params`，不含 `x/y/locked/placementDirection`。
- 旧布局读取后按 `y → x → 原始索引` 得到稳定顺序，打开面板不主动写盘。
- 删除、添加、拖拽、键盘排序、调整尺寸和容器变化都遵循同一布局规则。
- 设置使用宿主对话框；系统资源物料响应公开的 `refreshToken`。

## 当前结构为什么不足

旧结构同时维护持久化自由坐标、RGL 手工布局、显式整理算法、锁定状态和新增方向。它产生了两套互相竞争的布局所有权：RGL 保存空洞，自定义求解器又在特定动作中重排。用户需要理解模式，删除后的空洞还会影响下一次添加位置；Dockview 变窄时则需要额外的坐标映射和横向滚动。

这些复杂度没有为本地开发工作台带来相称价值。指挥中心首先是信息仪表盘，稳定阅读顺序、自动适配窗口和低操作成本更重要。

## 所有权划分

| 层 | 所有权 |
| --- | --- |
| 共享契约 | v3 持久化形状、旧数据只读迁移、尺寸声明边界 |
| 面板状态 | 实例顺序、`w/h` 偏好、私有参数、刷新令牌和本地回声保护 |
| 布局策略 | 列数换算、稳定 Z 字排布、插入索引和顺序移动 |
| RGL | 指针拖拽与调整尺寸手势，不拥有持久化坐标和压实策略 |
| 面板 UI | 容器量测、派生布局、对话框和菜单装配、无障碍公告 |
| 物料 | 容器查询、三态、私有参数校验、刷新和可见性行为 |
| 测试 | 契约迁移、排序算法、状态回声、组件交互、重启恢复 |

## 数据流

```text
Dockview params
  → salvageMissionControlPanelParams（v3 原顺序 / 旧版 y-x 转序）
  → canonicalizeMissionControlPanelParams（去重、尺寸约束）
  → useMissionControlPanelState（唯一语义状态）
  → 容器宽度换算 2..12 列
  → deriveOrderedMissionControlLayout（临时 x/y）
  → RGL 渲染

用户添加/删除/拖拽/调整尺寸/修改设置
  → 更新实例数组或 w/h/params
  → api.updateParameters({ layoutVersion: 3, widgets })
```

容器尺寸变化只走上半段的派生流程，不进入写盘流程。刷新只更新本地 `refreshToken`，同样不写布局。

## 布局规则

- 列数按约 88px 单元和 12px 间距换算，限制为 `2..12`。
- 严格按实例数组顺序逐行放置；当前行剩余宽度不足时换行。
- 一行的下一行起点由本行最高物料决定，不做稠密回填，保证阅读顺序可预测。
- 窄容器只临时夹住显示宽度，不修改持久化偏好；变宽后自动恢复。
- 删除数组项后重新派生，因此空洞立即消失；新增和复制追加到数组末尾。
- 拖拽落点转换为数组插入位置；键盘方向键前后移动，`Shift + 方向键` 调整尺寸。
- 拖拽和调整尺寸预览必须绑定创建它的实例数组；删除、添加或外部参数更新一旦替换语义数组，旧预览立即失效，禁止不可见的旧条目继续占格。

## 明确禁止的反模式

- 不持久化响应式 `x/y`。
- 不同时启用 RGL compactor 和自定义排序求解器。
- 不保留“整理布局”“锁定布局”或横向/纵向新增模式。
- 不因容器变化主动写盘。
- 不用横向滚动掩盖普通响应式布局问题。
- 不用 `size` 推算像素响应内容；物料内容使用容器查询。
- 不把设置重新做成抽屉，也不绕过宿主对话框治理。

## 最小实施和验证

- 契约：`src/shared/contracts/mission-control.ts`
- 策略：`mission-control-ordered-layout.ts`
- 状态：`mission-control-panel-state-normalization.ts`、`use-mission-control-panel-state.ts`
- UI：`mission-control-panel.tsx`、`mission-control-context-menu.ts`、`mission-control-settings-dialog.tsx`
- 验证：类型检查、布局与迁移单元测试、面板交互组件测试、重启恢复端到端测试。

## 需求到证据的验收矩阵

| 需求 | 代码证据 | 测试证据 |
| --- | --- | --- |
| 删除自动压实 | 数组删除 + 统一派生布局 | `use-mission-control-panel-state.test.tsx`、`mission-control-ordered-layout.test.ts` |
| 添加不复用删除坐标 | 新实例追加数组末尾 | 状态单元测试、物料库组件测试 |
| 容器宽度自动适配 | `resolveResponsiveGridCols` + 临时宽度夹取 | 有序布局单元测试、画布组件测试 |
| 拖拽只改顺序 | 插入索引 + `handleReorder` | 画布组件测试、键盘组件测试 |
| 无整理/锁定/方向 | 精简原生菜单与 v3 契约 | 面板、上下文菜单组件测试 |
| 旧数据安全迁移 | `salvageMissionControlPanelParams` | 共享契约和状态单元测试 |
| 设置使用弹窗 | `MissionControlSettingsDialog` | 物料库组件测试 |
| 系统资源可刷新 | `refreshToken` 进入数据刷新链 | `system-resources-widget.test.tsx` |
