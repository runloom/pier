# 目录树高亮多选金标准

日期：2026-09-10
状态：现行权威（选择模型）
范围：Files 侧栏与 git 审查侧栏共用的 `PierFileTree` 高亮多选（手势、键盘、激活 vs 选择、右键整集、刷新保选择），以及两棵树因此必须补齐的操作。
不包含：提交纳入勾选、Stage All 工具条、框选矩形、一次打开 N 个标签、任意两文件 Compare 新表面、外部拖入 Finder。

### 文档层级（冲突时）

| 文档 | 角色 | 与本文关系 |
|------|------|------------|
| **本文** | 两棵树 L-Select / 激活 / 多选操作终态唯一权威 | 权威 |
| `2026-07-25-git-review-tree-context-menu-endstate` | Inspect / Command、L vs B、菜单钉滚动 | 多选后 L 是集合，B 仍是单点；Command 结束必须恢复整集 |
| `2026-07-31-git-review-gold-standard-endstate-design` | 审查体感 | 单击不阻塞；⌘A 不得滚 CodeView |
| `2026-08-31-context-menu-order-gold-standard` | 组序 | 多选只改 title 计数与 `menuHidden`，不改组名 |
| `2026-08-27-file-tree-dnd-gold-standard-design` | 树内拖拽 | 多选走 `draggedPaths`；salvage 不得打成单选 |
| `2026-07-22-git-commit-mainline-design`（已取消） | Stage All 顶栏 | 禁止复活 |
| `2026-09-09-action-feedback-gold-standard` | 反馈 | 批量成功靠列表位移；失败一次 alert |
| `2026-09-09-user-copy-gold-standard` | 文案 | 说「N 项」，不说 selectedPaths |

**实现禁令：** 未对照本文时，禁止再合「只给审查树塞 `onSelectPaths`」或「只绑 Delete」充当终态。宣称完成须 G0–G5 全绿。

---

## 一句话终态

选择是集合，激活是单点。两棵树共用桌面高亮多选。只有激活才打开文件或滚动审查正文。右键点在集内对整集做事。审查没有全部暂存顶栏之后，不相邻子集必须靠这套选择来暂存、取消暂存、丢弃。

---

## 硬约束

| 编号 | 约束 |
|------|------|
| K1 | 只有高亮多选。禁止行旁 checkbox，禁止复活 Stage All 顶栏 |
| K2 | L-Select 是集合；激活（Files `onOpenPath` / 审查 B-Select）永远是单点 |
| K3 | 激活写入方：无修饰单击、⌘/Ctrl 单击落点、⇧ 单击落点、Enter、Inspect 右键。禁止：⇧↑↓、⌘A、⌘/Ctrl+Space、程序化 `selectOnlyPath`（reveal / 菜单恢复）。**目标已在 L-Select 时，active-file / explicit reveal 只聚焦，禁止 `selectOnlyPath` 把多选打成一行** |
| K4 | 右键：目标 ∈ L-Select → Command，保持整集；否则 Inspect，塌成该行（文件才激活） |
| K5 | Command 会话结束必须把 L-Select 恢复成 begin 快照；禁止只 `selectOnlyPath(目标)` |
| K6 | 审查操作路径 = 选中每一行 `getFileRefsUnderTreePath` 的并集去重。目录行继续表示子孙 |
| K7 | 暂存 / 未暂存分组里同一磁盘路径是两行，选择键是 `(group, repoPath)` |
| K8 | 批量成功 = 树与正文自己动，禁止再 toast.success；失败一次 alert，多路径一次报告 |
| K9 | 树快捷键必须打在树宿主（焦点在树且不是搜索框），禁止 `panel:pier.files.filePanel` / `panel:pier.git.changes` 全局抢走编辑器 Delete / ⌘C 或智能体 Esc |
| K10 | 行点击 salvage 与引擎 `computeFileTreeRowClickPlan` 同一套修饰键 |
| K11 | 文案进 locale。`Stage ({{count}})` 沿用；复制路径成功仍用「已复制路径」 |
| K12 | G0–G5 全绿前不得写 CHANGELOG「目录树多选金标准完成」 |

---

## 选择与激活

| 名 | 所有者 | 可多？ | 打开 / 滚正文？ |
|------|--------|--------|-----------------|
| L-Focus | pierre focused | 否 | 永不 |
| L-Select | pierre `selectedPaths` | 是 | 否 |
| 激活 | Files `onOpenPath`；审查 `selectedEntryKey` | 否 | 是，且只有激活才写 |

`PierFileTree` 的 `onSelectionChange` **不得**调用 `onOpenPath`。激活只来自行点击落点（含修饰键）、Enter、Inspect。搜索「打开当前匹配」必须显式 `onOpenPath`。

| 输入 | L-Select | 激活 |
|------|----------|------|
| 单击 | 只留该行 | 文件打开 / 滚到；目录展开或折叠 |
| ⌘/Ctrl 单击 | 开关该行 | 该行仍在集内且是文件 → 激活；去掉当前激活行 → 不打开已不在集内的行 |
| ⇧ 单击 | 锚点到该行的可见序范围 | 激活落点文件 |
| ⇧↑↓ | 扩展 / 收缩 | 不激活 |
| ⌘A | 当前可见行（含搜索过滤后；折叠目录算一行，不含隐藏子孙） | 不激活 |
| ⌘/Ctrl+Space | 开关焦点行 | 不激活 |
| Enter | 焦点不在集内则先单选 | 文件激活；目录展开/折叠 |
| Esc | 多选塌成焦点行 | 不激活、不关面板。搜索打开或焦点在输入框时不抢 |

---

## 明确不做

- 提交纳入勾选、Stage All / Unstage All 工具条、`ui.stageAll`
- 鼠标拖矩形
- Enter / 双击打开全部选中标签
- Compare Selected 新表面（多选只需让后续命令能读到恰好两文件）
- PR 式 Viewed 勾选
- 用智能体 Esc 清树选择
- 已提交 / 分支比较范围上的暂存、丢弃、Space

---

## Files 树

现网已把整集交给删除 / 剪切 / 复制，并多行复制路径；多选隐藏重命名与副本。删除菜单标题在 N>1 时为 `Delete ({{count}})`（与审查 `Stage ({{count}})` 同构）；剪切 / 复制 / 复制路径标题保持单数。补齐：

- 树聚焦 Delete / Backspace → 现有 `pier.files.delete`（含未保存保护）
- 树聚焦 ⌘X / ⌘C / ⌘V → 现有文件剪贴板，不得盖过编辑器
- 多选时隐藏「打开目录」
- 「在访达中显示」只揭示右键目标或焦点行
- salvage 带修饰键，不得把 ⌘ 点选打成单选

---

## 审查树

目录 / 分组根批量保留。缺口是不相邻子集。

- 侧栏接 `onSelectPaths`。点在集内则对每个选中树路径取 `getFileRefsUnderTreePath` 并集，写入已有 `stagePaths` / `unstagePaths` / `discard*` / `copyPaths`
- 允许跨「更改 / 已暂存」多选；菜单可同时出现暂存与取消暂存，各带自己的 N
- 冲突路径计入打开 / 复制，不计入暂存 / 丢弃；不得因集内有一个冲突就藏掉整项暂存
- 复制路径 / 相对路径：集内全部 repo 路径用换行拼接
- 打开文件、访达、打开目录仍是单目标；多选隐藏打开目录
- 未提交且树聚焦、搜索未打开：Space = 有未暂存则暂存，否则有已暂存则取消暂存；Delete / Backspace = 丢弃可丢弃路径（现有 `confirmGitDiscard`）
- 不要新注册 `stageSelected` 命令 id；Space 走 `pier.git.review.stageFile`
- index 刷新：按 `(group, repoPath)` 重绑文件行，目录按树路径；消失的丢掉。B-Select 还在则不 `scrollToItem`；暂存搬组则同 repoPath 新行可一次 scroll

已提交范围：手势可用；菜单只有复制路径等只读动作；Space / Delete 空操作。

---

## 右键 Inspect / Command

沿用 07-25，改两处：

1. Command = 右键目标已在 L-Select **或** `isActiveOpenPath`（正文已是该文件的安全网）。不得把正文正在看的文件自动并进 L-Select。
2. Command 开始时快照 `getSelectedPaths()`；结束时若快照长度 > 1，恢复整集。禁止只补目标一行。

---

## 验收门

| 门 | 必须 |
|----|------|
| G0 | 本文合入；治理测试锁 checkbox / Stage All / 激活不得挂在 `onSelectionChange` |
| G1 | Files：⌘ 点选两文件后删除确认含多项；salvage 后选择仍为 2 |
| G2 | Files：树聚焦 Delete / ⌘C 生效；编辑器聚焦不误伤 |
| G3 | 审查：不相邻两文件一次暂存；正文只跟最后激活的那一份 |
| G4 | 审查：⌘A 不跳 CodeView；暂存搬组后选择还在 |
| G5 | Space / Delete 仅未提交树聚焦；搜索框与已提交不误触发；右键组序仍以暂存为第一项 |

检查点：`tests/unit/ui/file-tree-multiselect-governance.test.ts`、`tests/component/files/ui-file-tree.test.tsx`、`tests/unit/renderer/git/review/tree/multiselect-menu.test.ts`、`tests/unit/renderer/git/review/tree/selection-rebind.test.ts`、`tests/unit/renderer/context-menu/order-sketches.test.ts`、`tests/unit/renderer/context-menu/order-sketches-multiselect.test.ts`。
