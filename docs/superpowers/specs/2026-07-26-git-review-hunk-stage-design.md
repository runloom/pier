# Git Review：Hunk Stage / Unstage / Revert（对齐 Codex App）

> 日期：2026-07-27  
> 状态：**按 Codex 本地包重做**  
> 范围：Changes uncommitted 审查中，按 **hunk 工具条** 对 index / 工作区应用 unified patch

## 1. 权威来源

本地安装包：`/Applications/ChatGPT.app`（Codex）asar 反编译结论。

| 层 | Codex 行为 |
| --- | --- |
| UI | 每 hunk hover 工具条 Stage / Unstage / Revert（非 gutter `+` 选区） |
| Pierre | `annotations` + `renderAnnotation`；metadata `{ kind: "hunk-actions", path, hunkIndex }` |
| 动作载荷 | `{ path, hunkIndex, action, scope: "hunk" \| "file" }` |
| 抽 patch | 从 unified 文本按 `@@` 切 hunk；回退从 `FileDiffMetadata` 重建 |
| 宿主 | `apply-patch`：`{ cwd, diff, atomic, revert, target }` → temp 文件 + `git apply` |

### 1.1 action → git apply（Codex `Vx`）

| action | variant | target | revert |
| --- | --- | --- | --- |
| stage | * | `staged` | false → `git apply --cached` |
| unstage | * | `staged` | true → `git apply -R --cached` |
| revert | unstaged | `unstaged` | true → `git apply -R` |
| revert | staged | 先 `staged` 再 `unstaged` | true（两步） |

Review 路径 `atomic: true`（不加 `--3way`）。

## 2. Pier 实现

### 2.1 数据流

```
hover hunk → Stage / Unstage / Revert
  → extractHunkPatch(filePatch, [hunkIndex])
  → git.applyPatch({ cwd, diff, atomic: true, revert, target })
  → git apply [--cached] [-R] temp/patch.diff
  → git-watch pulse → 审查刷新
```

### 2.2 关键代码

| 路径 | 职责 |
| --- | --- |
| `packages/ui/src/diff-view-hunk-actions.tsx` | hunk 工具条 + annotation metadata |
| `packages/ui/src/diff-view-items.ts` | `stageControl` 时挂 `annotations` |
| `packages/ui/src/diff-view.tsx` | `renderAnnotation` / `onHunkAction`；`enableGutterUtility: false` |
| `src/shared/git-patch-hunk.ts` | `extractHunkPatch` |
| `src/main/services/git-apply-patch.ts` | Codex `git apply` |
| `git.applyPatch` | IPC 契约 |
| `git-review-hunk-actions.ts` | action → apply 参数映射 |
| `git-review-code-view.tsx` | 接线 + Revert 确认 |

### 2.3 UI（对齐 Codex 本地包 `wa` / `Tn` / `jt`）

| 项 | 行为 |
| --- | --- |
| 锚点 | 每个 **change 块** 各一枚 pill（跳过 context；块末行优先 +）；动作仍用整段 `hunkIndex`（非 sub-hunk apply） |
| 定位 | Codex `Tn`：`absolute -top-8.5 right-0.5`（行级 annotation 槽上浮，非整块 bottom-right） |
| 显示 | 按**文件** hover（document light-DOM CSS）；默认隐藏 |
| 按钮 | `icon-xs` + `ghost` + `tone="muted"` + Tooltip（同文件头） |
| 状态 | unstaged → Revert + **Stage**；staged → Revert + **Unstage** |

### 2.4 明确不做（本迭代）

- VS Code `stageSelectedLines` / `update-index` 选区暂存
- Pierre `enableGutterUtility` 作为 stage 入口
- section 级 `apply-review-section-changes`

## 3. 交互

1. 打开 **Changes**（uncommitted）。  
2. 悬停文件 diff → 每个 hunk 右上出现 Stage|Unstage + Revert。  
3. Unstaged：Stage / Revert；Staged：Unstage / Revert（两步）。  
4. 成功：watch 刷新（无成功 toast）；失败：alert / notifyError。  
5. 文件头整文件 Stage/Unstage 保留。

## 4. 验收

- `tests/unit/shared/git-patch-hunk.test.ts`
- `tests/unit/shared/git-review-hunk-actions.test.ts`
- `tests/unit/main/git-apply-patch.test.ts`
- 治理：`enableGutterUtility: false`；存在 `onHunkAction` / `renderPierHunkAnnotation`
