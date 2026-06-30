# 终端 CJK 字体渲染修复 — 设计

- 日期：2026-06-30
- 状态：设计已确认，待 plan
- 关联：`docs/superpowers/specs/2026-06-23-ghostty-integration-design.md`

## 1. 问题

终端渲染中文时，个别汉字（如「复」）字形被横向压扁/压瘦，相邻同为全角的字（如「恢」）正常。终端直接显示文本即出现，与窗口显隐/resize 等操作无关。

## 2. 根因（三层，已验证）

1. **font-family 语法错配。** renderer 用 `computeMonoFontFamily` 产出 CSS 风格字符串（逗号分隔 + 含引号），经 IPC 原样喂给 ghostty。但 ghostty 的 `font-family` 是「每行一个字体、可重复」的指令（官方文档：*"This configuration can be repeated multiple times to specify preferred fallback fonts"*），不解析逗号。整串被当成一个不存在的字体名 → 用户字体与整条 fallback 链全部失效。
   - 证据：`native/Vendor/libghostty-spm/Sources/GhosttyTerminal/Configuration/TerminalConfiguration.swift:51` 单行渲染 `font-family = <value>`；`native/src/addon.mm:603` 逗号串原样传入、无 split。
2. **进程 / 来源错配。** Pier 打包的 JetBrains Mono（woff2）、HarmonyOS Sans SC（ttf）是经 CSS `@font-face` 注册给 renderer（Chromium）的 web 字体。而 ghostty native addon 在 **main 进程**（`src/main/ipc/terminal-native-addon.ts:133`）用 CoreText 找**系统**字体，两进程隔离，且 native 侧无任何 `CTFontManagerRegisterFontsForURL` 注册 → ghostty 拿不到这些字体，西文/中文都退回系统默认 + 系统 fallback。
3. **压瘦机制。** 中文无指定字体 → libghostty 内部 CoreText 逐字符系统 fallback，命中 advance 与 cell（按西文等宽算的 2×）不匹配的 face 时，被预编译 libghostty 内部 constrain 横向缩放 → 压瘦。该 constrain 在预编译库内部，Pier 无配置项可关闭，只能从「让中文落到 metrics 合适的字体」入手。

## 3. 目标 / 非目标

**目标**
- 终端中文不再压瘦、网格对齐正确。
- 终端西文用 Pier 打包的 JetBrains Mono Nerd Font（含 Nerd Font 图标）。
- 终端中文用 HarmonyOS Sans SC（与界面中文统一）。
- 字体单一物理副本，renderer 与 main 共用，零冗余。

**非目标**
- 不引入等宽 CJK 字体（不用 Sarasa Mono）。接受 HarmonyOS Sans SC 作为比例字体在终端的表现；若实测仍有个别字不齐，另案处理。
- 不改 libghostty 内部，不向 ghostty 上游提 issue。
- 不新增「用户自选终端字体族」UI（仍只暴露字号），超范围。

## 4. 设计

### 4.1 数据流

- **注册（启动一次）**：app ready → 解析字体目录物理路径 → `addon.registerFonts(paths)` → Swift `CTFontManagerRegisterFontsForURL(urls, .process)` → ghostty 的 CoreText 后端可见。
- **应用（建/改终端）**：renderer `computeMonoFontFamilyList()` → `string[]` → IPC → native 逐项 `withFontFamily(x)` → 渲染成多行 `font-family = x`。

### 4.2 字体单一物理副本 + 自定义协议

- **物理位置**：字体迁出 `src/renderer/public/fonts/`，放顶层 `resources/fonts/`（JetBrains Mono Nerd Font ttf ×4 字重 + HarmonyOS Sans SC ttf ×4 字重）。`electron-builder.yml` 配 `extraResources: { from: resources/fonts, to: fonts }`。不进 asar，全局唯一一份。
- **字体根 helper（main）**：`app.isPackaged ? join(process.resourcesPath, "fonts") : join(<项目根>, "resources/fonts")`，返回目录绝对路径与 ttf 文件列表。CoreText 注册与协议 handler 共用。
- **自定义协议 `pier-asset`（新建，main）**：app ready 前 `protocol.registerSchemesAsPrivileged([{ scheme: "pier-asset", privileges: { standard: true, secure: true, supportFetchAPI: true } }])`；ready 后 `protocol.handle("pier-asset", ...)`，把 `pier-asset://fonts/<file>` 映射到字体目录物理文件返回。
- **renderer**：`src/renderer/app/globals.css` 中所有 `@font-face` 的 `src` 改为 `url("pier-asset://fonts/<file>.ttf")`（JetBrains + HarmonyOS 全部），删除 woff2 引用。
- **统一 ttf**：JetBrains Mono 由 woff2 换成 ttf（Nerd Font 版本），renderer 与 native 共用同一物理 ttf。

### 4.3 字体注册（main + native）

- **新增 addon 接口** `registerFonts(paths: string[]): void`：`addon.mm` 加 Napi 方法 → `ghostty_bridge_register_fonts(const char** paths, int count)` → Swift `CTFontManagerRegisterFontsForURL([URL], .process, &error)`。
- **时机**：main `app.whenReady` 之后、首个 `setupWindow` / `createTerminal` **之前**，调用一次。注册晚于 ghostty 首次查字体即无效。
- **scope `.process`**：仅当前进程可见，不污染用户系统字体库。
- **失败处理**：log 警告，不崩溃、不阻塞终端创建（退回当前行为）。

### 4.4 font-family 多行喂法

- **IPC 契约**：
  - `TerminalFont.family: string` → `string[]`（`src/shared/contracts/terminal.ts:245`）。
  - `NativeAddon.createTerminal(..., fontFamily: string, ...)` → `fontFamilies: string[]`（`src/main/ipc/terminal-native-addon.ts:33`）。
  - `NativeAddon.setTerminalFont(..., fontFamily: string, ...)` → `fontFamilies: string[]`。
  - `addon.mm` 的 create 路径与 `JsSetFontConfig`：收 `string[]` → 逐个传 Swift → 多个 `.fontFamily(...)` command。
- **renderer**：新增 `computeMonoFontFamilyList(userInput): string[]`，产出 `[...用户字体, "JetBrainsMono Nerd Font Mono", "HarmonyOS Sans SC", "Menlo"]`（前两个名以 §4.5 核对的 CoreText 注册名为准）；去空、**去 CSS 引号**、去重、剔除 CSS generic（`ui-monospace` / `monospace`，ghostty 不认）。`src/renderer/panel-kits/terminal/terminal-panel.tsx:272` 与 `:402` 改用它。
- **保留** `computeMonoFontFamily`（CSS 串）继续给 `--pier-mono-font-family` CSS 变量使用，不改。
- **native**：`withFontFamily` 对数组逐项调用 → 多行。
- **兜底**：空数组兜底为 `["Menlo"]`，保证至少有等宽字体。

### 4.5 family name 核对点

ghostty `font-family` 用的名字必须等于字体**注册后 CoreText 中的 family name**，未必等于 CSS `@font-face` 的自定义名（如 "JetBrainsMono Nerd Font Mono" vs "JetBrains Mono Nerd Font Mono"）。实现时用 `fc-scan` / Font Book / `CTFontManagerCopyAvailableFontFamilyNames` 核对 ttf 内部 family name，确保 `computeMonoFontFamilyList` 写出的名字与之一致。

## 5. 影响范围 / 回归风险

- **UI 字体加载**：HarmonyOS Sans SC 同时是界面中文字体，其 `@font-face` 改协议 URL → 影响界面中文加载。回归验证：界面中文显示正常。
- **dev 协议可用性**：自定义协议注册在 main 的 session 上，dev（vite dev server）与 prod（`loadFile`）都经同一 session，需验证 dev 下 `pier-asset://` 实际可加载。
- **打包体积**：JetBrains Mono Nerd Font ttf 比 woff2 大（约 +20MB），renderer/resources 体积上升。本地 app 可接受。

## 6. 验证清单

- [ ] dev 终端 `echo "恢复 复 復 test 123 |"`：中文不压瘦、对齐正确。
- [ ] 终端西文为 JetBrains Mono（字形 + Nerd Font 图标，如 `echo " "` 正常显示）。
- [ ] 界面中文（设置页等）显示正常（HarmonyOS Sans SC 经协议加载成功）。
- [ ] prod 打包后上述三项同样通过（协议 + extraResources 路径正确）。
- [ ] `computeMonoFontFamilyList` 单测：去空 / 去引号 / 去重 / 剔 generic / 空兜底。

## 7. 实现要点（给 plan）

1. 获取 JetBrains Mono Nerd Font ttf（4 字重）；HarmonyOS Sans SC ttf 复用现有。
2. 字体迁到 `resources/fonts/`，删除 `public/fonts/` 下 woff2。
3. 字体根 helper（dev/prod 路径解析）。
4. 自定义协议 `pier-asset` 注册 + handler。
5. `globals.css` 的 `@font-face` 改协议 URL。
6. `electron-builder.yml` 加 `extraResources`。
7. addon `registerFonts` 接口（`addon.mm` Napi + Swift `CTFontManagerRegisterFontsForURL`）。
8. main 启动时注册字体（create terminal 之前）。
9. IPC 契约 `string` → `string[]`（contracts + NativeAddon 接口 + addon.mm + Swift builder）。
10. `computeMonoFontFamilyList` + terminal-panel 两处改用 + 单测。
11. native `withFontFamily` 多行。
12. family name 核对。
13. 回归 + 按验证清单逐项确认。
