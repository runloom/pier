# Files 文档预览（PDF / DOCX / XLSX）金标准

Status: active  
Scope: Files 面板只读文档预览（P0 纯前端）  
Implementation plan: 由 `docs/superpowers/plans/` 下的同名实施计划承载（如已归档见 git 历史）

## 1. 范围与非目标

### 1.1 目标

Files 面板原生、只读地预览三类文档：

| 格式 | 预览 | 说明 |
| --- | --- | --- |
| `.pdf` | PDF.js 页面渲染 + 文本层 | 支持翻页、缩放、适合宽度、页内链接 |
| `.docx` | docx-preview + Shadow DOM | 近似版式；图片走 `data:`；不执行脚本 |
| `.xlsx` | SheetJS Worker + 只读网格 | 多 sheet、列宽（可拖拽、按文档 + sheet 记忆）、数字格式、TSV 复制 |

### 1.2 非目标

- 不编辑、不保存、不生成草稿、不参与保存冲突、不写盘。
- 不做 Office 批注、修订留痕、评论、LSP、diff、源码模式、查找替换。
- 不预览 `.pptx`、`.doc`、`.xls`、`.ppt`、加密 OOXML；明确状态 + 在默认应用中打开。
- 不引入 LibreOffice、不做本地转换服务、不做 dev server / 内嵌浏览器面板。
- 不做 agent 产物侧栏、任务台账、artifact 注册表；agent 生成物继续走文件链接 / `pier://file` / `files.openPath`。
- 不新增宿主 API、IPC、PierCommand 或 capability。

## 2. 只读语义

- `FilesDocument.preview` 增加 `document` / `document-unsupported` 两种状态，与 `image` 并列。
- 文档预览映射后：`capabilities: []`、`currentContents: ""`、`format/eol: null`、`readOnly: true`、`dirty: false`、`preview` 非空。
- `document.preview` 分支先于磁盘冲突、UnsupportedFilePanel、编辑器分支；预览状态自己负责加载/错误/回退。
- 预览期间不出现 source / diff / save / comment / LSP 入口。
- 文档文件不进入保存、草稿、autosave、durability 路径。

## 3. 支持矩阵与分类

分类输入：root-relative 路径扩展名（小写）+ 文件头 1024 字节。PDF 允许前导垃圾，在头 1024 字节内查找 `%PDF-`。

| 扩展名 | magic | 结果 |
| --- | --- | --- |
| `.pdf` | `%PDF-`（头 1024 内） | `document` / `pdf` |
| `.docx` | ZIP `PK\x03\x04` | `document` / `docx` |
| `.xlsx` | ZIP `PK\x03\x04` | `document` / `xlsx` |
| `.pptx` | ZIP | `document-unsupported` / `not-supported` |
| `.docx` / `.xlsx` / `.pptx` | CFB `D0 CF 11 E0 A1 B1 1A E1` | `document-unsupported` / `encrypted` |
| `.doc` / `.xls` / `.ppt` | CFB | `document-unsupported` / `legacy` |
| 任一受支持文档 | — | 超过 64 MiB → `document-unsupported` / `too-large` |
| 其它组合（含扩展名与 magic 不符） | — | 走原有 text / binary 路径 |

- 分类先于 10 MiB 可编辑文本上限；文档上限 64 MiB。
- 超过 64 MiB 的文档返回 `document-unsupported` + `reason: "too-large"`，不读全文、不 hash。
- 加密 OOXML 以 CFB 容器识别；不得误报为损坏或旧格式。
- MIME 只来自共享常量，renderer / main / 协议不得各写一份。

## 4. 字节投递架构

- 字节只走现有 `pier-file-preview://file/<ticket>` ticket 协议；禁止新增任意路径读取 IPC。
- 每份文档只 `issue` + `fetch` 一次完整字节，不依赖 HTTP Range。
- ticket TTL 10 分钟且不滑动；PDF.js / SheetJS 从内存解析。
- fetch 前校验：`issued: true`、`content-type === mime`、`byteLength <= 64 MiB`。
- HTTP 409 → `stale`；413 → `too-large`；其它失败 → `fetch-failed`。
- 409 覆盖两类「内容已不是 ticket 对应版本」：revision 校验失败，以及有界读取时文件在 stat 之后增长到预期大小之外。文件在读取过程中变大不是 413：`readFileWithinPreviewLimit` 返回 `{ kind: "changed" }`，协议映射 409；只有 stat 时已超过 64 MiB 才是 413。ticket 签发阶段的 `changed` 在 host media preview 归一为 not-found。
- 分类/读取竞态（读头后文件被替换）在 main 抛 `file_conflict` 错误码；`file.readDocument` 返回 `file_conflict`，renderer loader 映射为本地化「文件在读取时发生变化，重新加载以查看当前版本」，禁止把内部英文错误消息透给用户。
- 读取结束/中止/卸载/代次不符时释放 ticket。
- 协议拒绝 absolute / git-blob 文档 locator；P0 只从 Files rooted locator 进入。
- 协议响应保留 `access-control-allow-origin: *`、`cache-control: private, immutable`、`content-length`、`etag`、`x-content-type-options: nosniff`。

## 5. 统一预览壳与状态

- `FilePanelPreviewBranch` 承接 `body.tsx` 的 `document.preview` 分支：继续包 `FileDeletedOnDiskChrome` 与 `FilesFindUnavailableNotice`，按 `image` / `document` 分发。
- `FileDocumentPreview` 负责 `document-unsupported` 与 `document` 的 source 三态（loading / error / ready）。
- `DocumentPreviewFrame` 提供 sticky 工具栏槽、可选保真提示、`min-h-0 flex-1` 滚动正文。ready 态统一由 frame 在工具栏右侧渲染「在默认应用中打开」：PDF 工具栏只放翻页 / 缩放，DOCX / XLSX 不再各自手绘入口；全格式唯一入口在 frame。
- 错误状态必须给下一步：重试、在默认应用中打开。
- 读盘失败优先于预览：`withDocumentError` 会保留 `preview`，但 `loadState === "error"` 时必须由读错误状态接管并显示重试，不得继续渲染旧预览；reload rejection 不得在面板层静默吞掉。删除态（`deletedOnDisk`）仍是 `loadState: "loaded"`，继续显示最后预览。
- 保真提示：
  - DOCX：只读预览，复杂版式可能与原文件不同。
  - XLSX：只读预览，公式显示为值，格式可能与原文件不同。
  - PDF：高保真，不显示保真提示。
- `stale` 的重试走 `controller.reloadDocumentFromDisk`，用新 revision 重新取字节；不得用旧 revision 二次 fetch。
- 已删除文件：标签保留，继续显示最后预览 + deleted chrome；不调用 `closeInstance`。
- 已删除文件最后预览的字节在 renderer 会话内保留：按 `(root, path, revision)` 的小型 LRU（最多 8 份、总字节 ≤ 64 MiB）。重新挂载同一删除文档时直接复用保留字节，不再为已不存在的路径签发 ticket；没有保留字节时进入专门的 `deleted` 错误态（不签发 ticket），而不是误导性的 fetch 失败。保留只存在于当前 renderer 会话，不写 userData；窗口重载后删除文档回到 `deleted` 状态。
- 删除态文案必须与渲染出的动作一致：`DocumentUnsupportedState` 有「在默认应用中打开」时提示打开；删除且该按钮被抑制时提示恢复文件。禁止承诺未渲染的按钮。
- reload 失败必须可见：`FilePanelPreviewBranch` 的 reload rejection 在加载错误态之外显示本地化失败提示；加载错误态自身已接管时（`loadState === "error"`）不重复提示。文档预览的查找不可用提示使用文档专用文案，不得提示切换到编辑器。
- 外部链接打开失败使用本地化「带下一步」文案，禁止透出 raw `error.message`。

## 6. PDF

- `pdfjs-dist` 精确版本（实现锁定 6.5.438），提供 `TextLayer` 与 `wasm/` 资产。
- 每个文档独立 `PDFWorker`，worker 用 `pdf.worker.min.mjs?worker&inline`（Vite blob worker），避免打包态 `file://` module worker 失败；v6 以 `PDFWorker.create({ port })` 绑定实例。
- `getDocument` 参数：`cMapUrl = "pier-asset://pdfjs/cmaps/"`、`standardFontDataUrl = "pier-asset://pdfjs/standard_fonts/"`、`wasmUrl = "pier-asset://pdfjs/wasm/"`、`disableAutoFetch/disableStream = true`、`useSystemFonts = false`。
  - 偏差记录：pdfjs-dist 6 已移除 `isEvalSupported` 选项，实现不再传该参数；CSP 仍不含 `unsafe-eval`，PDF.js 走打包 worker 的正常解析路径。
- `PasswordException` → `encrypted`；其它解析失败 → `parse-failed`。
- 翻页、缩放（0.5–3）、适合宽度；canvas 任一边像素 clamp 16,384；devicePixelRatio clamp 2。
- **适合宽度是几何关系，不是缩放档位**：`fitScale = containerWidth / pageWidth` 不得被 0.5–3 钳制；仅用户缩放倍率走 `clampPdfZoom`，最终 `scale = fitScale * clampPdfZoom(zoom)`。钳制 fitScale 会让宽页面永远宽于视口、小页面永远填不满。
- 文本层：每页必须先 `await page.getTextContent()` 再触碰共享文本容器，并在每个 await（文本内容、TextLayer 渲染、annotations）之后检查 cancelled；取消后不得创建/渲染 TextLayer 或绑定链接，避免上一页晚到的文本层覆盖当前页。
- 视口宽度从滚动正文测量：PdfPage 根节点占满视口，ResizeObserver 不得观察随 canvas 收缩的包装盒。否则渲染宽度会回灌 `fitScale`，每次缩放乘法叠加（点一次放大直接冲到 3× 上限，适合宽度失效）。
- 每个文档独立 worker 以注入 `port` 创建；销毁顺序固定 `await loadingTask.destroy()` → `PDFWorker.destroy()` → `port.terminate()`，任一步抛错/拒绝都要继续后续销毁 —— `PDFWorker.destroy()` 不会 `terminate()` 注入的 port，worker 端 `Terminate` 也不关闭线程；cleanup 对 `destroyPdfResources` 的 rejection 兜底。
- 文本层可选，样式只来自 `pdf-text-layer.css`，作用域 `[data-slot="document-preview-pdf"]`；选区底色复用宿主 `--editor-selection-bg`，不新增 `color-mix`。
- 纸面由 PDF.js canvas 自身以白色绘制（`background` 缺省即白），CSS 不写固定 `bg-white` / 十六进制纸面色。
- 链接：只处理 `subtype === "Link"`；外链只允许 `https:` / `mailto:`；内部 dest 由 `getPageIndex` 解析；禁止导航宿主。
- 中文 PDF 必须能从 `pier-asset://pdfjs/cmaps` 读取 CMap，否则出现豆腐块。

## 7. DOCX

- `docx-preview` + `JSZip`。
- 渲染进 Shadow DOM；`renderAsync(bytes, content, styleContainer, { breakPages, inWrapper, ignoreHeight, renderHeaders, renderFooters, useBase64URL })`。
- `useBase64URL: true`：图片走 `data:`；生产 CSP 已允许 `img-src data:`。
- 解压上限（central directory，先检查再解压）：
  - entries ≤ 10,000
  - 单 entry uncompressed ≤ 128 MiB
  - 总 uncompressed ≤ 256 MiB
  - 支持 ZIP64；越界/签名不符 → `truncated`
- 包检查：必须包含 `[Content_Types].xml` 与 `word/document.xml`；否则 `parse-failed`。
- central directory 的 `truncated` 表示包本身损坏/不完整，映射 `not-docx`（parse-failed 文案）；只有 entries / 单条 / 总量超限才映射 `zip-limit`。不得把截断归档谎报为解压上限。
- 残余风险（2026-11-12）：central directory 声明的解压大小可被伪造，JSZip 在解压结束后才校验 `DataLength`；因此恶意 DOCX 仍可能在 renderer 主线程耗尽内存。P0 依赖 64 MiB 文件上限与 central-directory 预检，未做解压输出硬截断；DOCX 解析放入 Worker 并加输出上限留作后续加固。
- 清洗（渲染后）：
  - 删除 `script` / `iframe` / `object` / `embed` / `link` / `meta` / `form` / `input` / `button`。
  - 删除所有 `on*`、`srcdoc`、`xlink:href`。
  - `img[src]` 只允许 `data:image/`；其它移除 `src` 并标记 `data-pier-blocked-image="true"`。
  - `<style>` 去 `@import`；非 `data:` 的 `url(...)` 替换为 `none`。
  - 内联 style 含 `url(` / `expression(` 时整段移除。
- 链接：`https:` / `mailto:` → 宿主外部浏览器；`#id` → 文档内滚动；`javascript:` / `file:` / 相对路径 → 忽略；全部 `preventDefault`。
- 第一道网络防线是 CSP：`img-src` / `font-src` / `style-src` 都不含 `https:`。

## 8. XLSX

- SheetJS 官方发布包（`https://cdn.sheetjs.com/...`，≥ 0.20.2），禁止 npm `xlsx@0.18.5`。
- 解析在 Worker 中完成；主线程只 `import type`，SheetJS 运行时不进主线程 chunk。
- `XLSX.read` 首遍：`bookVBA: false`、`cellFormula: false`、`cellHTML: false`、`cellStyles: false`、`sheetRows = maxRows + 1`、`WTF: false`。
- **偏移工作表修复**：SheetJS 的 `sheetRows` 从第 0 行起算，用于起点很靠后的 used range（例如从第 60,000 行开始）会把可见数据整段截掉，同时仍用 `!fullref` 指向完整范围。解析必须比对 `!fullref` 与 `!ref`：当 `fullref.s.r + maxRows - 1 > ref.e.r` 时，只对该 sheet 以 `sheetRows = fullref.s.r + maxRows + 1` 重读；若起点超过 `maxParseStartRow = 100,000`，不再重读，输出 `rowCount: 0`、`truncated: true`、`truncatedReason: "offset"` 的空壳，UI 使用专用 offset 文案。禁止静默显示不完整数据。
- **工作簿级预算**：跨 sheet 的序列化单元格总数上限 1,000,000。每个 sheet 从剩余预算调用 `clipXlsxRange(..., availableCells)`；预算耗尽的 sheet 输出空壳（`truncatedReason: "cells"`），offset 空壳不消耗预算。只有 per-sheet 上限会让多 sheet 工作簿把内存乘上 sheet 数。
- 上限：50,000 行 / 256 列 / 500,000 单元格（受工作簿剩余预算约束）。先取 `min(full, 上限)`；若 `rows * columns` 超过预算，保留列并把行减到 `floor(budget / columns)`（可为 0）。裁剪原因优先级：列裁剪 → `columns`；否则单元格预算压行 → `cells`；否则行裁剪 → `rows`。
- 截断必须可见：顶部 infobar 显示行/列/单元格数字，并提示在默认应用中打开完整文件；`truncatedReason: "offset"` 使用独立文案。禁止静默截断。
- **合并单元格（2026-11-14 修正）**：横向合并按真实表格渲染。`!merges` 只与已渲染范围求交；只输出锚点在渲染范围内的水平跨度 `{ row, column, columnSpan }`（sheet 相对坐标，`columnSpan >= 2`），网格用 react-data-grid `colSpan` 让锚点格横跨、被覆盖格为空；格子 key 用 `row * 16384 + column` 数值；禁止按 sheet 全范围枚举（16k × 1M 会瞬间打爆内存）。纵向合并（跨行）仍只显示左上值、其余格为空：react-data-grid 不支持 `rowSpan`，本期不另造第二套网格——这是能力边界，不是「网格不合并」策略。
- **列宽（2026-11-14 修正，取代不读取 `!cols`）**：优先级 = 用户持久化宽度 > 文档 `!cols` > 内容估算。`!cols` 必须用 `XLSX.read({ cellStyles: true })` 解析（`cellStyles: false` 时 SheetJS 直接丢弃列宽）；当 `!cols` 至少一列带显式 `customwidth`，或渲染列宽度不均一时视为文档意图，按 `wpx`（缺失时用 `wch` / `width` 换算）渲染并 clamp 到 48–1200px；整表同一默认宽度视为无意义并回退内容估算。有文档宽度或持久化宽度时禁止按容器等比放大——真实表格软件不会为填满窗口拉伸列。两者都没有时按列内容采样估算基础宽度，再按容器可用宽度等比放大（单列上限 320px），窄面板保留横向滚动；无文档行高且无内嵌换行时行高 28px。导出型工作簿常缺 `!cols` 或全是默认宽度，不能把默认宽度当文档意图（保留 2026-11-13 修正的意图）。
- **列宽可拖拽（2026-11-14）**：数据列 `resizable: true`，行号列固定且不参与拖拽。拖拽是阅读姿态，不是编辑：不写文件、不改数据、不产生 dirty。react-data-grid 的列宽是加法物理，只改被拖列，表宽 = Σ；上下限 48–1200px——必须容纳文档自带宽度（例如 660px 的说明列），72–480px 会把真实列宽压窄。
- **行高与换行（2026-11-14）**：`cellStyles: true` 同时解析 `!rows` 的 `hpt`。Excel 的 `ht` 单位是点，必须换算为 CSS px：`ceil(hpt × 4/3)`（SheetJS 的 `hpx` 因固定 `PPI = 96` 实际等于点值，直接当像素会把行高缩小 25%，长单元格底部被裁）。换算后大于 28px 的行加 1px 边框余量并 clamp 到 545px；无文档行高且无内嵌换行用 28px。文档行高大于 28px 的行按多行内容处理：单元格保留 `\n` 并按列宽折行；无文档行高但单元格含 `\n` 的行按列宽估算行高（行数 × 20px + 8px，clamp 28–545px，优先文档高度；估算使用文档 `!cols` 或默认 96px，不随列宽拖拽重算，与 Excel 固定行高一致）并折行——程序生成的工作簿常只写换行不写 `!rows`，禁止在 28px 行里把多行文本裁成单行省略号。只有单行内容才用省略号。
- **数据下方与右侧不得露白（2026-11-14）**：网格必须像 Excel 一样铺满可视区。真实数据之后追加空白行（行号继续，沿用 CSV 预览的 200 行尾部行），真实列之后追加空白列（列号继续 D/E/F…，按剩余宽度均分、单列约 64px 默认宽）；空白列不拉伸真实列宽、不可拖拽、不写列宽记忆。只有面板窄于表宽时才出现横向滚动，表宽小于面板时右侧由空白列补满。
- **列宽记忆**：键为 `(documentId, sheet 名, 列数)`，存 `localStorage` 族 `pier.files.xlsx.columnWidths.v1:`，不进 userData；sheet 名必须进键，禁止同文件不同 sheet 串宽度。键变化（切 sheet / 列数变化）必须重读并中止旧写入。
- 无持久化宽度且无文档 `!cols` 时走内容自动 fit；一旦该 sheet 有持久化宽度或文档宽度，其余列不再按容器等比放大（与 CSV 一致，避免拖过列后整表随窗口抖动）。松手才写盘（debounce），切 sheet / 卸载时 flush；拖拽中禁止逐帧写。
- 不新增专用重置 / 自适应按钮：双击列边界由 react-data-grid 自带 `max-content` 自适应并写入列宽记忆，与 CSV 预览同构；禁止为此另造一套 chrome。
- 行列坐标跟随 used range 起点：`SerializedXlsxSheet` 必须带 `startColumn` / `startRow`，列头与行号从 `!ref` / `!fullref` 的绝对坐标起算（例如范围从 C5 开始，首列标 C、首行标 5），禁止固定从 A/1 开始，否则复制/阅读到的位置与文件不一致（2026-11-13 修正）。
- 复制只作用于真实数据单元格（真实数据行 + 数据列）：react-data-grid 的列头活动位是 `rowIdx = -1`，补白行 / 补白列不是文档数据；这些位置、工作表切换后失效的活动位以及空文本必须直接放行原生复制，不得 `preventDefault` 并写入空串（会清空系统剪贴板）。
- 数字/日期右对齐，布尔居中，其它左对齐。
- 多 sheet 底部 tab（36px 外壳 + 28px 轨道，`aria-selected`）：使用 `@pier/ui/tabs` 的 line 变体，尺寸与内距跟审查 surface switcher 同源 —— 共享 28px 轨道、`text-xs`、line 轨道的 `px-2.5` / `gap-4`、非激活 `text-foreground/60`、激活 `text-foreground` + 2px `bg-foreground` 选中线；禁止用 `bg-muted` 胶囊表示激活。底栏外壳 36px（`h-9`，与终端 composer chrome 同档），28px 轨道在其中垂直居中，上下各 4px 呼吸位；比 `FilePanelHeader` 的 40px 少 4px，footer 只有 tabs，不抢 header 高度。sheet 条保留表面 chrome（全宽、横向滚动、外壳顶部分隔线），轨道纵向 padding 归零，使选中线贴住内容侧边缘。只读，不提供编辑/插入/删除。
- **选中线永远朝向内容侧**：上方 tab 条（设置页、审查 surface）用底边下划线；sheet 条停靠在预览底缘、网格在上方，所以激活下划线必须落在 **28px 条内顶边**（`aria-selected:after:top-0` + `bottom: auto`）。不得贴面板底缘（与内容断开、贴到下方无关 chrome），也不得沿用 line 变体默认的 `after:bottom-[-5px]`（会被底缘裁掉）。Excel / Google Sheets 的底边色条是工作表标签色装饰，其选中主信号是白底与表格连成一片，不能只照搬底边线（2026-11-13 修正）。
- TSV 复制：`Cmd/Ctrl+C` 把当前活动单元格以 TSV 写入剪贴板。偏差记录：P0 只复制活动单元格；区域复制留待后续，不在本期发明第二套选择模型。
- 解析超时 20s：terminate worker，显示 `parse-failed`。
- CFB 加密文件已在 main 分类为 `document-unsupported`，不会进入 worker；缺 `xl/workbook.xml` 一律 `parse-failed`。

## 9. 安全清单

- 不执行宏；不执行文档脚本；不加载外部图片/字体/样式。
- 危险 DOM 标签与属性必须清除。
- 文档超链接不得导航宿主或打开 `file:` / `javascript:`。
- ZIP bomb 上限在解压前检查。
- 文档字节只走 ticket 协议；不新增任意路径读取 IPC。
- “在默认应用中打开”只在显式用户动作下调用现有 `context.files.openPath`；路径必须由 `canonicalPath`（root-relative）或 `source.path` 经 `absoluteDiskSourcePath(root, path)` 拼成绝对路径。
- 失败必须可见：短失败 toast/alert，带技术详情用 alert；禁止 `catch` 只 `console.error`。

## 10. 生命周期与入口

- revision 变化：abort 旧请求、释放旧 ticket、重新 issue+fetch；不保留旧字节。保留字节按 `(root, path, revision)` 键控，新 revision 绝不复用旧 revision 的字节。
- 删除：保留最后预览 + banner；不关闭标签；打开默认应用按钮隐藏。
- 只读预览没有 Save：删除 banner 必须按 `fileDocumentCanRestoreBySave` 分文案。可保存文件才提示「保存以恢复」；只读预览改为说明当前显示的是最后版本的预览，并给出恢复文件后可再次打开的下一步，禁止提示一个不存在的保存动作（2026-11-13 修正）。
- 入口复用现有链路：终端文件链接 / `pier://file` / `context.files.openInEditor` → Files 面板 → `document.preview` 分支直接渲染；不新增 `preferPreview`。
- 不新增产物侧栏、任务台账、artifact 注册表。

## 11. 主题、焦点、密度与文案

- 不新增纸面作用域；DOCX 页面自身白底，PDF 用 `bg-muted/40`，XLSX 使用宿主语义令牌。
- 颜色只来自语义令牌；禁止新增十六进制 / `rgb()` / `hsl()` / `oklch()`。
- DocumentPreviewFrame 工具栏、PDF 控制、XLSX 网格行高统一 28px；XLSX sheet 底栏外壳 36px（`h-9`，28px 轨道居中）；不加 `h-8`。
- Files / 审查共用 `FilePanelLayout` 的树 ↔ 正文分隔条：4px 命中区用 `bg-sidebar` 填满、`border-r` 分隔线贴正文左缘；禁止 `border-l` + `bg-transparent` 在预览正文前留白缝（2026-11-13 修正）。
- PDF canvas `role="img"` + `aria-label`（文件名 + 页码）；工具栏与 sheet tabs 有 `aria-label`。
- 纯展示层不进 Tab 序；不新增 `tabIndex={0}`。
- 用户文案只进 locale（zh-CN / en / ja / ko）；错误与空态带下一步。

### 文件图标（2026-11-14）

- 文档类型必须有专用文件图标，不允许 PDF / Word / Slides 回落到默认文件图标。字形走既有 `packages/ui/src/file/icon-glyphs.ts` 自定义 overlay（16×16 `currentColor`，与内置图标同一套「page bg + fold + mark」两层结构），映射走 `PIER_FILE_TREE_ICONS.byFileExtension`；Files 树、tab、溢出菜单三处同构生效。
- 映射：`.pdf` → `pdf`；`.doc` / `.docx` → `word`；`.ppt` / `.pptx` → `slides`。`.xlsx` / `.xls` / `.csv` / `.tsv` / `.ods` 保持内置 `table` 字形——它已不是默认文件图标，且与 CSV 同族；禁止再给电子表格造第二个字形。
- 颜色只走现有文件图标色板：`pdf` → red、`word` → blue、`slides` → orange；不得在业务源码新增十六进制。
- 检查点：`tests/unit/renderer/files/icon.test.tsx`。

## 12. CSP、Worker 与打包

宿主 CSP dev / prod 必须包含：

- `connect-src`：`pier-file-preview:`、`pier-asset:`
- `worker-src`：`'self' blob:`
- `img-src` 保留 `pier-file-preview:`
- 不把 `pier-file-preview:` / `pier-asset:` 加进 `frame-src`

**偏差记录（2026-11-12）**：Electron 43 每次调用 `protocol.registerSchemesAsPrivileged` 会替换整批特权 scheme（实测多调用后只有最后一批有 `supportFetchAPI` / `stream`）。宿主原分 5 次注册，导致 `pier-file-preview:` / `pier-asset:` / `pier-plugin:` 的 fetch 全部不可用（`pier-live:` 独活）。已改为 `bootstrap-privileged-protocols.ts` 单次注册全部 scheme；`tests/unit/main/files/preview-startup-governance.test.ts` 锁定「单次调用 + 五个 descriptor」，禁止回退到逐 scheme 注册。E2E 已实测 PDF 字节 fetch 200 与 `pier-asset://pdfjs` 资产可达。

`pier-asset://pdfjs/{cmaps,standard_fonts,wasm}`：

- dev 从 `node_modules/pdfjs-dist` 读；prod 从 `process.resourcesPath/pdfjs` 读。
- 只接受 `cmaps/` / `standard_fonts/` / `wasm/` 下、无 `..` / `.` / 空段 / 反斜杠、扩展名在 `{.bcmap,.pfb,.ttf,.otf,.wasm}` 的相对路径。
- 响应带 `access-control-allow-origin: *`。
- `electron-builder.yml` 根 `extraResources` 复制三个目录。

## 13. 性能与资源

- 单文档上限 64 MiB；一次完整 fetch；不 Range、不流式。
- PDF 只渲染当前页；缩放时重渲染当前页并取消旧 render task。
- XLSX 网格用 `react-data-grid` 虚拟化；最多 500k 单元格。
- `cellStyles: true` 只为文档宽度 / 行高 / 数字格式服务：实测 16 MB、50k × 10 工作簿解析增量约 2–3%，可以接受；样式对象不跨 Worker 边界。
- DOCX 渲染失败/清洗失败显示错误态，不拖垮 Files 面板（error boundary）。

## 14. 治理检查点

- `tests/unit/main/files/document-classifier.test.ts`
- `tests/unit/main/files/document-preview-protocol.test.ts`
- `tests/unit/main/files/service.test.ts`
- `tests/unit/main/app-core/csp.test.ts`
- `tests/unit/main/app-core/pdfjs-assets-governance.test.ts`
- `tests/unit/plugins/files/document-preview/{read-result,zip-guard,sanitize,links,pdf-layout,pdf-errors,pdf-worker-lifecycle,xlsx-model,xlsx-limits,xlsx-parse,xlsx-columns,xlsx-filler,use-preview-source,lifecycle}.test.ts`
- `tests/unit/renderer/files/icon.test.tsx`（文档类型图标）
- `tests/component/files/document-preview.test.tsx`
- `tests/unit/plugins/files/document-preview-governance.test.ts`
- `tests/e2e/files/document-preview.spec.ts`

## 15. UI 交付检查表（AGENTS §06）

交付时逐条列出：

1. 28px 密度：PDF 工具栏、XLSX 网格行高；sheet 底栏外壳 36px（28px 轨道居中）。
2. 焦点/Tab 序：canvas/装饰层不进入；工具栏与 sheet tabs 可操作。
3. 颜色令牌：无固定色阶 / 十六进制。
4. shadcn 使用：工具栏使用 `packages/ui` 原语，不手绘按钮。
5. 用户文案：四语齐全，错误带下一步。
6. 透明合成：无 `backdrop-filter` / `translate3d` / `transform-gpu` / `will-change: transform`。
7. 截图：PDF / DOCX / XLSX / fallback，浅色 + 深色 + 窄面板（约 480px）。

## 16. 打包态验证记录

在正式交付前填写：

- [x] `pnpm build:electron` 能解析 PDF worker 与 docx/xlsx chunk（pdf 2.6 MB、xlsx 704 KB、docx 267 KB lazy chunk；pdf/xlsx chunk 内含 inline worker `createObjectURL`）。
- [x] 打包态（arm64 dir 包）中文 PDF 无豆腐块。
- [x] PDF.js / XLSX Worker 在 `file://` 打包态正常启动。
- [x] DOCX 图片走 `data:`，生产 CSP 未拦截。
- [x] XLSX sheet tabs / 截断提示正常。
- [ ] 失败态“在默认应用中打开”能拉起系统应用；失败时有 alert。

开发态 E2E 记录：`pier-file-preview://` 字节 fetch 200、`pier-asset://pdfjs` 可达；scheme 单次注册修复见 §12 偏差记录。

打包态 smoke 记录（2026-11-12，arm64 `electron-builder --dir`，未签 notarize）：

- 构建：`pnpm build:electron && pnpm exec electron-builder --mac --arm64 --dir --publish never -c.mac.notarize=false` → `dist-builder/mac-arm64/Pier.app`。本轮未走完整 `build:dist --no-notarize`（universal native + dmg/zip 打包），因为 smoke 只验证 `file://` / asar / `extraResources` 行为，arm64 dir 包已覆盖同一运行时路径。
- `Contents/Resources/pdfjs/{cmaps,standard_fonts,wasm}` 存在；打包 renderer 内 `fetch("pier-asset://pdfjs/cmaps/Adobe-GB1-UCS2.bcmap")` → 200、33,974 bytes。
- Chromium 生成的中文 PDF：页面画布正常显示「中文 PDF 预览」，无豆腐块；文本层可提取（PDF.js 将部分字形映射为 Kangxi 部首码位，属提取层的字符映射差异，不影响渲染）。
- PDF.js worker 与文本层正常；XLSX worker 正常（Data / Summary 切换）。
- DOCX 内嵌图片渲染为 `data:image/png`（1 张），无任何 `http(s)` 图片 src。
- 50,002 行 × 2 列工作簿：顶部出现「仅显示 50000 行 × 2 列（100000 个单元格）。在默认应用中打开完整表格。」
- 整轮 console error 为 0；“在默认应用中打开”按钮存在。
- 未自动执行的操作：点击“在默认应用中打开”会拉起本机 Office / Keynote，可能干扰用户现有窗口，因此未在 smoke 中点击；按钮 → `context.files.openPath` → main `file.openPath` 路径已由组件测试与既有宿主测试覆盖。
