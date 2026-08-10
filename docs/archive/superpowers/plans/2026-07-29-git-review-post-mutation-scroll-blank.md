# Git Review 暂存后滚动空白修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 暂存或取消暂存改变成员集合后，当前阅读面继续滚动时始终展示正确代码内容；成员为空时展示明确空态。

**架构：** Git 主进程继续只提供权威索引；阅读面投影决定成员身份；`packages/ui` 作为 Pierre 成员提交、布局刷新和锚点恢复的唯一所有者。成员变更必须在一次可验证的同步布局事务内完成，空集合不再交给保留中的 CodeView 表达。

**技术栈：** React 19、TypeScript 6、`@pierre/diffs`、Vitest 4、Playwright。

## 全局约束

- 暂存后不自动切换未暂存/已暂存阅读面。
- 不直接写 `scrollTop`，不使用延时补滚动，不用遮罩掩盖空白。
- 暂存改变成员时保持当前可视代码行锚点（包含 sticky header 几何）；锚点所属文件消失时选择同阅读面的后继或前驱，并从该文件顶部落点，禁止继承旧文件内部滚动深度。
- 成员确实为空时展示明确空态，不保留可滚动的空 CodeView。
- 权威空集合立即成为当前文档；不得用旧投影长期冒充当前 Git 状态。
- 失败用例必须先失败，再实施修复。

---

### 任务 1：锁定成员变更后的同步布局契约

**文件：**

- 修改：`tests/unit/renderer/diff-view-item-sync.test.ts`
- 修改：`packages/ui/src/diff-view-item-sync.ts`

**接口：**

- 消费：`applyCodeViewItemsAnchored(handle, nextItems, previousItems, options)`
- 产出：成员重排、锚点回退与最终同步布局在同一提交中完成。

- [x] 添加回归测试：成员删除导致锚点回退时，先提交唯一滚动目标，再执行同步 `render(true)`。
- [x] 运行测试并确认因缺少回退后的同步布局而失败。
- [x] 最小修改 `applyCodeViewItemsAnchored`，使程序化回退与两次布局收敛属于同一事务。
- [x] 运行单元测试并确认通过。

### 任务 2：空成员显示明确空态

**文件：**

- 修改：`tests/unit/renderer/git-review-code-view.test.tsx` 或相邻文档视图测试
- 修改：`src/plugins/builtin/git/renderer/git-review-document-view.tsx`
- 修改：`src/plugins/builtin/git/locales/zh-CN.json`
- 修改：`src/plugins/builtin/git/locales/en.json`

**接口：**

- 消费：`projection.items`、`viewState.settled`
- 产出：终态空成员渲染 `Empty`，不向 Pierre 提交 `items=[]`。

- [x] 添加回归测试：曾经展示过 CodeView 的阅读面在 settled 后变为空集合时显示空态且卸下 CodeView。
- [x] 运行测试并确认当前保留空 CodeView 的行为导致失败。
- [x] 使用现有 `Empty` 原语和本地化文案实现最小空态。
- [x] 运行组件测试并确认通过。

### 任务 3：补齐暂存完成后滚动验证

**文件：**

- 修改：`tests/e2e/git-review.spec.ts`

**接口：**

- 消费：真实暂存/取消暂存流程。
- 产出：暂存释放后继续滚动若干帧，断言活动阅读面可视行连续存在。

- [x] 在非空源面场景中，暂存释放后执行真实滚轮滚动并逐帧采样。
- [x] 断言连续空白帧为 0，且活动阅读面和 CodeView 根身份稳定。
- [x] 空源面单独断言明确空态，删除该路径对空白画布的豁免。
- [x] 运行目标端到端测试并确认通过。

## 需求到证据的验收矩阵

| 需求 | 证据 |
|---|---|
| 暂存后滚动无空白 | `tests/e2e/git-review.spec.ts` 暂存后滚动逐帧探针 |
| 高文件深滚后删除不继承旧深度 | `large.ts` 真实整文件暂存断言相邻文件顶部误差不超过 4px |
| 阅读面不切换 | 活动 `data-git-review-surface` 身份断言 |
| 阅读锚点稳定 | 既有 `anchorDeltaPx <= 4` 与新增最终同步布局单测 |
| 空集合不显示空画布 | 文档视图组件测试断言 `Empty` 且无 `pierre-diff-root` |
| 无延时补偿和 raw scrollTop | `git-review-reading-stability-governance.test.ts` 与代码审查 |
