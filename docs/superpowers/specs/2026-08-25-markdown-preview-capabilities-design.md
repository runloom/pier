# Markdown 预览能力增强设计（统一）

日期：2026-08-25 · 状态：待用户终审 · 本文档为唯一设计来源

## 背景

files 插件 markdown 预览在富块渲染上存在一批缺口，本次一次性补齐八项能力。核心痛点：

1. 大表格不友好——不支持自定义列宽；单元格内容会把列撑宽，导致整表超出屏幕。
2. 阅读体验缺业界标配的视图偏好类能力（换行、脚注浮层、位置记忆等）。

现状代码事实：

- 解析层 remark/mdast（remark-gfm / math / directive），表格 IR 只有 `align` 字段（`ir.ts`）；`footnoteReference` / `footnoteDefinition` 已入 IR（`parser.ts:168,358`）。
- 表格渲染存在双层横向滚动容器嵌套：`.md-table-wrap { overflow-x: auto }`（`prose.css:225`）套 `@pier/ui/table.tsx` 内置 `div.relative.w-full.overflow-x-auto[data-scrollbar="overlay"]`（`packages/ui/src/table.tsx:10`），违反单一滚动所有者。
- 任务列表 checkbox 已渲染为 `disabled` 的 `Checkbox`（`ir-renderer.tsx:243`，aria-label 已备）。
- source 编辑器已有全局换行配置 `pier.files.editor.wordWrap` + CodeMirror compartment 联动（`settings.ts` / `prefs.ts` / `language-tools.ts`）。
- 图片预览基建 zoom/pan 已存在于 `@pier/ui/image-preview`（use-zoom-pan-viewport.ts / world-canvas.tsx）。

## 业界调研结论

| 事实 | 出处 |
| --- | --- |
| GFM 管道表格仅有对齐语义，无宽度字段 | <https://github.github.com/gfm/> |
| pandoc 以定界行破折号比例表达相对列宽，仅用于确定性出版输出，Web 渲染器均忽略 | <https://pandoc.org/MANUAL.html> |
| GitHub 渲染模式：表格自身成为滚动容器（`display:block; width:max-content; max-width:100%; overflow:auto`）+ 斑马纹 | <https://github.com/sindresorhus/github-markdown-css> |
| VS Code 预览对 table 零处理，宽表撑破整个 webview（反面教材） | `microsoft/vscode` markdown-language-features/media/markdown.css |
| 产品级自定义列宽一律存视图偏好不进源文件（Typora 拖拽列边界；Notion 存块数据） | <https://support.typora.io/Table-Editing/> 、<https://www.notion.com/help/tables> |
| Org-mode `<6>` / AsciiDoc `[cols="30,70"]` 证明语法级列宽存在于出版型轻量标记；Markdown 主线有意不走此路 | <https://orgmode.org/manual/Column-width-and-alignment.html> 、<https://docs.asciidoctor.org/asciidoc/latest/tables/> |

结论：采用业界收敛的分层模型——**源码存结构，渲染器负责自适应与溢出治理，用户级自定义作为视图偏好持久化**；唯一的内容编辑例外是任务列表回写（走既有编辑管线）。

## 范围决议总览

| # | 能力 | 决议 | 性质 |
| --- | --- | --- | --- |
| 1 | 单元格内容自适应换行 | ✅ 定稿：仅换行策略，表格整体溢出零处理 | 视图层 |
| 2 | 表格列宽拖拽 | ✅ 定稿 | 视图偏好 |
| 3 | 代码块自动换行开关 | ✅ 定稿：全局统一，复用 `pier.files.editor.wordWrap` | 视图偏好 |
| 4 | 标题 hover 锚点复制 | ✅ 定稿 | 视图层 |
| 5 | 脚注 hover 浮层 | ✅ 定稿：解析层已就绪，纯视图层 | 视图层 |
| 6 | 图片全屏缩放/平移/复制 | ✅ 定稿：基建已有，补缺口动作 | 视图层 |
| 7 | 阅读位置记忆 | ✅ 定稿 | 视图偏好 |
| 9 | 任务列表 checkbox 回写源文件 | ✅ 定稿（预览唯一内容编辑例外） | 内容编辑 |

明确不做：表格所见即所得编辑、Markdown 方言扩展（宽度/颜色进语法）、sticky 首列、表格整体溢出处理（滚动容器结构、渐隐暗示、斑马纹等一律不动）、任务列表以外的任何预览内容编辑。

---

## 1. 单元格内容自适应换行

- **决议边界**：表格整体的横向溢出**零处理**（维持现状）；本项只管单元格内容的换行行为。
- **默认策略**：`.md-table-wrap th, td { overflow-wrap: anywhere }`；单元格内 inline code 同样允许换行（非 `pre` 语境）。CJK 不受影响；含空格文本优先在空格处断行，`anywhere` 仅在无法容纳时强制断。
- **技术要点**：必须用 `anywhere` 而非 `break-word`——`break-word` 不参与 min-content 计算，列仍会被长 URL / 长 code span 撑宽（GitHub 以 `display: block` 表格布局绕开此问题，见 github-markdown-css 根级 `word-wrap: break-word`；两者语义差异见 MDN overflow-wrap）。Pier 保持常规表格布局，必须在单元格上直接声明 `anywhere`。
- 业界对照：GitHub 根级 `word-wrap: break-word`；VS Code 预览零处理；数据网格产品（AntD Table 等）用截断+tooltip——属交互型表格约定，会隐藏信息，不适合阅读型文档，不采用。

## 2. 表格列宽拖拽（阅读偏好）

- **交互**：hover 列边界出现拖拽把手（约 8px 命中区、全表头高、`col-resize` 光标），无常驻编辑铬；pointer capture 拖拽（期间 `user-select: none`）；**双击把手恢复该表自适应**。
- **布局切换**：该表存在任一自定义宽度时切 `table-layout: fixed` 并生成 `<colgroup>` 应用宽度（px），未自定义列均分剩余空间；全部恢复后回 `auto` 自适应。
- **钳制**：单列最小 48px；无最大值（超出容器即本表横向滚动，属预期）。
- **持久化**：进 markdown 预览偏好既有存储机制（`useMarkdownPreviewPrefsStore` 同层，localStorage 持久化的 zustand store），键 `文件路径 :: 块 contentHash`，值 `{ [columnIndex]: widthPx }`；块哈希复用 `target.ts` 的 `contentHashForBlock`——表格内容变更即哈希失配，旧宽度自动失效回落自适应。
- **可访问性**：把手 `role="separator"` + `aria-orientation="vertical"` + `aria-valuenow/min/max` + i18n aria-label；方向键 ±16px 微调，Escape 取消拖拽。把手 `tabIndex={0}` 在焦点白名单治理测试中登记理由（表格列宽滑杆，对齐图片 diff 滑杆先例）。
- **文案**：tooltip / aria-label 走 files 插件 locale key，措辞直接说破"调整此列显示宽度"，避免被误解为内容编辑。

## 3. 代码块自动换行开关

- **单一偏好**：直接消费既有全局配置 `pier.files.editor.wordWrap`（`FILES_EDITOR_WORD_WRAP_SETTING_KEY`），经插件 `context.configuration` 读取并订阅变更——与 source 编辑器 compartment 联动同源，一个开关管全部代码表面。
- 预览侧：代码块头部动作区与 Copy 同排放切换按钮（切换即写回同一配置键）；开启时 `pre-wrap` 断行，关闭时维持横向滚动+渐隐现状。
- 不新增偏好存储；i18n 复用现有 `filePanel.editor.action.wordWrap.*` 文案。

## 4. 标题 hover 锚点复制

- heading hover 浮现链接图标（GitHub 同型），点击复制 `文件路径#标题锚` 文本。
- 锚解析复用 cross-mode-anchor 既有 slug 逻辑，粘贴回 Pier 可定位跳转。
- 复制成功走弱反馈 toast（操作反馈规范：剪贴板写入属无 UI 反馈动作）。

## 5. 脚注 hover 浮层

- 解析层已就绪（remark-gfm；IR 两类节点齐备），当前渲染为 sup 跳转链接（`ir-inlines.tsx:153`）——本项纯视图层。
- 脚注标记 hover 显示浮层渲染定义内容（走既有 inline/block 渲染管线）；点击跳转行为保留。
- 浮层定位遵循工作台物料同款纪律：containment 内浮层走 portal。

## 6. 图片全屏能力补缺

- 已核实 `@pier/ui/image-preview` 自带 zoom/pan 基建；markdown 图片全屏走宿主 contentPreview 表面，缩放平移预计已覆盖。
- 实现期先冒烟核对缺口，预期仅补「复制图片 / 在目录树中显示」类动作；入口沿用 MediaFullscreenButton，不新增交互壳。

## 7. 阅读位置记忆

- per-file scroll restore 进预览偏好 store；滚动防抖写入，键含文件路径 + 内容哈希，失配丢弃（与列宽同一失效语义）。
- 仅恢复纵向位置；搜索/锚点跳转发生时让位于目标定位（跳转优先于恢复）。

## 9. 任务列表回写源文件

- 点击预览中 task list checkbox → 启用交互（移除 disabled）→ 经共享文档模型派发最小文本替换事务：IR 的 list item range 定位源行，仅替换该行 `[ ]` ⇄ `[x]` 字节 → `document/store.ts` / `saver.ts` 既有保存状态机落盘。
- **禁止旁路直写 `writeDocument`**——必须走文档模型事务，脏态、live-sync、磁盘重载冲突、撤销栈全部继承。
- 外部已修改文件时按 saver 现行冲突策略处理；不整段重排文档。
- 这是预览模式唯一的内容编辑通道，交互上不加额外确认（与在 source 模式手动改等价，同一撤销栈）；checkbox 点击有强自然 UI 反馈，不加 toast。
- 渲染侧注意：勾选后 IR 重解析期间保持乐观 UI（立即翻转勾选态），避免闪烁。

---

## 治理与测试

- **governance 扩展**：tabIndex 白名单登记（列宽把手）；i18n key 存在性。
- **单元测试**：列宽偏好 store 往返读写、哈希失配回落、双击/键盘重置；滚动位置记忆防抖与失配丢弃；换行配置订阅联动。
- **组件测试**：长 URL / 长 code span 单元格自动换行且列不被撑宽；模拟拖拽写入宽度并切 fixed；双击复位回 auto；task checkbox 点击派发文档事务且字节级最小替换。
- **回归**：`tests/unit/plugins/markdown-preview-layout-governance.test.ts` 保持绿（大纲细轨几何不变）。

## 实施顺序

单个实施计划内部按依赖排序：**1 → 2 → 5 → 4 → 7 → 6 → 9 → 3**；每项落地后立即跑对应验证再进入下一项。

## 验证

- `pnpm dev` 打开含长 URL / 长 code span 宽表的 md：单元格内容自动换行、列不被撑宽；拖拽重启后保留；修改表格内容后旧宽度失效。
- 分页视图（`pagination-view.tsx`）/ article 布局下同样验证换行与拖拽表现。
- 任务列表：点击 → 文件落盘字节正确 → source 模式可见同一改动与撤销栈 → 外部改文件后点击触发 saver 冲突策略。

## 风险

- localStorage 与 userData 分层规范的关系：与现有 markdown 预览偏好保持同一层级（一致性优先），未来宿主统一迁移时随迁。
- 任务列表回写的并发窗口（预览 IR range vs 用户同时在 source 编辑）：以文档模型事务为唯一写入口，冲突语义继承 saver，不自行加锁。
