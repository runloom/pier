# Pierre Diffs 上游能力与同步解析准入证据

核对日期：2026-07-16

规范参照：[DiffsHub 的 Bun PR 30412](https://diffshub.com/oven-sh/bun/pull/30412)

源码冻结基准：`pierrecomputer/pierre@4f94a5e765195b27e1e4188b943aab2ae44613cb`，对应 `apps/diffshub/components/DiffsHubViewer.tsx`、`WorkerPoolContext.tsx` 与 `apps/diffshub/lib/constants.ts`。日常 CI 不访问外网；依赖升级时必须重新核对规范页面和新的固定 commit。

## 版本与供应链

- npm `latest` 与 GitHub 最新非预发布版本均为 `@pierre/diffs@1.2.12`；`1.3.0-beta.9` 仍是预发布版本。
- `@pier/ui` 已与真实 `CodeView` 消费者同批精确固定 `1.2.12`，不使用 `^`，宿主 renderer 不重复声明依赖。
- tarball：`https://registry.npmjs.org/@pierre/diffs/-/diffs-1.2.12.tgz`
- lockfile 完整性：`sha512-pY/gmgWL03WnagqCyCnBi3QtRXUv4hCIY6FYqd5b1ZGaoI6a4Bsji8j+yRl2RfzPh/8Hf19rCl1GE80G6a1cLQ==`
- `@pier/ui/diff-view.tsx` 通过项目统一的 TypeScript、Vite 与 Vitest 源码 alias 解析；构建、类型检查和真实 Electron 懒加载均已验证。包级 `"./*": "./src/*.tsx"` exports 不负责带 `.tsx` 后缀的工作区源码导入。

## 冻结的公开能力

本次按固定上游源码、公开类型和真实生产适配器固定以下形态：

- React `CodeView` 使用 `initialItems` 建立初始拓扑，并通过公开 handle 的 `updateItem()` 原位更新同 id item。Pier 与 DiffsHub 一样用 `initialItems` 建立完整轻量拓扑；同拓扑的 Git revision 与折叠变化只递增 item `version` 并调用 `updateItem()`，只有文件增删导致拓扑变化时才以新的 `initialItems` 重建实例。
- 官方 diff item 是 `{id,type:"diff",fileDiff,version?,collapsed?}`。文本 section 把 main 已准入的 raw patch 交给 `processFile`；特殊状态 section 使用不含真实路径的固定安全展示补丁调用同一官方 `processFile`，随后只覆盖公开 `FileDiffMetadata` 的 `name`、`prevName` 与 `type`，不自绘第二套文件头或正文。
- `CodeViewOptions` 提供 `theme`、`itemMetrics`、`layout`、`stickyHeaders`、虚拟化缓冲设置等公开能力。
- `WorkerPoolContextProvider` 是正式 React 出口。
- DiffsHub 使用 `renderHeaderPrefix` 提供逐文件折叠按钮，并通过公开的 `collapsed`
  item 状态更新正文；Pier 保留同一按钮、方向、禁用条件、滚动锚定与展开语义。Pier
  在适配器内持有 Git revision 与折叠投影，同 id 变化通过官方 `updateItem()` 提交，不复制
  DiffsHub 的数据加载所有权。按钮使用固定上游的 `IconChevronSm` 精确
  SVG 路径；`@pierre/icons@0.7.1` 发布入口含无扩展名 ESM import，Node/Vitest 无法解析，
  因此不引入有缺陷的运行时依赖，而是在内部模块冻结相同 SVG。按钮 class、ARIA、事件拦截、
  旋转条件和图标路径均由治理测试锁定；仅可访问名称按 Pier i18n 规则本地化。
- `CodeViewOptions` 没有 `fontFamily` / `fontSize`。适配器只映射 `--diffs-font-family`、`--diffs-font-size`、`--diffs-line-height`，并让 `itemMetrics` 与 Files 代码字体节奏一致；不使用 `unsafeCSS` 改写正文几何。
- 1.2.12 没有公开 hunk hydrate 回调；首批因此没有 hydrate schema、命令、receipt、公共 handle 或全文 item。
- 业务层不消费 `CodeViewOptions` 或任何 Pierre 类型；`packages/ui/src/diff-view.tsx` 是唯一公开入口。
  同目录直接导入 Pierre 的内部模块按职责固定为五处：`diff-view-items.ts` 负责解析与公开元数据映射，
  `diff-view-worker.tsx` 负责 Worker 生命周期，`use-diff-view-handle.ts` 负责公开命令句柄和原位更新接受，
  `use-diff-view-item-apply.ts` 负责属性驱动更新的接受事务，入口文件只负责组装公开 `CodeView`。
  Git panel 只通过动态 import 取得公开适配器，不能直接导入 Pierre；内部拆分同时受治理测试和文件体积门禁约束，
  不扩大业务边界。
- 同一拓扑更新只有在 Pierre 的 `getItem()` 已持有所提交对象，或 `updateItem()` 返回 `true` 后才算接受。
  接受前适配器不得推进解析缓存、item 身份或已应用快照；`false` 视为暂时拒绝并在下一动画帧读取最新值重试，
  连续三次仍未接受才进入全局可重试渲染反馈。这样既不会丢失稀疏更新，也不会把旧值回放到重挂后的实例。

## DiffsHub 上游配置与 Pier 有意差异

固定 commit 中的上游原值如下；其中 `enableGutterUtility: true` 与上游已实现的
`onGutterUtilityClick` 评论回调成对存在：

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
  theme: currentAppearance.codeTheme,
  themeType: currentAppearance.colorMode,
  unsafeCSS: DIFF_VIEW_STICKY_HEADER_CSS,
}
```

Pier 本范围没有评论回调，因此生产适配器有意使用 `enableGutterUtility: false`，避免显示
点击后无结果的“+”入口。这是相对上游唯一的交互与能力开关差异，并由治理测试锁定；未来只有
在评论能力形成完整交互闭环时才可同时启用入口和回调。`initialItems` + `updateItem()` 的拓扑/增量提交、项目主题与字体令牌映射，
以及与实际字体几何一致的 `itemMetrics`，属于前一节已批准的宿主集成适配，不改变 Pierre 的文件头、
行、gutter、hunk、增删色或官方折叠能力，也不应被表述成新增正文交互。

`DIFF_VIEW_STICKY_HEADER_CSS` 只保留 DiffsHub 官方的吸顶文件头容器和 1px 分隔线结构，颜色映射为 Pier 的 `--border` 语义令牌；这是唯一审计通过的 `unsafeCSS`，不得扩展到行高、gutter、hunk、增删色或正文几何。该配置只定义官方正文区域。Pier 的标签、目录树、分组标题、状态页和动作不在此处另画正文视觉稿。

## Worker 入口结论

- DiffsHub Web 产品使用官方 `worker.js` 和 `shiki-wasm`；桌面细指针环境最多 3 个 Worker、总 AST
  缓存 100，触屏且窄屏或粗指针环境降为 1 个 Worker、缓存 10。Pier 原样保留这两个资源分支。
- Pier 直接使用同一官方入口 `new Worker(new URL("@pierre/diffs/worker/worker.js", import.meta.url), { type: "module" })`，没有本地 entry 或 portable 分支。DiffsHub 的构建器会把该 ESM 入口编译为 Worker 资源；Vite 开发态需要显式声明 module，否则浏览器会把入口当作 classic worker 并报 `Cannot use import statement outside a module`。这只是宿主构建适配，不改变 Worker 实现、高亮器或正文能力。
- 固定的 `1.2.12` 在原生 Worker `error` 时只写控制台，初始化 Promise 也没有截止时间。Pier 不改写
  Worker、渲染器或高亮器，而是在公开边界增加两级有界恢复：Worker `error`、初始化超时
  时卸载 `WorkerPoolContextProvider` 并用同一官方 `CodeView disableWorkerPool` 主线程路径重挂；主线程
  任一正文代际（Worker/inline 模式、item 版本或主题变化）都按当前可见 `item id + version`
  收集公开 `onPostRender`；只有全部当前可见 item 完成才确认该代，滚动出现新的未确认 item 会重新
  启动监督。滚动处理先让 Pierre 在自己的动画帧更新虚拟窗口，再在下一帧审计实际可见 item；
  渐进追加不可见 item 不改变 `CodeViewOptions` 或已注册的 `onPostRender` 回调身份。超时后转为可重试的渲染错误并卸载实例。多 Review 共享的
  模块级工作池故障只向当前已挂载使用方广播，最后一个使用方释放后清除故障代际。
- `pnpm build` 已生成独立 `worker-*.js` 和 `diff-view-*.js`；真实 Electron `file://` 用例验证 Worker/WASM、Shiki 高亮、CSP 和最后一个可见差异视图使用方卸载后的 Worker 终止。

对应证据在 `tests/unit/renderer/pier-diff-view.test.tsx`：锁定不可见 item 追加时不重设
options、滚动后的双动画帧可见窗口审计、后续代际超时与 Worker/inline 两层恢复；
`tests/e2e/git-review.spec.ts` 则在真实 Shadow DOM 与正文滚动容器中验证目标文件头进入视口；目标文件优先完成后，前置 item 的 `updateItem()` 造成高度变化时仍由宿主树选择协调层重新定位，不修改 Pierre 的虚拟化、滚动或渲染实现。

## 同步解析器准入与本机性能

固定候选预算：

- patch UTF-8 字节数：不超过 768 KiB；
- patch 逻辑行数：不超过 20,000；
- 单行正文 UTF-8 字节数：不超过 64 KiB；Pierre 只按 LF 分行，CRLF 中紧邻 LF 的 CR 不计入正文，裸 CR 留在当前行并计 1 字节；
- 目标：官方同步解析器的每类固定夹具 p95 小于 50ms。

计数规则由 main 的 `measurePatchBuffer` 直接在 Git 原始 Buffer 上单次完成：空 Buffer 为 0 行；只有 LF 完成一行；末尾 LF 不产生额外空行；无末尾 LF 的最后一行计入；CRLF 中紧邻 LF 的 CR 不计入正文，裸 CR 留在当前行并计 1 字节。UTF-8 合法性另行严格校验，禁止替换字符后继续。main 在 IPC 前执行准入并把超限文档转成 `tooLarge` state，shared 与 `packages/ui` 不导出或复制内部准入实现。

技术验证使用 Apple M1 Max、arm64 macOS、Node 24.15.0；预热 8 次、每类采样 40 次。1 MiB 候选在混合顺序下因累计 GC 越过 50ms，因此按预定规则把设计边界下调到 768 KiB。生产适配器已落地；真实 Electron 的 10,000 行夹具验证首次可见 <5 秒、可滚动到末行且没有 >100ms renderer long task。

结论：冻结 768 KiB / 20,000 行 / 64 KiB 单行门。若未来依赖升级使任何夹具失败，测试会阻断升级；必须重新测量并降低准入上限，不能放宽 50ms 门或延后到 UI 阶段处理。
