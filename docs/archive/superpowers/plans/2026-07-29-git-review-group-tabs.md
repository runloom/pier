# Git 变更分组页签实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** Git 变更正文顶部页签与目录树使用同一套分组文案、顺序和存在性，并把冲突内容从普通更改阅读投影中分离出来。

**架构：** `git-review-surface-group.ts` 持有唯一的产品展示顺序和分组/阅读面映射，树、页签、正文排序、挂载列表和会话生命周期都从这里派生；树模型同时产出实际存在的有序分组。渲染层增加独立的冲突阅读面，冲突与普通更改继续复用同一份 Git 文件文档和 `index` 比较基线，但分别维护投影、章节索引、会话与阅读锚点。

**技术栈：** React 19、TypeScript 6、`@pierre/diffs`、Vitest 4、Playwright。

## 全局约束

- 分组顺序固定为 `conflict → staged → unstaged`，提交历史阅读面不进入该页签。
- 页签文案必须复用目录树的 `reviewTreeGroupConflict`、`reviewTreeGroupStaged`、`reviewTreeGroupUnstaged`。
- 页签只能来自树模型实际生成的分组根，禁止在页签组件内维护第二套分组数组或翻译键。
- 冲突阅读面只投影 `conflict`，普通更改阅读面只投影 `unstaged`，已暂存阅读面只投影 `staged`。
- 分组仍存在时，暂存或取消暂存不得改变活动阅读面或当前阅读锚点。
- 活动分组消失时，必须先在后台物化目标分组和对应文件锚点，再切换可见阅读面；禁止显示空白中间帧。
- 不使用延时补偿、直接写 `scrollTop`、CSS 隐藏无效页签或按本地化文案推断分组。
- 所有行为修改先写失败测试，再写实现。

---

### 任务 1：让树模型成为分组目录的唯一所有者

**文件：**

- 修改：`tests/unit/renderer/git-review-tree-model.test.ts`
- 修改：`src/plugins/builtin/git/renderer/git-review-tree.tsx`

**接口：**

- 产出：`GitReviewTreeModel.visibleGroups: readonly GitReviewUncommittedGroup[]`
- 产出：`git-review-surface-group.ts` 中的 `GitReviewUncommittedGroup = "conflict" | "staged" | "unstaged"`

- [x] **步骤 1：补充失败测试**

  断言 `visibleGroups` 与目录树实际生成的根严格一致；有冲突时顺序为 `conflict、staged、unstaged`，没有冲突时不包含 `conflict`。

- [x] **步骤 2：运行测试确认失败**

  运行：

  ```bash
  pnpm vitest run tests/unit/renderer/git-review-tree-model.test.ts
  ```

  预期：因 `visibleGroups` 尚不存在而失败。

- [x] **步骤 3：实现最小分组目录**

  导出未提交分组类型和顺序常量，在创建目录树根时同步收集 `visibleGroups`；不从 `groupCounts` 二次猜测根是否存在。

- [x] **步骤 4：运行测试确认通过**

  运行：

  ```bash
  pnpm vitest run tests/unit/renderer/git-review-tree-model.test.ts
  ```

### 任务 2：分离冲突阅读投影

**文件：**

- 修改：`tests/unit/renderer/git-review-document-projection.test.ts`
- 修改：`tests/unit/renderer/git-review-session-cache.test.ts`
- 修改：`src/plugins/builtin/git/renderer/git-review-reading-surface.ts`
- 修改：`src/plugins/builtin/git/renderer/git-review-surface-group.ts`
- 修改：`src/plugins/builtin/git/renderer/git-review-document-ledger-projection.ts`
- 修改：`src/plugins/builtin/git/renderer/git-review-document-projection-index.ts`
- 修改：`src/plugins/builtin/git/renderer/git-review-document-estimates.ts`
- 修改：`src/plugins/builtin/git/renderer/git-review-session-cache.ts`

**接口：**

- 产出：`GitReviewReadingSurface = "conflict" | "index" | "staged" | "committed"`
- 产出：`reviewGroupsForSurface("conflict") = ["conflict"]`
- 产出：`reviewGroupsForSurface("index") = ["unstaged"]`

- [x] **步骤 1：补充失败测试**

  分别断言冲突阅读面只生成冲突项、普通更改阅读面不再生成冲突项，并断言两个阅读面的会话键不同。

- [x] **步骤 2：运行测试确认失败**

  运行：

  ```bash
  pnpm vitest run tests/unit/renderer/git-review-document-projection.test.ts tests/unit/renderer/git-review-session-cache.test.ts
  ```

- [x] **步骤 3：实现独立冲突阅读面**

  扩展渲染层阅读面联合类型；所有投影、估算、章节索引和会话清理逻辑显式处理 `conflict`。文件读取契约不新增比较基线，仍读取同一份权威文档。

- [x] **步骤 4：运行测试确认通过**

  运行：

  ```bash
  pnpm vitest run tests/unit/renderer/git-review-document-projection.test.ts tests/unit/renderer/git-review-session-cache.test.ts
  ```

### 任务 3：让顶部页签消费树分组并保持导航稳定

**文件：**

- 修改：`tests/unit/renderer/git-review-panels.test.tsx`
- 修改：`tests/e2e/git-review.spec.ts`
- 修改：`src/plugins/builtin/git/renderer/git-review-surface-switcher.tsx`
- 修改：`src/plugins/builtin/git/renderer/git-review-surface-view.tsx`
- 修改：`src/plugins/builtin/git/renderer/git-review-surfaces.tsx`
- 修改：`src/plugins/builtin/git/renderer/git-review-surface-types.ts`

**接口：**

- 消费：`treeModel.visibleGroups`
- 消费：目录树 `treeGroupLabels`
- 产出：页签顺序、文案和显隐与树根完全一致。

- [x] **步骤 1：补充失败测试**

  覆盖：

  - 无冲突时页签为 `Staged Changes、Changes`。
  - 有冲突时页签为 `Merge Changes、Staged Changes、Changes`。
  - 只有目录树生成的分组才有页签。
  - 点击冲突文件激活冲突阅读面且只显示冲突正文。
  - 分组仍存在时，暂存后活动页签和阅读锚点不变。

- [x] **步骤 2：运行测试确认失败**

  运行：

  ```bash
  pnpm vitest run tests/unit/renderer/git-review-panels.test.tsx
  ```

- [x] **步骤 3：实现共享页签和导航**

  页签组件接收树模型的有序分组和标签，不再调用独立翻译键；`ReviewDocuments` 按可见分组挂载阅读面，树导航将冲突映射到独立冲突阅读面。活动分组消失时沿既有 `preserve` 导航事务完成后台物化后再交接。

- [x] **步骤 4：运行目标测试**

  运行：

  ```bash
  pnpm vitest run tests/unit/renderer/git-review-panels.test.tsx tests/unit/renderer/git-review-tree-model.test.ts tests/unit/renderer/git-review-document-projection.test.ts tests/unit/renderer/git-review-session-cache.test.ts
  ```

- [x] **步骤 5：运行类型和治理检查**

  运行：

  ```bash
  pnpm typecheck
  pnpm vitest run tests/unit/renderer/git-review-reading-stability-governance.test.ts tests/unit/renderer/git-diff-governance.test.ts
  ```

## 需求到证据的验收矩阵

| 需求 | 证据 |
|---|---|
| 页签和树文案一致 | `git-review-panels.test.tsx` 使用树标签断言页签文本 |
| 页签和树顺序一致 | `git-review-tree-model.test.ts` 与面板页签顺序断言 |
| 只展示树中存在的分组 | `visibleGroups` 根集合测试与页签显隐测试 |
| 冲突内容独立 | 投影测试和冲突树导航组件测试 |
| 暂存后不跳走 | 既有阅读稳定性测试及面板暂存回归 |
| 分组消失无空白帧 | `git-review.spec.ts` 的真实暂存连续帧探针 |
| 没有双重分组定义 | 治理测试和最终代码审查 |
