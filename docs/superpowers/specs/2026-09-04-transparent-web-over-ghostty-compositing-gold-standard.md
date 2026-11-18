# 透明 web 叠 Ghostty 合成金标准

日期：2026-09-04  
状态：现行权威（桌面窗合成）  
范围：macOS `WebContentsView` 叠在 Ghostty NSView 上时，产品 web 层允许与禁止的合成样式。web 表面整体不透明；终端洞透明、由洞遮罩负责透出 native。  
不包含：窗口缩放时藏 native 的 matte（那是 AppKit 整窗 resize 路径）；焦点路由；滚动条渐隐 mask（见滚动条金标准）。

权威实现：[`packages/ui/src/image-preview/controls.tsx`](../../../packages/ui/src/image-preview/controls.tsx)（预览字号 / 图片 / 画布 zoom 胶囊）；native 洞遮罩 [`native/Sources/GhosttyBridge/TerminalHoleMask.swift`](../../../native/Sources/GhosttyBridge/TerminalHoleMask.swift)；分栏 sash 登记 [`src/renderer/lib/workspace/sash-web-overlays.ts`](../../../src/renderer/lib/workspace/sash-web-overlays.ts)。检查点 [`tests/unit/renderer/app/gpu-compositing-governance.test.ts`](../../../tests/unit/renderer/app/gpu-compositing-governance.test.ts)、[`tests/unit/native/terminal-hole-mask-governance.test.ts`](../../../tests/unit/native/terminal-hole-mask-governance.test.ts)、`native/Tests/GhosttyBridgeTests/TerminalHoleMaskTests.swift`。  
相关先例：`82926809`（终端浮层 `translate3d` 残影）、`cef4c928`（drag-over 半透明色斑）、命令面板 / 设置遮罩禁 `backdrop-blur`、`62b82e2f`（分栏不准藏 native）。

---

## 一句话终态

终端洞必须保持透明，好让 Ghostty 透出来。洞上和洞边的 web 不得再开一层会采样或缓存旧像素的合成层。该实的表面自己铺不透明底并裁切。**终端洞由 native 遮罩硬保证：web 合成层只能在非终端矩形与已登记浮层矩形内出像素，用户内容不可控也不影响终端。** 同时，**web 表面（`WebContentsView` backing）必须整体不透明**：终端透出只由洞遮罩负责，透明 backing 会让 Chromium 的部分重绘保留旧帧像素。

---

## 根因与 hard guarantee（native 洞遮罩）

Chromium 的合成层（`ViewsCompositorSuperview`）覆盖整个窗口，终端 NSView 在它下面。此前产品靠「终端区域 web 输出 alpha=0」的礼貌约定：只要任意 web 内容（尤其是用户 HTML 的 `backdrop-filter`、3D transform、`will-change`）把该区域提升为独立合成层，或 macOS 保留旧层像素，web 就会画在终端上，形成重叠 / 残影。用户 HTML 不可控，不能靠治理测试或注入 CSS 解决。

宿主在 `ViewsCompositorSuperview.layer` 上挂 `CAShapeLayer` mask（`TerminalHoleMask`）做**硬裁**：

1. 遮罩基础路径 = 整个 compositor 窗口矩形；所有 **visible** 终端 viewport 矩形挖成洞（even-odd），web 在洞里一个像素都画不出来。终端矩形先合并相交项，保证 even-odd 不会把重叠交集翻回可见。
2. `webOverlayRects` 与终端 viewport 的交集回填为可见：登记浮层仍能盖在终端上（终端 floating pill、工具提示、上下文菜单、命令面板、dockview 分栏 sash 等）。`webOverlayRects` 是 web 覆盖终端的唯一几何真源。条目带 `paints: false` 的浮层**只参与事件路由**（全屏输入捕获：菜单 / popover 打开期间改道点击、sash / tab 拖拽），不参与回填——它们本身不画像素，整窗矩形若回填会把所有洞抹空。弹窗 / 确认框的整窗蒙层同样是 `paints: false`，但带 `scrim` 色：native `TerminalScrim` 在蒙层矩形与终端 viewport 的交集上、web 合成层之下画同色半透明，终端内容被压暗，而不是被不透明 backing 替换，也不是从蒙层里被裁掉。同一通道也用于拖拽落点等既半透明又需要边框的产品浮层：`scrimBorder` 携带 computed border，native 在洞内补画同色半透明描边；**绝不把落点 anchor 改成 `paints: true`**，否则终端会被不透明 backing 替换。纯输入捕获不带 `scrim`，不压暗。
3. 终端不可见（`visible=false`，如 content preview suppress）→ 不挖洞；没有可见终端 → 移除 mask；`closeAll` / `detachWindow` 清 mask。
4. 坐标：renderer 的 `TerminalFrame` 是 contentView top-left CSS px；合成层未翻转（Electron 43 macOS 实测 `isFlipped=false`），mask 路径用 bottom-left，换算必须做 Y-flip；compositor 重建后由下一次 `applyWindowState` 重新挂上。
5. mask 路径更新必须在 `CATransaction.setDisableActions(true)` 内，避免洞位动画滞后。
6. **压在终端上的产品 chrome 必须登记**：dockview 分栏 sash（`.dv-sash`）跨在相邻终端 viewport 上，由 workspace host（`src/renderer/lib/workspace/sash-web-overlays.ts`）在 layout change、active panel change、sash inline style 位移、DOM 增删时同步登记。登记同时是输入命中真源（点分栏不落到终端）；未登记的产品 chrome 在终端矩形内会被硬裁（2026-11-09 分栏线消失）。dockview 浮组（`.dv-resize-container`）整体是 web 面，必须回填；浮组内含可见终端时只回填标题栏 / tab 条 / 不承载终端的 content 区，终端 body 保持洞——整块回填会抹掉终端自己的洞。composer 自动补全等 body portal 同样必须登记元素几何。拖拽落点（`.dv-drop-target-anchor`）由 `drop-overlay-web-overlays.ts` 按 `scrim + scrimBorder` 登记：这是半透明产品浮层，不能回填；anchor 位置随 inline style 与 top/left/width/height transition 逐帧同步。sash 与落点层共用 `overlays/reconciler.ts` 的 DOM 集合对账 / rAF 合并。
7. **web 表面不透明**：macOS 的 `WebContentsView` backing 使用窗口兜底色（`NATIVE_CHROME_FALLBACK`），主题切换时窗口背景与 web backing 同步（`windowManager.setNativeChromeColor`）。不允许回退到透明 backing。终端可见性已由 mask 硬裁负责；透明 backing 会让 Chromium 的部分重绘（buffer age / partial swap）在未覆盖区域保留旧帧像素。洞遮罩是透出的唯一职责方，web 透明度不是。

遮罩是结构性保证，不是安全边界；它不替代下面的产品源码禁令：登记浮层本身仍会被回填进可见区，`backdrop-filter` / 三维位移的旧层残留风险仍在。

---

## 外观采样契约（圆角 / 阴影 / 蒙层）

洞遮罩回填的是**几何**；圆角楔、盒外阴影、蒙层色都来自 renderer 对 computed style 的**采样**。采样错了 native 不会报错，只会画成直角、无影或无色——2026-11-13 终端运行时胶囊的「额外边角 + 阴影不生效」就是这条链路上的纯采样失败。规则：

1. **几何元素 ≠ 绘制元素**。`registerElement` 的 `element` 永远是命中与几何真源；若它只是布局外壳（透明、直角、无阴影），注册时用 `appearanceElement: () => 绘制子元素`，圆角 / 阴影 / 蒙层从绘制元素读。静态工具槽 `TerminalFloatingStaticItem` 固定如此（外观取 `firstElementChild`）。绘制元素缺席（尚未挂载 / 已卸载）时按「无外观」发布，**不得回退采样外壳**——外壳的圆角 / 阴影是另一套语义。禁止给外壳补一份假的圆角 / 阴影 CSS 充数，也禁止把外壳尺寸当真源另起一个壳。
2. **颜色语法单一来源**。`box-shadow` 里的颜色（含 color-mix 序列化成的 `oklab(...)`）只能经 `parseCssColor` / `findCssColor` 解析；任何调用点禁止另写颜色正则。认不出 → fail-quiet（native 不画），但开发态按整层原文 `console.warn` 一次，禁止静默丢层。
3. **长度允许指数记法**。Chromium computed 的 Tailwind `rounded-full` 是 `1.67772e+07px`，阴影长度也可能是指数形式；解析正则必须接受 `e[+-]?\d+`。圆角还要接受 `%`（按 border box 短边换算）与椭圆单角两值（`10px 20px`，取较大者，宁可多挖露终端也不欠挖留 backing 角）；CSS used radius 会钳到短边一半，采样必须同钳，否则 native 画的楔与浏览器绘制不一致。
4. **只送「画得出来」的阴影**。inset 不送（盒内 web 自己画）；`x` / `y` / `blur` / `spread` 全零的层不送（送出去只会在圆角洞里衬一块实色）；负 blur 不送。alpha 乘元素 opacity，淡入淡出时阴影与蒙层同拍。opacity 采样必须跟**运行中且 keyframes 真的在动画 opacity** 的动画：tw-animate 的 `enter` / `exit` 名字不含 fade，opacity 由 `--tw-enter-opacity` / `--tw-exit-opacity` 驱动，只按名字匹配会把弹层钉在挂载时的 opacity=0，阴影 alpha 永远为 0。无限动画（pulse / spin）不续帧；逐帧链先确认动画仍在运行再读色，最后一步不得读 `fill-mode: none` 的回弹帧（否则淡出结束按全强度重发一帧）。
5. **一次 flush，两个采样源**。ResizeObserver / layout pulse / animationend 观察注册元素；几何取注册元素、外观取 `appearanceElement()`，两者必须写进同一份快照。禁止把外观目标再注册成第二个浮层条目（会多出一块回填矩形）。
6. **回归矩阵**。单测必须覆盖 Chromium 真实序列化：指数圆角、`oklab(...)` 阴影、透明 ring 层、`%` 圆角与钳位、椭圆两值圆角、透明外壳 + 绘制子元素、tw-animate `enter` 从 opacity 0 起步后的满强度阴影、无限 opacity 动画不续帧。E2E（`tests/e2e/terminal/overlay-coexistence.spec.ts`）从 `debugSnapshot().coordinator.desired.webOverlayRects` 断言 `terminal-search` 条目 `radius > 0` 且 `radius <= min(frame)/2`、`shadows` 非空；再用 `Meta+N` 打开新建菜单，断言 `terminal-overlay` 条目阴影 alpha 回到满强度——这条链路直接对应终端上的边角与阴影，不靠截图猜。

---

## 决策树

1. **终端锚点 / 状态栏透明洞** → 保持透明；不要 `backdrop-filter`、不要三维位移、不要半透明大面积叠在洞上。
2. **预览控件、图片 diff 字幕、Files 正文** → 不透明 `bg-background`（或语义底）；禁止 `backdrop-blur*`。
3. **命令面板 / 设置 / Dialog 遮罩** → 已经禁止 blur；新遮罩抄同一纪律。
4. **分栏 / 浮层改大小** → 只拦输入，**不准藏 native**。窗口边拖拽才走 surface suppress。
5. **必须用被禁样式** → 先改设计；例外只能进治理测试 allowlist，写明为什么不能用不透明底 / 2D `left`/`top`。

---

## 禁止（产品源码）

扫描范围必须包括 `packages/ui/src`、`src/renderer`、`src/plugins/builtin`。只扫 renderer 会漏掉共享控件（2026-09-04 Markdown 预览残影：`ImagePreviewControls` 在 `packages/ui`）。

| 标记 | 为什么 |
|------|--------|
| `backdrop-blur*` / `backdrop-filter:` | 强制独立合成层。Chromium/WebKit 的 backdrop 不采样下层 Ghostty（跨 `WebContentsView` 实测为自身半透明雾），但会跨 iframe 文档边界采样父文档；真正危险的是被提升层的旧像素由 macOS 保留并跨位置复现（`82926809`） |
| `filter: blur()` | 同源：强制独立合成层 |
| `translate3d` / `translateZ` / `transform-gpu` / `will-change: transform` / `backface-visibility` / `perspective()` | 把节点提成 GPU 层；macOS 在 hover / 局部重绘时保留旧层像素（`82926809`） |

2D `translate-x` / `translate-y`（如 TOC `-translate-y-1/2`）不在三维禁令里；新代码仍优先用 `left`/`top`。

---

## 明确不做

- 用 sash 拖拽 `acquireTerminalSurfaceSuppression` 去「盖住」残影
- 给全部 `.dv-content-container` 加 `overflow: hidden` 当万能药（会裁到终端组）
- 把对话框禁 blur 的测试当成全产品覆盖
- 在注释里写 `backdrop-filter:` 冒号形式（治理扫描会当成 CSS）

---

## 复发记录

Markdown 预览字号复用图片 zoom 胶囊，带上 `backdrop-blur-sm`。源码模式不挂该控件所以不闪。治理测试当时只扫 `src/renderer`、只禁三维位移，共享 UI 包漏网。

2026-11-09 Files 预览用户 HTML 的 `backdrop-filter` / `will-change` 造成终端内容重叠。产品源码禁令管不到用户内容；根治是 native 洞遮罩（见「根因与 hard guarantee」）。同时纠正旧表述：跨独立 `WebContentsView` 的 backdrop 不采样下层 Ghostty，危险的是跨 iframe 文档采样与旧合成层像素残留。

同日洞遮罩上线后分栏线消失：`.dv-sash` 压在相邻终端 viewport 内，未登记即被硬裁。修复是 workspace host 登记 sash 几何（登记同时服务输入命中），不是放宽洞几何或给分栏单独开像素通道。

同日 dockview 浮组（Shift 拖 tab 出来）与 composer 自动补全列表压在终端上被整块硬裁：浮组容器与 body portal 都不在 `webOverlayRects`。修复是浮组按「是否含可见终端」分件登记（含终端时只回填标题栏 / tab 条 / 非终端 content，整块回填会抹掉终端自己的洞），自动补全 portal 用共享 registry 登记自身几何并在定位变化后 flush。

同日终端状态栏文字重影（用户 HTML 玻璃页在场时缩放窗口即复现）：截图里同一组 chip 出现两份，旧份与缩放前像素逐点一致，`webContents.invalidate()` 全量重绘可清、随后的局部重绘又复发；摘掉 native mask 后重影仍在。根因不是洞遮罩，而是 `WebContentsView` 用了透明 backing：Chromium 部分重绘（buffer age / partial swap）把新帧透明区域混合在旧帧像素上，旧文字从「状态栏透明底」透出。修复是 web backing 改为不透明兜底色并与窗口背景同步（见 hard guarantee 第 7 条）；终端可见性继续由洞遮罩硬裁，不靠 web 透明度。

同日 web backing 改不透明后，sash 拖拽瞬间终端整块变成兜底色：全屏输入捕获层把整窗矩形登记进 `webOverlayRects`，被洞遮罩当作「web 可绘制区」回填，所有终端洞被减空 → 移除 mask → 不透明 backing 直接盖住终端。修复不是恢复透明 backing，而是把「输入捕获」与「允许绘制」分成两个语义：全屏捕获层以 `paints: false` 登记，只进事件路由；真正绘制的浮层内容（菜单 / popover / toast / sash）仍按元素几何回填（见 hard guarantee 第 2 条）。

弹窗蒙层沿用 `paints: false` 之后，终端矩形里蒙层像素被洞裁掉，终端保持原亮度。不能把蒙层改回 `paints: true`：半透明 scrim 叠在不透明 backing 上，看到的是兜底色而不是被压暗的终端。修复是 native 在洞内画与蒙层 computed background 同色的半透明（`TerminalScrim`），洞本身保持挖开。淡入淡出只用 `pier-overlay-fade-in` / `pier-overlay-fade-out`（只动画 opacity；禁止 tw-animate `enter` / `exit`，那两个 keyframe 会在整段过渡写全零 blur / 三维位移）。native 蒙层 alpha 要乘上元素当前 opacity，并在动画进行中逐帧重读：底部状态栏在洞外跟着网页 opacity，洞里若停在终值，过渡中底部状态栏和终端不是同一亮度。回填矩形带均匀 `radius` 时，圆角曲线外、且与终端相交的角挖回洞（再吃进 1pt，盖住对着不透明 backing 烘焙的抗锯齿脏边）；圆角外的角若留在回填里，终端上会看到兜底色边角。下拉 / popover 的 `box-shadow` 画在 border box 之外：洞只回填 `getBoundingClientRect()`，阴影只在终端上被硬裁，落在非终端区域时同一条 CSS 阴影仍在。不要把回填矩形扩到阴影盒，半透明像素会露出不透明 backing。computed outset shadow（不含 inset）交给 `TerminalShadow`，画在 web 合成层之下、终端之上；CSS blur 在 CoreGraphics 里取一半，alpha 乘元素 opacity。

同一轮评审定下的取舍与补丁：

- **楔不穿上层回填**：圆角楔若落进另一块 `paints: true` 回填矩形的 box 内，必须从楔路径里排除（`other.rect != overlay.rect` 例外只放过自身 box），否则 even-odd 会把上层卡片像素打穿露出终端（toast 大圆角胶囊 + 上层菜单场景）。
- **洞空不早退**：回填卡片完全盖住终端时 `holeRects` 为空，但楔仍非空——两者都空才摘 mask；否则 1pt outset 与圆角弧外的角在终端四角露兜底色。
- **层序**：`TerminalScrim`（蒙层压暗一切）在最下，`TerminalShadow`（浮层自己的铬）在其上，web 合成层再其上。scrim 后于 shadow apply 时要插进已有 shadow 之下，不能贴着合成层插（会把投影抬到蒙层上面，洞里投影不跟着变暗）。已接受的不一致：蒙层不调制投影颜色，toast 阴影在弹窗蒙层下保持原强度。
- **阴影层数超限截断不拒绝**：main 校验只认「每项合法」，层数超上限在 focus-coordinator 截断前 16 层——一份装饰过度的快照不能让整窗洞遮罩停更。
- **fail-quiet 解析**：`parseCssColor` 只认 Chromium computed 实际产出的记法（legacy/modern rgb、srgb、oklab），认不出返回 undefined、native 不画，不猜颜色；复合声明（如 `box-shadow`）里的颜色 token 只经 `findCssColor` 交给同一解析器，调用点不得维护第二套颜色正则。透明度采样只跟真的在动画 opacity 的 keyframes（tw-animate `enter` / `exit` 也算，名字不要求含 fade）或 opacity / all transition；注册浮层上的无限动画（pulse / spin）不会把逐帧 flush 链无限续命。
- **animationend 只补几何**：淡出结束 fill-mode none 让 computed opacity 回弹到 1，此刻整份重读会把蒙层/阴影按全强度重发一帧（终端上闪一下）；逐帧链已发过当前 opacity 的终帧，动画结束沿用最近一次采样只更新矩形。
- **统一最大圆角**：四角不一致取最大（现在产品只有对称圆角卡）。已接受的权衡：不对称圆角（sheet 形）会在 painted 直角上多挖一个楔（洞里露终端，比兜底色楔轻）；真出现 sheet 形再升级契约为四角数组。

2026-11-13 终端运行时胶囊「四角露兜底色 + 阴影不生效」：`rounded-full` 的 computed radius 是 `1.67772e+07px`，十进制 px 正则解析成 0 → 回填按直角切角，胶囊四角露出不透明 backing；`shadow-background/40` 的 computed 颜色是 `oklab(...)`，阴影解析自己维护的 `COLOR_FN` 只认 rgb/color → 整层被静默丢弃。同一轮还发现终端搜索条注册的是透明的静态槽外壳（圆角 / 阴影画在子元素上），即使解析修好也仍是直角无影。修复：半径解析接受指数记法 / `%` / 椭圆两值（取大）并钳到短边一半；阴影颜色改走共享 `findCssColor` → `parseCssColor`；注册契约增加 `appearanceElement`，静态槽从绘制子元素采样，绘制目标缺席按无外观发布、不回退外壳；同缺陷类扩到 composer（定位外壳 vs chrome 卡）与补全 portal；浮层拖拽的整面板输入捕获改回 `paints: false`，不再抹空终端洞。无法解析的可见阴影层在开发态告警一次。教训：洞遮罩的几何是硬保证，外观采样是软环节；采样失败必须留下线索，不能让 native 静默画错。

2026-11-18 拖拽 tab 到 panel 上下左右时落点预览在终端上完全消失：dockview 仍会创建 `.dv-drop-target-anchor`，但洞遮罩把它当未登记 web 像素硬裁；`overlay-preview.ts` 只登记了 `paints: false` 的全屏输入捕获层，救不了绘制。修复不是把 anchor 改成 `paints: true`（那会把终端替换成不透明 backing，丢失半透明要求），而是由 `drop-overlay-web-overlays.ts` 以 `scrim + scrimBorder` 登记：native 在洞里画 computed background 的同色半透明填充，并按 computed border 补画同色描边；web anchor 继续负责非终端表面。几何要跟 inline style 和 top/left/width/height transition 逐帧同步，dragend 移除 anchor 时同拍拆 native 蒙层。教训：半透明产品浮层在洞遮罩下必须同时解决「填充」和「边框」，不能只补一个 `paints: true` 回填。

同日 add-panel / dropdown 弹层压在终端上没有阴影：Radix 弹层用 tw-animate `enter` 淡入，挂载时 computed opacity 为 0；透明度采样只按 keyframe 名是否含 fade 匹配，而 `enter` 名字不带 fade，逐帧链没有启动，`animationend` 又只补几何、沿用缓存外观，阴影 alpha 永远停在 0（圆角正常，只剩「有角无影」）。修复：opacity 采样改看 keyframes 是否真的动画 opacity（`enter` / `exit` 都算），无限动画不续帧，逐帧链先确认动画仍在运行再读色、避免淡出结束回弹帧按全强度闪一下；E2E 用 `Meta+N` 打开新建菜单，断言 `terminal-overlay` 条目的阴影 alpha 回到满强度。教训：动画里的外观不是挂载时的一个静态值，采样必须覆盖整段动画直到终态。
