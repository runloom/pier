# 指挥中心响应式有序网格实施方案

**目标**：用单一自动布局策略替代自由坐标、显式整理、锁定和新增方向，同时保留顺序拖拽与自由调整尺寸。

## 实施清单

- [x] 将 panel params 升级为 v3，只持久化实例顺序、`w/h` 和私有参数。
- [x] 增加旧版 `x/y` 到稳定阅读顺序的只读迁移，初次挂载不写盘。
- [x] 实现按容器宽度换算列数的稳定 Z 字布局，不做稠密回填。
- [x] 删除自由画布范围、高水位和显式自动整理算法。
- [x] 删除锁定、整理和方向状态及其菜单、文案和回调。
- [x] 添加与复制统一追加，删除后统一重新派生，拖拽只提交数组顺序。
- [x] 保留 RGL 调整尺寸，只提交目标实例的 `w/h` 偏好。
- [x] 窄容器临时夹取显示宽度，普通视图禁止横向滚动。
- [x] 键盘方向键改为顺序移动，`Shift + 方向键` 调整尺寸。
- [x] 自定义物料设置改用宿主对话框。
- [x] 系统资源物料接入 `refreshToken`。
- [x] 重写契约、策略、状态和组件测试；更新重启恢复端到端用例。
- [x] 更新项目架构说明和验收矩阵。

## 验证命令

```bash
pnpm typecheck
pnpm exec vitest run tests/unit/shared/mission-control-contracts.test.ts tests/unit/renderer/mission-control-ordered-layout.test.ts tests/unit/renderer/use-mission-control-panel-state.test.tsx tests/unit/renderer/mission-control-merge.test.ts
pnpm exec vitest run tests/component/mission-control-panel.test.tsx tests/component/mission-control-library.test.tsx tests/component/mission-control-canvas.test.tsx tests/component/mission-control-keyboard-layout.test.tsx tests/component/mission-control-context-menu-regressions.test.tsx tests/component/mission-control-regressions.test.tsx tests/component/system-resources-widget.test.tsx
pnpm lint
pnpm depcruise
pnpm check:file-size
```

端到端验证在完成 Electron 构建后运行：

```bash
pnpm exec playwright test --config playwright.config.ts tests/e2e/mission-control-canvas.spec.ts tests/e2e/mission-control-widget-persistence.spec.ts
```
