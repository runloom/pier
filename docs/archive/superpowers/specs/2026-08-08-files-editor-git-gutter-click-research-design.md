> 历史方案：点击直接打开完整审查已由 [2026-09-05 局部预览规格](../../../superpowers/specs/2026-09-05-files-local-diff-peek-design.md) 替代。本文保留当时的取舍记录。

# Files 编辑器 Git 变更条：点击查看调研与选型

**日期**：2026-08-08  
**范围**：在现有 Files 源码编辑器 git gutter 上，评估「点击色条查看该段 diff」是否可做、CodeMirror 生态如何做、Pier 选哪条路径  
**关联文档**：

- [2026-07-17-files-editor-git-gutter-design.md](2026-07-17-files-editor-git-gutter-design.md)（已交付：仅指示条；点击/预览为**非目标**）
- [2026-07-17-files-editor-minimap-design.md](2026-07-17-files-editor-minimap-design.md)（minimap 与 gutter 共用 markers）
- [2026-07-14-git-diff-review-polish-design.md](2026-07-14-git-diff-review-polish-design.md)（Git 插件完整 diff / review，职责不抢）

**状态**：调研 + 选型确认（尚未进入实现 PR）

---

## 1. 问题

用户在源码编辑中能看到相对 HEAD 的绿/蓝/红色条，但**无法点击查看该段改了什么**（尤其删除行：红条不占正文，不点就看不到被删文本）。

期望来源主要是 VS Code / JetBrains 的肌肉记忆，不是 CodeMirror 默认能力。

---

## 2. 业界对照（产品标杆 vs CM 生态）

### 2.1 完整 IDE（非 CodeMirror）

| 产品 | 点击 gutter 变更条 |
|------|-------------------|
| **VS Code** | 弹出该 hunk 的 inline change review；可 revert / stage；可开完整 diff |
| **JetBrains** | 点击或悬停后 inline 预览 + 工具条：rollback、上下跳 hunk、完整 diff |
| **Cursor 等 VS Code 系** | 大体同源；部分 staged 装饰有缺口 |

共性：色条可点 → **轻量就地 peek**，默认不强制整文件 diff；删除标记最依赖点击。

### 2.2 使用 CodeMirror 的产品 / 库

| 来源 | 做法 | 点击 peek？ |
|------|------|-------------|
| **CodeMirror 官方** | `gutter` + `domEventHandlers`；`@codemirror/merge` 的 `unifiedMergeView` / `Chunk` / accept·reject | **无**「SCM 色条 + 点击 peek」一等公民 |
| **Replit**（公开讨论） | 自研 gutter 标 modified/inserted；用 `@codemirror/merge` 的 `diff` / `Chunk` 对比 HEAD；增量更新曾向上游要 API | 公开信息停在**画条**；完整 diff 偏 Git 面板 |
| **Obsidian（CM6）** | 社区反馈长期无 VS Code 式行级 git gutter；Git 插件走面板 + 独立 diff | 基本**不做**编辑中 peek |
| **Magia / Blueberry 等** | 营销常见「git gutter + 独立 diff 查看器」 | 未见公开「点色条 = VS Code peek」设计 |
| **开源 npm 生态** | **无**事实标准的 `codemirror-git-gutter-peek` 类包 | — |

**调研结论**：

1. 「点 gutter 看 diff」的成熟体验在 **Monaco / 原生 IDE**，不在 CM 标配。
2. CM 侧严肃产品常见交付是 **只画条，或条 + 外置完整 diff**；与 Pier v1 同级。
3. 要 VS Code 级 peek，在 CM 上几乎都是 **产品自建**，没有可直接依赖的成熟开源组件。
4. 算法/数据可参考 Replit：用 merge 包算 chunk；交互标杆仍应对齐 VS Code / JetBrains。

---

## 3. CodeMirror 上的三条实现路径

| 路径 | 形态 | 适用 | 成本 | 与「边写边看」 |
|------|------|------|------|----------------|
| **A. 日常编辑 + 自定义 peek** | 独立 git gutter + `mousedown` → Tooltip 或 block widget 展示该 hunk 旧/新内容 | 默认编辑态 | 中～高 | 最好 |
| **B. 整文件 unified merge 模式** | `@codemirror/merge` 的 `unifiedMergeView({ original })` + chunk 控件 | 「打开变更」/ 冲突 / AI review | 中（接库） | 差（需切模式） |
| **C. 仅指示，详情外置** | 色条 + minimap；详情走 Git review 面板 | v1 已交付 | 低 | 弱 |

CodeMirror 原语对照：

- 可点轨：`gutter({ markers, domEventHandlers })`（官方 breakpoint 示例）
- 当前 Pier：`gutterLineClass` 只加 class，**不带事件**
- 浮层 / 插入：`showTooltip` / `Decoration.widget`
- 整文件 diff：`@codemirror/merge`（Pier **尚未**依赖；冲突 Compare 是另一路径）

---

## 4. 与现有 git gutter 设计的关系

[2026-07-17 设计](2026-07-17-files-editor-git-gutter-design.md) **已交付且仍成立**：

| 项 | v1（已交付） | 本文增量 |
|----|--------------|----------|
| 色条 / minimap | ✅ | 保持 |
| 基准：磁盘 vs HEAD | ✅ | peek 文案/内容必须同一语义 |
| 未保存缓冲 live | 非目标 | **仍非目标**（除非另开决策） |
| 点击 / hover 预览 | **非目标** | 本文建议升为后续目标（分阶段） |
| 完整 side-by-side | 归 Git review | **仍归 Git review**；peek 只链过去 |

已知取舍不变：dirty 时 gutter 行号可能相对缓冲错位；peek 若做，须标明「磁盘相对最后提交」，避免用户以为是未保存缓冲。

---

## 5. Pier 选型（已确认）

### 5.1 产品结论

- **应该支持**点击查看；删除行尤其刚需。
- **不**把完整 review 塞进编辑器默认态。
- **不**指望引入某个 CM 社区包一键解决。

### 5.2 选定路径（2026-08-08 修订）

**主路径改为：点击色条 → 打开/聚焦 Git Changes，并用 `pendingReveal` 滚到对应行**（无编辑器内 peek UI）。

原因：自建 peek 定位与交互成本高、体感偏慢；review 面板已有文件 diff + 行级 reveal（评论跳转同构）。

**不**默认路径 A peek / 路径 B unified merge。色条仍仅指示；详情一律进 Git review。

### 5.3 已交付

| 项 | 状态 |
|----|------|
| 行号右侧可点色条 + hover 加粗 | 已交付 |
| 点击 → `context.git.openUncommittedChanges` + `pendingReveal` | 已交付 |
| `allowGroupFallback`（gutter）vs 评论精确 group | 已交付 |
| 打开失败 toast | 已交付 |
| 切回 File 滚动恢复 | 已交付 |
| 编辑器内 peek UI | **取消** |

实现要点见 [phase1 计划（已改写为 navigate）](2026-08-08-files-editor-git-gutter-peek-phase1-plan.md)。

### 5.4 职责边界

```text
Files 编辑器 gutter
  → 指示 + 点击跳转 Changes（pendingReveal）

Git 插件 review
  → 多文件、stage/unstage、评论、完整 diff 阅读
```

### 5.5 明确不做（本选型周期）

- 默认整文件 `unifiedMergeView`
- 编辑器内 peek / 局部 Revert
- staged / unstaged 双色条
- 未保存缓冲 vs HEAD 的 live gutter

---

## 6. 风险

| 风险 | 缓解 |
|------|------|
| 跨插件 open panel 被拒绝 | 宿主 `openUncommittedChanges` facade |
| staged-only 文件误开 unstaged | `allowGroupFallback` + entry.renderSlots 序 |
| 评论 reveal 被 fallback 抢走 | 仅 gutter 传 `allowGroupFallback` |
| 切 tab 丢滚动 | scroll capture + hide-safe 快照 |

---

## 7. 一句话决策

> **点色条 = 宿主打开/聚焦 Git Changes 并 reveal 行；不在 CodeMirror 内做 diff peek。**
