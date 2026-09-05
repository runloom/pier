> 历史方案：点击直接打开完整审查已由 [2026-09-05 局部预览规格](../../../superpowers/specs/2026-09-05-files-local-diff-peek-design.md) 替代。本文保留当时的取舍记录。

# Files 编辑器 Git 变更条：点击跳转（原阶段 1 peek 计划已废弃）

**日期**：2026-08-08  
**依据**：[点击查看调研与选型](2026-08-08-files-editor-git-gutter-click-research-design.md)  
**前置**：[Git gutter v1](2026-07-17-files-editor-git-gutter-design.md)  
**状态**：**已交付** — 点击色条 → 宿主 `openUncommittedChanges` + `pendingReveal`（无编辑器内 peek）

---

## 1. 交付目标（当前）

1. 磁盘路径、source 模式下，**点击** git 色条打开/聚焦 **Git Changes**。
2. 经 `pendingReveal`（`allowGroupFallback: true`）滚到该文件、该行（new 侧）。
3. 已打开同 uncommitted source 的 Changes → 复用实例并更新 reveal。
4. 失败时 toast（i18n），禁止静默 no-op。
5. 色条在**行号右侧**；hover 略加粗 + `cursor: pointer`。

### 验收

| # | 场景 | 期望 |
|---|------|------|
| A | 点色条 | 打开/聚焦 Changes，滚到对应 diff 行 |
| B | 纯 staged 文件 | 落到 staged surface（group fallback） |
| C | 评论跳转 | 仍只认显式 group，不误 fallback |
| D | 无 git / 插件未装 | toast 失败文案 |
| E | 切回 File | 滚动位置不丢 |
| F | minimap / 主题 | 不回归 |

---

## 2. 非目标

- 编辑器内 Tooltip / peek / 局部 Revert
- staged/unstaged 双色条
- 未保存缓冲 vs HEAD 的 live gutter

---

## 3. 关键实现

| 模块 | 职责 |
|------|------|
| `git-markers.ts` | `buildGitGutterModel` → markers + 仅行号 ranges |
| `git-gutter.ts` | 可点轨 + navigate facet |
| `git-gutter-navigate.ts` | `openUncommittedChanges` + `allowGroupFallback` |
| `git-context.ts` | 宿主 facade（绕过跨插件 panels 断言） |
| `use-review-comments-binding.ts` | `resolvePendingRevealTarget` |
| `view-scroll-capture.ts` | 切换面板滚动快照 |

---

## 4. 一句话

> **点色条 = 打开 Changes 并 reveal 行；不在编辑器内做 diff peek。**
