# Git 确认提交（金标准终态）

日期：2026-08-29  
状态：现行权威（人手交卷确认卡 · 金标准）  
范围：命令 `pier.git.commit` + 提交型 content dialog；未提交审查 header 同一入口。  
不包含：Changes 侧栏作曲栏、Stage All、AI 生成说明、amend、开 PR、Canvas `git.commit`、合并/变基进行中用本对话框收尾。

继任关系：本文件取代已取消的 [2026-07-22 提交主价值链](./2026-07-22-git-commit-mainline-design.md)。确认卡 **不是** 已取消的 `sidebarFooter` / `GitCommitForm`。

## 一句话终态

审查继续在 Changes；交卷是一次确认（命令或 header「提交」），不是侧栏常驻输入框。对标 Codex App 的 command-menu 确认卡，用 Pier 已有弹窗规范落地。打开即写说明；提交以**当时**的 `getStatus` 为真源。

## 产品词

- 命令：「git: 提交」
- 弹窗标题：「确认提交」（英文 Commit，与按钮同词）
- 按钮：「提交」
- 成功 toast：「已提交」
- 弹窗说明：「提交当前更改。」命令说明同步为当前更改，禁止「只交已暂存」
- 空工作区：「没有可提交的更改。请先修改文件。」
- 禁止已取消 mainline 的 locale：`ui.commitButton` / `ui.commitMessage*` / `ui.commitSuccess` / `ui.commitFailed`

## 做 / 不做

做：

- 命令 `pier.git.commit`（`git:write`），与 `Undo Last Commit` 对称
- 提交型 content dialog：说明必填、包含未暂存（有未暂存时默认开）、提交后推送（设置默认关，dialog 只读初值）
- 未提交审查 header「提交」打开**同一 handler**；按钮在视图工具栏**最右**
- 只提交 index；勾未暂存时按路径 `git.stage` 再 commit，**禁止** `git add -A`
- 打开即聚焦说明；Enter 换行；Mod+Enter 提交
- 打开后计数/资格跟 `useGitStatus`（与状态栏同一 watch）；提交再 `getStatus`

不做：

- Changes `sidebarFooter`、Stage All 顶栏、AI 说明、开 PR、amend、Canvas `git.commit`
- 合并/变基/cherry-pick/revert 进行中用本对话框收尾——继续走状态栏 Continue/Abort
- 记住「包含未暂存」或通用 `rememberDialogField`
- 对话框勾选回写「提交后推送」设置

## 交互

弹窗：`context.dialogs.open`，`id: "git-commit"`，`size: "sm"`。

- `DIALOG_COMMIT_FORM_CLASS` + 垂直 `Field`：`Textarea` + 两个 `Checkbox`
- `setFooter`：`取消 | 提交`，主按钮 `type="submit"`
- 打开后说明框 `focus({ preventScroll: true })`；Enter 换行；Mod+Enter（⌘/Ctrl+Enter）在可提交时走同一 `onSubmit`。禁止工作树任务框那种裸 Enter 提交。不要在 footer 加快捷键说明条。
- 打开前 `getStatus`：
  - `repoState.kind !== "clean"` → alert「请先在状态栏继续或中止当前 git 操作」
  - 工作区完全干净 → alert「没有可提交的更改」
  - 仅有未暂存：允许打开；提交按钮在默认勾选「包含未暂存」且说明非空时可用（取消勾选则禁用）
- 打开后 live：`useGitStatus(context, cwd)` 更新计数与推送资格。`loading` / `error` **保持最近一次 loaded**（打开快照起步），不要回落到打开瞬间把勾选冲掉。暂停或工作区变空 → 禁用提交，`FieldError` 用 `gitCommitPaused` / `gitCommitNothing`，**不关窗**。
- **包含未暂存的更改** 有未暂存时默认勾选；无未暂存时勾选 disabled。**不记忆**上次打开。本窗用户点过勾选后 sticky；未点过时：0→有则勾上，有→0 则关并 disabled。
- **提交后推送** 初值读插件设置 `pier.git.commit.pushAfter`（设置 → git，默认关）。仅当本次可 `push` / `publish` 时勾选；有上游 → `push`；无上游且可发布 → `publish`；分离头指针隐藏；无远程资格 / 需登录则 disabled + 说明。对话框内勾选是这一次的决策，**不回写**设置。用户点过 sticky；未点过时随资格：不能推则关；又能推则回到设置初值。点提交时若用户要推：用这一次 `getStatus` 的资格；已有同步 in-flight → 不 join，走推送失败 alert；本轮 `push` / `publish` 经 `trackSync` 占槽，不走 `runRemoteSyncAction`（避免叠 Push/Publish toast）。成功只保留「已提交」。
- **提交权威**：点提交时再 `getStatus`，用这一次的 files / `repoState` 做闸门与 `unstagedPathsFromStatus`。`includeIntent === null` 时用这一次计数重算默认勾选；点过则 sticky。禁止用打开瞬间的快照去 `git.stage`。
- Header「提交」与命令同一 `runGitCommitCommand`；未预期错误走 `showError`，禁止吞掉。
- 禁止为此弹窗加 dialog 字段记忆层或通用 `rememberDialogField`。取消 / Esc 丢弃草稿（含勾选）。
- 提交中 footer 禁用、`setDismissible(false)`；Esc 有草稿说明时 `setOnDismissRequest` 确认丢弃（`intent: "default"`）

失败：commit 失败 `dialogs.alert` 带 `Error.message`；commit 成功但推送失败（资格不够 / 已有同步 / push 出错）→ **不回滚**，alert 推送失败（下一步去状态栏重试）。提交时工作区已暂停/已空 → `FieldError`，不关窗。

## 目录

新代码只进 `src/plugins/builtin/git/renderer/commit/`（renderer 根与 `review/` 已满 40 文件）。

底层 IPC 不改：`GitService.commit` 是 `git commit -m`；`stagePaths` 按路径 `add`。

## 智能体约定

不新增宿主「代智能体 commit」RPC。用户已在 Changes 整理过则只提交已暂存，禁止 `git add -A`。人手走本对话框。

## 检查点

- `tests/unit/renderer/git/changes-panel-governance.test.ts`（禁 footer，允许 `renderer/commit/`）
- `tests/unit/renderer/git/commit-paths.test.ts`
- `tests/unit/renderer/git/commit-submit.test.ts`
- `tests/unit/renderer/git/plugin.test.tsx`
- `tests/unit/renderer/app/dialog-form-governance.test.ts`
- `tests/unit/renderer/search/action-search.test.ts`
- `tests/unit/renderer/git/review/panels.test.tsx`
- `tests/component/app/git-commit-overlay.test.tsx`
- `tests/e2e/git/commit.spec.ts`
