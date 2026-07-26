# Git 提交主价值链 Implementation Plan — 已取消

> **状态：已取消（2026-07-25）**  
> **Spec（同步取消）:** [docs/superpowers/specs/2026-07-22-git-commit-mainline-design.md](../specs/2026-07-22-git-commit-mainline-design.md)

## 不要执行本 plan

本 plan 中的任务（Stage/Unstage All 工具条、AI Composer、侧栏 `GitCommitForm` / commit 按钮、Push/Publish、`gitCommit` 偏好、`pier.git.review.stageAll` 等）**全部作废**。

Changes 面板现行边界：

- **做**：分组变更树、diff 审查、单文件 Stage / Unstage / Discard。
- **不做**：侧栏提交说明与提交按钮、全部暂存/全部取消暂存双按钮工具条、AI 生成提交说明主价值链。

对应 UI 与辅助模块已从代码库移除。若按本 plan 的 Task 列表继续实现，属于 **回退**，禁止。

新需求须新开 design/plan，不得勾选或继续本文件历史 checkbox。
