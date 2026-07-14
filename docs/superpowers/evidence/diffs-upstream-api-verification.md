# Pierre Diffs 上游能力与同步解析准入证据

核对日期：2026-07-14

规范参照：[DiffsHub 的 Bun PR 30412](https://diffshub.com/oven-sh/bun/pull/30412)

源码冻结基准：`pierrecomputer/pierre@4f94a5e765195b27e1e4188b943aab2ae44613cb`，对应 `apps/diffshub/components/DiffsHubViewer.tsx`、`WorkerPoolContext.tsx` 与 `apps/diffshub/lib/constants.ts`。日常 CI 不访问外网；依赖升级时必须重新核对规范页面和新的固定 commit。

## 版本与供应链

- npm `latest` 与 GitHub 最新非预发布版本均为 `@pierre/diffs@1.2.12`；`1.3.0-beta.9` 仍是预发布版本。
- 当前只记录已核对的稳定版本，不在没有生产消费者时提前安装；T8 与真实 `CodeView` 适配器同批精确固定 `1.2.12`，不使用 `^`，宿主 renderer 不重复声明依赖。
- tarball：`https://registry.npmjs.org/@pierre/diffs/-/diffs-1.2.12.tgz`
- lockfile 完整性：`sha512-pY/gmgWL03WnagqCyCnBi3QtRXUv4hCIY6FYqd5b1ZGaoI6a4Bsji8j+yRl2RfzPh/8Hf19rCl1GE80G6a1cLQ==`
- `@pier/ui` 的 `./diff-view.tsx` 精确导出归 T8，`./code-language.ts` 归 T7；创建时必须避免 wildcard 把扩展名解析为 `.tsx.tsx` 或 `.ts.tsx`。

## 冻结的公开能力

本次按固定上游源码和公开类型完成只读核对；T8 安装依赖后再用编译期测试固定以下形态：

- React `CodeView` 支持受控 `items`，并与 `initialItems` 互斥。DiffsHub 当前使用 `initialItems`；Pier 采用受控 `items` 是为外部 Git revision、可见性释放和不可变刷新服务的架构适配，不声称复制 DiffsHub 的数据所有权模式。
- 官方 diff item 是 `{id,type:"diff",fileDiff,version?,collapsed?}`；raw patch 和 old/new text 必须先经同步 parser 转换。
- `CodeViewOptions` 提供 `theme`、`itemMetrics`、`layout`、`stickyHeaders`、虚拟化缓冲设置等公开能力。
- `scrollTo` 支持 `{type:"line",id,lineNumber,side,align,behavior}`；React props 提供 scroll 与 selection 事件。
- `WorkerPoolContextProvider` 是正式 React 出口。
- `FileContents` / `FileDiffMetadata` 能表达标题、语言和新旧路径；业务 group 标题由 Pier 外层 `headerMetadata` 表达。
- 受控模式的 Pier 公共 handle 只暴露滚动和选择，不暴露 `getInstance`、`getItem` 或任何 item mutation。官方原始 handle 只留在 `packages/ui/diff-view` 内部适配器；同 id/type 的内容变化必须提升单调 `version`。
- `CodeViewOptions` 没有 `fontFamily` / `fontSize`。官方 Shadow DOM 消费 `--diffs-font-family`、`--diffs-header-font-family`、`--diffs-font-size`、`--diffs-line-height`、`--diffs-font-features`；运行时适配必须映射这些变量，并让 `itemMetrics.lineHeight` 与实际行高一致，不能依赖普通字体继承或用 `unsafeCSS` 改写正文几何。
- 1.2.12 没有公开的 hunk hydrate 回调。Pier 只能在外壳中显式请求完整上下文，再把整个 section 从 patch 替换为 texts 并提升 item version。

公开 React handle 清单是 `addItems`、`getItem`、`updateItem`、`updateItemId`、`scrollTo`、`setSelectedLines`、`getSelectedLines`、`clearSelectedLines`、`getInstance`。Pier 公共 handle 只保留 `scrollTo`、`setSelectedLines`、`getSelectedLines`、`clearSelectedLines`；原始实例查询与 item 读取只允许适配器内部使用，避免从 `getInstance()` 重新逃逸到 mutation API。

本次冻结的 option 面包括：主题与高亮器、`itemMetrics`、`layout`、`stickyHeaders`、`smoothScrollSettings`、`pointerEventsOnScroll`、`disableVirtualizationBuffers`、diff 样式/指示器/背景/行号/overflow、hunk separator、selection 和 scroll 回调。业务层不直接消费该类型；第二批适配器只从 `packages/ui` 内部把纯业务 item 翻译为它。

根级 `packages/ui/src/diff-view.tsx` 不在 T1 预建。T8 必须让它成为唯一运行时入口，并验证只读取公共类型不会把 `CodeView`、worker 或 Shiki 带入初始 chunk。

## DiffsHub 对齐配置

```ts
{
  diffIndicators: "bars",
  diffStyle: "split",
  disableBackground: false,
  disableLineNumbers: false,
  enableGutterUtility: true,
  enableLineSelection: true,
  layout: { gap: 1, paddingBottom: 0, paddingTop: 0 },
  lineHoverHighlight: "number",
  overflow: "scroll",
  preferredHighlighter: "shiki-wasm",
  stickyHeaders: true,
  themeType: "system",
  unsafeCSS: DIFF_VIEW_STICKY_HEADER_CSS,
}
```

`DIFF_VIEW_STICKY_HEADER_CSS` 只保留 DiffsHub 官方的 sticky header 容器和 1px 分隔线结构，颜色映射为 Pier 的 `--border` 语义令牌；这是唯一审计通过的 `unsafeCSS`，不得扩展到行高、gutter、hunk、增删色或正文几何。该配置只定义官方正文区域。Pier 的标签、目录树、group header、状态页和动作不在此处另画正文视觉稿。

## worker 入口结论

- DiffsHub Web 产品使用官方 `worker.js`、`shiki-wasm`、最多 3 个 worker 和总 AST 缓存 100；这是正文行为参照。
- `worker.js` 保留裸包 import；Pier 在 Electron `file://` 打包路径采用同版本官方 `worker-portable.js` 是平台装载适配，不是 DiffsHub worker 入口的逐字复制。
- `worker-portable.js` 把依赖便携化，但 `shiki-wasm` 分支仍会动态加载包内相对 WASM chunk，不能声称它没有额外 chunk。T8 必须以语法高亮结果、Vite 开发地址、生产 `file://` worker/WASM URL、CSP、错误事件和最后一个 provider 卸载后的终止行为证明等价；T1 不把尚未执行的运行时门标成已通过。

## 同步 parser 准入与本机性能

固定候选预算：

- patch 或 old+new 合计 UTF-8 字节数：不超过 768 KiB；
- patch 或 old+new 合计逻辑行数：不超过 20,000；
- 单行正文 UTF-8 字节数：不超过 64 KiB；Pierre 只按 LF 分行，CRLF 中紧邻 LF 的 CR 不计入正文，裸 CR 留在当前行并计 1 字节；
- 目标：官方同步 parser 的每类固定夹具 p95 小于 50ms。

计数规则由 shared 的 `measureGitReviewParserText` 固定：空串为 0 行；只有 LF 完成一行；末尾 LF 不产生额外空行；无末尾 LF 的最后一行计入；裸 CR 不能绕过单行门；非 ASCII、astral code point 和 lone surrogate 按 `TextEncoder` 等价的 UTF-8 字节数计算。T5 引入 texts 时 old/new 必须合并计费，不允许每侧各占一份预算；T8 的 UI 准入适配器必须复用同一边界值并增加对照测试。

技术验证使用 Apple M1 Max、arm64 macOS、Node 24.15.0；预热 8 次、每类采样 40 次。1 MiB 候选在混合顺序下因累计 GC 出现 texts p95 54.31ms，因此按预定规则把设计边界下调到 768 KiB，不放宽 50ms。四个固定夹具为 779,741 字节/19,995 行 patch、old/new 合计 759,998 字节/20,000 行、65,536 字节单行和 20,000 行 patch；混合顺序复核 p95 分别约为 7.71ms、9.38ms、0.26ms、4.42ms。这里是研究证据，不声称仓内已经存在官方 parser 生产包装；T8 必须在真实适配器落地时恢复正确性边界测试，并把墙钟性能门放在独立、单 worker 的性能入口，不能混入普通并行单测。

结论：冻结 768 KiB / 20,000 行 / 64 KiB 单行门。若未来依赖升级使任何夹具失败，测试会阻断升级；必须重新测量并降低 admission，不能放宽 50ms 门或延后到 UI 阶段处理。
