# Git 提交主价值链设计 — 已取消

> 日期：2026-07-22（原文）  
> **状态：已取消（2026-07-25）**  
> 原范围：分组变更树 + Stage/Unstage All 工具条 + AI 提交说明 + 侧栏提交表单 + 提交后 Push/Publish

## 决策（现行）

Changes 面板 **不提供** 下列产品能力（有意不做，勿按本文件旧正文回补）：

1. **侧栏底部提交区**：提交说明输入、`Commit N staged` 按钮、⌘/Ctrl+Enter 提交、`GitCommitForm` / `git-commit-composer` 及同类 UI。
2. **树顶「全部暂存 / 全部取消暂存」工具条**：`GitReviewTreeToolbar`、`git-stage-all` 批处理入口（命令面板 Stage All 同范围）。
3. **AI 生成提交说明 / Composer / 提交后 Push·Publish 闭环** 作为 Changes 面板主价值链。

保留且允许继续演进的能力：

- 变更审查：分组树、section 锚定 diff、单文件 Stage / Unstage / Discard（树右键、diff header 等）。
- 宿主 `git.commit` / `git.stage` 等 **main IPC 与 CLI** 能力（给集成测试、其它入口用），**不**等于 Changes 面板要有提交 UI。
- 按 commit / branch 选 scope 的 review（`git-commit-pick` 等），与「对工作区做 commit」无关。

## 为何取消

产品选择：Changes 以审查与单文件整理为主，不在侧栏做提交主价值链。旧设计若继续作为实现依据，会把已删除 UI 再做回来。

## 给 agent / 实现者的硬约束

- **禁止** 以本文件或对应 plan 为理由重新引入：
  - `src/plugins/builtin/git/renderer/git-commit-form.tsx`
  - `git-commit-composer*.tsx` / `git-commit-composer-model.ts`
  - `git-review-tree-toolbar.tsx` / `git-stage-all.ts`
  - Changes 侧栏 `sidebarFooter` 提交表单、`sidebarHeader` Stage All 双按钮
  - 相关 locale：`ui.commitMessage*`、`ui.commitButton`、`ui.commitSuccess`、`ui.commitFailed`、`ui.stageAll*`、`ui.unstageAll*`
- 若未来要做「在 Pier 内 commit」，须 **新开** 设计与明确产品决策，不得复活本文件旧任务清单。

## 实现对照（取消后现状）

| 项 | 状态 |
| --- | --- |
| `git-changes-panel` 侧栏 commit 表单 | 已删除 |
| 树顶 Stage/Unstage All 工具条 | 已删除 |
| 分组树 + 单文件 stage/unstage/discard + diff review | 保留 |
| 本设计对应 implementation plan | 同步标记取消：`docs/superpowers/plans/2026-07-22-git-commit-mainline.md` |

---

以下正文为 2026-07-22 历史设计，**仅供考古，不得作为实现规格**。实现以本节「决策（现行）」为准。

<details>
<summary>历史正文（已作废，折叠）</summary>

原文件曾描述：Changes 面板 Stage All 工具条、AI 提交说明 Composer、`git.commit` 侧栏表单、提交后 Push/Publish、`gitCommit` 偏好、`pier.git.review.stageAll` 等。上述均已取消，细节不再维护。

</details>
