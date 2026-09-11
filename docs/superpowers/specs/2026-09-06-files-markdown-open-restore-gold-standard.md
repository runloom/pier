# Files Markdown 打开姿态金标准

日期：2026-09-06\
状态：现行权威（Markdown 预览阅读位置；顶栏禁止变更芯片）\
范围：打开 / 重开 / 切走再切回 Markdown 预览时的滚动意图；Files 顶栏不得再挂「查看修改」计数。
不包含：跨模式对焦、标题碎片、评论揭示、页内搜索居中；大纲细轨几何；Canvas 相机；表格列宽；变更资源 / 色条 / peek 内容。

实施对照：阅读记忆走既有 `pagination-view` 内容锚点管线。变更入口是色条 / gutter、命令面板 `pier.files.changes.*`、`Alt+F5`。

## 一句话终态

打开 Markdown 预览时，用户回到**上次视口焦点带对准的那段正文**（源码 offset），而不是当时的像素 `scrollTop`；没有记忆或更高优先级意图时从**顶部**开始。语言徽章旁**禁止** FileDiff 图标 + 数字（含非 0）；色条与 gutter 已经表达变更。

## 阅读位置

任意时刻只有一个合法滚动意图。优先级（高赢低）：

1. `#标题` / TOC / `initialAnchor`
2. 评论行、源码→预览 `contentAnchor`、页内搜索当前匹配
3. 阅读记忆 v2（本文）
4. 顶部

搜索匹配与评论揭示仍可用 `block: "center"`——那是一次性定位，不是阅读记忆。阅读还原 **禁止** `scrollIntoView({ block: "center" })`。

### 坐标与落盘

- 真源：已有 `MarkdownCrossModeAnchor`（`offset` + 可选 `blockProgress`，`align` 固定 `"start"`）。捕获复用 `captureMarkdownPreviewAnchor`（视口焦点带，与 TOC spy / 跨模式相同）。
- 键：`pier.files.markdown.scroll:` + `sourcePath`。同文件多标签共享。renderer `localStorage`，**不进 userData**。配额失败静默。
- 载荷 `{ v: 2, offset, blockProgress? }`。`offset === 0` 不写（顶部 = 缺省）。
- **旧 `{ h, top }` 不迁移**；缺 `v: 2`、解析失败视为无记忆 → 顶部。
- **禁止全文哈希作废位置**（正文小改、勾任务不应把人打回顶部）。offset 超出新文档则交给 `applyMarkdownPreviewAnchor` 就近块 / 自然夹紧。
- **捕获时机**：在 `scroll` **事件当时**写入 pending（`captureMarkdownPreviewAnchor`），trailing 250ms 才 `localStorage`。debounce **不得**再读当时的 `scrollTop`。
- 隐藏面板（祖先 `display: none` / `visibility: hidden`）或 `scrollTop <= 0`：**不改 pending、不写 0**。切走 / 卸载 / 隐藏时 **flush pending**（`IntersectionObserver` 只唤醒，是否隐藏以 computed style 为准；对齐 Canvas 相机）。
- 还原锁定期（与内容锚点 reflow 窗口同为 600ms）内不捕获。
- 多窗口：不听 `storage` 互抢；后写覆盖，供下次打开用。

### 还原管线（禁止第二套）

记忆必须走 `pagination-view.tsx` 已有路径：`markdownPagesToForceForOffset` → `applyMarkdownPreviewAnchor`（`align: "start"`）→ `scheduleMarkdownPreviewAnchorReflow`。`preview.tsx` 把记忆并入 `contentAnchor ?? memoryAnchor`。有更高意图时记忆让位并标记该 path 已处理（避免锚点清除后跳回旧记忆）。

**禁止**再在 `useScrollMemory` 里对占位高度写 `scrollRoot.scrollTop`。

只在 **这篇正文已经解析到当前 `value`**（`status === "ready" && sourceValue === value`）时发出记忆锚点。禁止把 B 的 offset 套到仍挂着 A 的 IR / DOM 上。

隐藏后再显示（同一预览实例仍挂着、滚动被浏览器归零）必须换新的 `memoryRequestId` 再走内容锚点管线；不得因「这个 path 还原过一次」而 skip。

## 顶栏变更计数

**禁止**在 Files 顶栏挂 `FileChangesToolbarButton` / FileDiff + 数字。语言徽章旁不再出现变更芯片。行级变更由 gutter / Markdown 色条承担；无可见块或键盘路径走命令面板 / `Alt+F5`。

不新增设置项。不把数字挪到语言 / 编码徽章上。

## 禁止

1. 把裸 `scrollTop` / 滚动比例当跨会话真源。
2. 两帧后对着懒分页估高写像素。
3. 用全文 djb2 / 内容哈希作废阅读位置。
4. 默认 `scrollIntoView({ block: "center" })` 做阅读还原。
5. 记忆进 userData / panel params / 文件旁 sidecar。
6. Files 顶栏画 FileDiff 图标或变更数字（含 0 与非 0）。
7. 监听 `storage` 跨窗同步阅读滚动。
8. debounce 回调里再读 `scrollTop`（隐藏标签会把它打成 0）。
9. 内容未对齐当前 `value` 就 apply 记忆锚点。

## 否决记录

曾考虑落盘像素 `scrollTop`、滚动比例、以及用全文哈希在内容变化时作废。否决：懒分页估高会把「不在中间」的历史画成视口中间；小改与任务勾选会误伤。**禁止复活这些路径。**

曾在语言徽章旁用 FileDiff + 数字作为「查看修改」。否决：色条 / gutter 已表达变更，芯片冗余。**禁止复活顶栏芯片。**

## 检查点

- `tests/unit/plugins/markdown/markdown-open-restore-governance.test.ts`
- `tests/unit/plugins/markdown/markdown-scroll-memory.test.ts`
