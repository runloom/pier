# Markdown 预览表格列宽金标准

日期：2026-08-31  
状态：现行权威（files Markdown 预览表格阅读偏好）  
范围：GFM 表格在预览中的静止宽度语言、列宽拖拽物理、结构键失效、提交语义。  
不包含：把列宽写回 markdown 源文件；百分比响应式缩放；相邻列零和；版心磁吸。

## 一句话终态

未自定义时表格贴内容、封顶版心（GitHub 阅读态）；一旦拖列，全列冻结为绝对 px，表宽 = Σ，拖哪列只动哪列；偏好按「文件路径 + 结构键」存，正文编辑存活，列结构变化失效。

## 静止宽度语言

| 状态 | 表宽 |
|---|---|
| auto（无自定义） | `width: max-content; max-width: 100%`（小表贴内容，大表封顶版心） |
| 部分覆盖（旧数据） | `table-layout: fixed; width: 100%; max-width: none` |
| 全列覆盖（冻结） | `table-layout: fixed; width: Σ; max-width: none` |

**禁止**把 `<table>` 设为 `display: block`（GitHub Primer 四件套的那一项会破坏 `colgroup` / `table-layout: fixed` 与表格语义）。横向滚动由 `.md-table-wrap` 单独承担；内层 shadcn `table-container` 必须 `overflow-x: visible`。

## 交互物理

- **加法模型**：拖边界只改左列宽度，右侧列刚体平移，表宽 = Σ。
- **冻结协议**：首次 dirty 移动必须 `setWidths(全列快照 ∪ {被拖列})`，禁止只写一列（否则 fixed 均分重排，tiptap#5435）。
- **指示线**：`x = 列左缘 + clamp 宽 − 1`，覆盖被拖列右缘边框像素。
- **双击把手**：整表回自适应（冻结模型下单列重置语义不成立）。
- **键盘**：方向键 ±16px，同构冻结后立即提交。

## 失效契约（结构键）

键 = `hash(列数 + NUL + 表头单元格文本.join(NUL))`；文本经评论指纹同款
normalize（折叠空白 + FNV-1a），表头 inline 经 `markdownInlinesToText`
扁平化（图片取 alt，无 alt 得空串）。

| 变化 | 键 | 列宽 |
|---|---|---|
| 正文单元格编辑 | 不变 | **存活** |
| 加 / 删列 | 变 | 失效回自适应 |
| 列重排（表头顺序） | 变 | 失效 |
| 表头改名 | 变 | 失效 |
| undo 回到原结构 | 还原 | 宽度复活 |
| 无表头行 / 无表头单元格 | `null` | 不可拖 |

**同头共享是设计预期**：同文件内同列数同表头的多张表共享宽度——拖 A 表松手后，
同头 B 表经同窗变更事件同步为相同列宽（markdown 无稳定表 ID，键掺序号/offset
会破坏「正文编辑存活」或在表格增删时串错，权衡后选共享）。已知退化：表头为
无 alt 图片时文本为空串，同列数的纯图头表更易撞键。旧全内容哈希条目不迁移。

运行时：`(sourcePath, widthsKey)` 变化必须重读存储并**中止**进行中拖拽（不把旧快照写入新键）。

## 提交语义

- 拖拽中只更新本地 state，**禁止**逐帧写 localStorage。
- `|Δ宽| ≥ 1px` 才 dirty；纯点击与零位移 move 不冻结。
- **单会话单指针**：已有拖拽会话时忽略并发 pointerdown（防 window 级
  Escape 监听泄漏）；move / lostcapture / cancel 必须匹配会话 `pointerId`。
- **拖拽中键盘路径静默**：指针拖拽进行中方向键不落盘（否则 Escape 只回滚
  内存，键盘那笔成为无法纠正的脏写）。
- ARIA：`clampColumnWidth` 硬顶与 `aria-valuemax` 同源（4096）；auto 态
  `aria-valuetext` 标注「自动宽度」。
- 松手 / 卸载：dirty 且身份未变则一次 `persistAll`。
- Escape / `pointercancel`：回滚到按下前快照，不落盘。
- 拖拽期间忽略 `TABLE_WIDTHS_CHANGED_EVENT` 与 `storage` 同步。
- 同窗靠 CustomEvent；跨窗靠 `storage`（键前缀 `pier.files.markdown.tableWidths:`）。

## 文档宽度变化

- auto：CSS 响应式，随版心重排。
- 冻结：绝对 px，刻意解耦。面板窄于 Σ → wrap 内横向滚动；宽于 Σ → 左对齐留白。
- **禁止**百分比随面板缩放（Confluence 列宽被动变化的反面教材）。

## 磁吸否决记录

曾考虑松手时 `|Σ − wrap.clientWidth| ≤ 16px` 把差值并入被拖列。否决：对「冻结时 Σ 已等于版心」的常见大表，任何 ≤16px 微调都会被精确抵消回弹；阈值与键盘步长撞车；吸出的死 px 在面板 resize 后失效。幻影横向滚动改由滚动主收敛消除。**禁止复活此磁吸。**

## 禁止

1. `display: block` 在 markdown 预览 `<table>` 上。
2. 只给被拖列写 `<col>`、其余列在 fixed 布局里裸奔。
3. 拖拽中逐帧持久化。
4. 用全表正文哈希当列宽键（agent 改一个错别字就丢偏好）。
5. 版心磁吸 / 拖拽阻力区 / 默认零和 / 响应式百分比列宽。

## 检查点

- `tests/unit/plugins/markdown/markdown-table-column-width-governance.test.ts`
- `tests/unit/plugins/markdown/markdown-table-resize.test.tsx`
- `tests/unit/plugins/markdown/markdown-table-structure-key.test.ts`
- `tests/unit/plugins/markdown/markdown-table-width-preferences.test.ts`
- `tests/unit/plugins/markdown/markdown-prose-css.test.ts`
