# 终端 CJK 字体渲染修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让终端正确渲染中文（消除个别汉字被横向压瘦），终端西文用打包的 JetBrains Mono Nerd Font、中文用 HarmonyOS Sans SC，字体单一物理副本由 renderer 与 main 共用。

**Architecture:** 根因是 ① renderer 把 CSS 风格逗号串喂给 ghostty 的 `font-family`（ghostty 是多行 repeatable 语义，不吃逗号），整串成非法字体名导致字体链全失效；② 打包字体是 renderer 的 `@font-face` web 字体，ghostty（main 进程 CoreText）拿不到。修复三件事：把字体做成单一物理副本经自定义协议给 renderer、经 `CTFontManagerRegisterFontsForURL` 给 ghostty；把 `font-family` 从单串改成数组多行喂；补 CJK 字体到链中。

**Tech Stack:** Electron 42 (main `protocol` API)、React/TS renderer、Swift + ObjC++ N-API native addon (libghostty)、CoreText、electron-builder、Vitest。

**关联 spec:** `docs/superpowers/specs/2026-06-30-terminal-cjk-font-design.md`

**C ABI 约定（贯穿全文）:** 字体名数组与字体路径数组过 C 边界时，用 `\n` join 成单个 C 字符串传递（C 函数签名不变），Swift 端 `split(separator: "\n")` 还原成 `[String]`。理由：避免改动 `extern "C"` 三层指针签名，复杂度集中在 Napi 的 join 与 Swift 的 split 各一处。

---

## Task 1: 字体资源准备与打包配置

把字体收敛成单一物理副本 `resources/fonts/`，JetBrains 由 woff2 换成 ttf，配 `extraResources` 让 main 进程物理可达。

**Files:**
- Create: `resources/fonts/`（目录，放 8 个 ttf）
- Delete: `src/renderer/public/fonts/`（旧 woff2 + HarmonyOSSans/）
- Modify: `electron-builder.yml:16-18`

- [ ] **Step 1: 获取 JetBrains Mono Nerd Font 的 ttf（4 字重）**

从 Nerd Fonts release 下载（含图标的 ttf）：

```bash
mkdir -p resources/fonts
cd /tmp && curl -fsSL -o JetBrainsMono.zip \
  https://github.com/ryanoasis/nerd-fonts/releases/latest/download/JetBrainsMono.zip
unzip -o JetBrainsMono.zip -d JetBrainsMonoNF
# 取 Mono 变体的 4 个字重，重命名为与现 @font-face 一致的文件名
cp "JetBrainsMonoNF/JetBrainsMonoNerdFontMono-Regular.ttf"    "$OLDPWD/resources/fonts/JetBrainsMonoNerdFontMono-Regular.ttf"
cp "JetBrainsMonoNF/JetBrainsMonoNerdFontMono-Bold.ttf"       "$OLDPWD/resources/fonts/JetBrainsMonoNerdFontMono-Bold.ttf"
cp "JetBrainsMonoNF/JetBrainsMonoNerdFontMono-Italic.ttf"     "$OLDPWD/resources/fonts/JetBrainsMonoNerdFontMono-Italic.ttf"
cp "JetBrainsMonoNF/JetBrainsMonoNerdFontMono-BoldItalic.ttf" "$OLDPWD/resources/fonts/JetBrainsMonoNerdFontMono-BoldItalic.ttf"
cd "$OLDPWD"
```

- [ ] **Step 2: 迁移 HarmonyOS Sans SC ttf 到同一目录**

```bash
cp src/renderer/public/fonts/HarmonyOSSans/HarmonyOS_Sans_SC_Light.ttf   resources/fonts/
cp src/renderer/public/fonts/HarmonyOSSans/HarmonyOS_Sans_SC_Regular.ttf resources/fonts/
cp src/renderer/public/fonts/HarmonyOSSans/HarmonyOS_Sans_SC_Medium.ttf  resources/fonts/
cp src/renderer/public/fonts/HarmonyOSSans/HarmonyOS_Sans_SC_Bold.ttf    resources/fonts/
```

- [ ] **Step 3: 核对 ttf 内部 family name（关键，后续 §Task5 与 globals.css 用它）**

```bash
python3 -c "from fontTools.ttLib import TTFont; \
print('JBM:', TTFont('resources/fonts/JetBrainsMonoNerdFontMono-Regular.ttf')['name'].getDebugName(1)); \
print('Harmony:', TTFont('resources/fonts/HarmonyOS_Sans_SC_Regular.ttf')['name'].getDebugName(1))"
# 若无 fonttools: pip install fonttools
```

Expected: 打印两个 family name。记录下来 —— 后续 `computeMonoFontFamilyList` 与 ghostty `font-family` 必须用**这里打印的确切名字**（常见为 `JetBrainsMono Nerd Font Mono` 与 `HarmonyOS Sans SC`，但以实际输出为准；若不同，全文凡用到这两个名处一律替换）。

- [ ] **Step 4: 删除旧 public/fonts**

```bash
git rm -r src/renderer/public/fonts
```

- [ ] **Step 5: 配置 electron-builder 把字体打进 resources**

Modify `electron-builder.yml`，在 `extraResources:`（行 16）下追加：

```yaml
extraResources:
  - from: bin/pier.mjs
    to: bin/pier
  - from: resources/fonts
    to: fonts
```

- [ ] **Step 6: 提交**

```bash
git add resources/fonts electron-builder.yml
git commit -m "chore(fonts): vendor ttf fonts as single physical copy

- 引入 JetBrains Mono Nerd Font ttf 替换 woff2
- HarmonyOS Sans SC ttf 迁入 resources/fonts
- 删除 renderer public/fonts，extraResources 让 main 进程可达

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: 自定义协议 `pier-asset` + 字体根解析

让 renderer 与 main 都能定位 `resources/fonts` 物理目录；renderer 经 `pier-asset://` 协议读字体。

**Files:**
- Create: `src/main/fonts/asset-paths.ts`
- Create: `src/main/fonts/asset-protocol.ts`
- Modify: `src/main/index.ts`（顶层 + `app.whenReady` 内 行 215 之前）

- [ ] **Step 1: 字体根解析 helper**

Create `src/main/fonts/asset-paths.ts`:

```typescript
import { join } from "node:path";
import { app } from "electron";

/** 字体等静态资源的物理根目录。dev 用项目内 resources/，prod 用 process.resourcesPath。 */
export function assetRootDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "fonts")
    : join(app.getAppPath(), "resources/fonts");
}

/** 注册给 CoreText 的全部 ttf 绝对路径。 */
export function bundledFontPaths(): string[] {
  const root = assetRootDir();
  return [
    "JetBrainsMonoNerdFontMono-Regular.ttf",
    "JetBrainsMonoNerdFontMono-Bold.ttf",
    "JetBrainsMonoNerdFontMono-Italic.ttf",
    "JetBrainsMonoNerdFontMono-BoldItalic.ttf",
    "HarmonyOS_Sans_SC_Light.ttf",
    "HarmonyOS_Sans_SC_Regular.ttf",
    "HarmonyOS_Sans_SC_Medium.ttf",
    "HarmonyOS_Sans_SC_Bold.ttf",
  ].map((f) => join(root, f));
}
```

- [ ] **Step 2: 协议 handler**

Create `src/main/fonts/asset-protocol.ts`:

```typescript
import { readFile } from "node:fs/promises";
import { join, normalize } from "node:path";
import { protocol } from "electron";
import { assetRootDir } from "./asset-paths.ts";

export const ASSET_SCHEME = "pier-asset";

/** app ready 之前调用：声明 scheme 为 privileged（standard + secure），否则 @font-face 加载会被 CSP/安全策略拦。 */
export function registerAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: ASSET_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true },
    },
  ]);
}

/** app ready 之后调用：把 pier-asset://fonts/<file> 映射到 resources/fonts/<file>。 */
export function handleAssetProtocol(): void {
  protocol.handle(ASSET_SCHEME, async (request) => {
    const url = new URL(request.url);
    // url.host = "fonts", url.pathname = "/<file>"
    const file = normalize(url.pathname).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
    if (url.host !== "fonts" || !file.endsWith(".ttf")) {
      return new Response(null, { status: 404 });
    }
    try {
      const buf = await readFile(join(assetRootDir(), file));
      return new Response(buf, { headers: { "content-type": "font/ttf" } });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}
```

- [ ] **Step 3: 在 index.ts 接线**

Modify `src/main/index.ts`：

顶层 import 区加：

```typescript
import { registerAssetScheme, handleAssetProtocol } from "./fonts/asset-protocol.ts";
```

在模块顶层、`app.whenReady()` 调用**之前**（与其它顶层语句同级）加：

```typescript
registerAssetScheme();
```

在 `app.whenReady().then(async () => {` 回调内、`installCsp();`（行 165）**之后**、IPC 注册（行 215）之前加：

```typescript
handleAssetProtocol();
```

- [ ] **Step 4: 验证类型与 lint**

Run: `pnpm typecheck && pnpm lint`
Expected: 通过（新文件无类型错误）。

- [ ] **Step 5: 提交**

```bash
git add src/main/fonts/asset-paths.ts src/main/fonts/asset-protocol.ts src/main/index.ts
git commit -m "feat(fonts): add pier-asset protocol for serving bundled fonts

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: globals.css 改用协议 URL + JetBrains 改 ttf

**Files:**
- Modify: `src/renderer/app/globals.css:12-99`

- [ ] **Step 1: HarmonyOS 4 条 @font-face 的 src 改协议 URL**

把 `src/renderer/app/globals.css` 行 12-46 内 4 处 `src: url("/fonts/HarmonyOSSans/<file>.ttf") format("truetype");` 改为：

```css
  src: url("pier-asset://fonts/HarmonyOS_Sans_SC_Light.ttf") format("truetype");
```
```css
  src: url("pier-asset://fonts/HarmonyOS_Sans_SC_Regular.ttf") format("truetype");
```
```css
  src: url("pier-asset://fonts/HarmonyOS_Sans_SC_Medium.ttf") format("truetype");
```
```css
  src: url("pier-asset://fonts/HarmonyOS_Sans_SC_Bold.ttf") format("truetype");
```

（注意路径扁平化：从 `fonts/HarmonyOSSans/x.ttf` 变成 `fonts/x.ttf`，与 Task 1 迁移后的扁平目录一致。）

- [ ] **Step 2: JetBrains 4 条 @font-face 改 ttf + 协议 URL**

把行 52-99 内 4 处 `src: url("/fonts/JetBrainsMonoNerdFontMono-<v>.woff2") format("woff2");` 改为对应 ttf：

```css
  src: url("pier-asset://fonts/JetBrainsMonoNerdFontMono-Regular.ttf") format("truetype");
```
```css
  src: url("pier-asset://fonts/JetBrainsMonoNerdFontMono-Bold.ttf") format("truetype");
```
```css
  src: url("pier-asset://fonts/JetBrainsMonoNerdFontMono-Italic.ttf") format("truetype");
```
```css
  src: url("pier-asset://fonts/JetBrainsMonoNerdFontMono-BoldItalic.ttf") format("truetype");
```

保留每条原有的 `font-weight` / `font-style` / `font-display: block` / `unicode-range` 不变，仅改 `src`。

- [ ] **Step 2.5: 若 Task1-Step3 核对出的 family name ≠ "JetBrainsMono Nerd Font Mono" / "HarmonyOS Sans SC"**

把 8 条 `@font-face` 的 `font-family: "..."` 同步改成核对出的确切名（保持 CSS 与 ghostty 用名一致）。否则跳过此步。

- [ ] **Step 3: 验证（dev 跑起来看界面中文 + 终端西文）**

```bash
pnpm dev
```
Expected:
- 界面中文（设置页等）正常显示（HarmonyOS 经协议加载成功，无方块/无回退到系统字体的明显变化）。
- DevTools Network 中 `pier-asset://fonts/*.ttf` 状态 200。
- 终端此时中文可能仍压瘦（Task 4/6 才修），但西文/界面应正常。

- [ ] **Step 4: 提交**

```bash
git add src/renderer/app/globals.css
git commit -m "feat(fonts): load @font-face via pier-asset protocol, JetBrains woff2->ttf

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: CoreText 字体注册（addon registerFonts）

让 ghostty（main 进程）能找到打包字体。新增 `registerFonts` addon 接口 → Swift `CTFontManagerRegisterFontsForURL`。

**Files:**
- Modify: `native/Sources/GhosttyBridge/GhosttyBridge.swift`（顶部 import + 新 C 导出，约文件尾部 1713 行后）
- Modify: `native/src/addon.mm`（extern 区 行 7-80、新 Js 函数、Init 行 671-700）
- Modify: `src/main/ipc/terminal-native-addon.ts`（接口 + 类型）
- Create: `src/main/fonts/register-bundled-fonts.ts`
- Modify: `src/main/index.ts`（whenReady 内、registerTerminalIpc 行 221 之前调用）

- [ ] **Step 1: Swift 端 C 导出 + CoreText 注册**

在 `native/Sources/GhosttyBridge/GhosttyBridge.swift` 顶部 import 区确认/加入：

```swift
import CoreText
```

在文件末尾（`ghosttyBridgeSetFontConfig` 之后，约 1713 行后）新增：

```swift
@_cdecl("ghostty_bridge_register_fonts")
public func ghosttyBridgeRegisterFonts(_ pathsPtr: UnsafePointer<CChar>) {
    let joined = String(cString: pathsPtr)
    let paths = joined.split(separator: "\n").map(String.init)
    for path in paths where !path.isEmpty {
        let url = URL(fileURLWithPath: path) as CFURL
        var errorRef: Unmanaged<CFError>?
        let ok = CTFontManagerRegisterFontsForURL(url, .process, &errorRef)
        if !ok {
            let desc = errorRef?.takeRetainedValue().localizedDescription ?? "unknown"
            NSLog("[ghostty-bridge] register font failed: \(path) — \(desc)")
        }
    }
}
```

- [ ] **Step 2: addon.mm extern 声明 + Js 函数 + Init 注册**

在 `native/src/addon.mm` 的 `extern "C" { ... }` 块内（行 7-80 之间）加一行声明：

```cpp
    void ghostty_bridge_register_fonts(const char* pathsJoined);
```

在 `JsSetFontConfig`（行 600-611）附近新增：

```cpp
static Napi::Value JsRegisterFonts(const Napi::CallbackInfo& info) {
    std::string joined;
    if (info.Length() >= 1 && info[0].IsArray()) {
        Napi::Array arr = info[0].As<Napi::Array>();
        for (uint32_t i = 0; i < arr.Length(); i++) {
            if (i > 0) joined += "\n";
            joined += arr.Get(i).As<Napi::String>().Utf8Value();
        }
    }
    ghostty_bridge_register_fonts(joined.c_str());
    return info.Env().Undefined();
}
```

在 `Init`（行 671-700）内、`return exports;` 之前加注册：

```cpp
    exports.Set("registerFonts", Napi::Function::New(env, JsRegisterFonts));
```

- [ ] **Step 3: NativeAddon 接口加方法**

Modify `src/main/ipc/terminal-native-addon.ts`，在 `NativeAddon` 接口内（与其它方法同级，例如 `reconcileTerminals` 附近）加：

```typescript
  /** 把打包字体 ttf 的绝对路径注册给 CoreText (.process scope)，让 ghostty 能找到。启动时调一次。 */
  registerFonts(paths: string[]): void;
```

- [ ] **Step 4: main 启动注册模块**

Create `src/main/fonts/register-bundled-fonts.ts`:

```typescript
import { loadNativeAddon } from "../ipc/terminal-native-addon.ts";
import { bundledFontPaths } from "./asset-paths.ts";

/** 启动时把打包字体注册给 CoreText。必须在创建任何 terminal 之前调用。 */
export function registerBundledFonts(): void {
  const { addon, error } = loadNativeAddon();
  if (!addon) {
    console.warn("[fonts] addon 未加载，跳过字体注册:", error);
    return;
  }
  try {
    addon.registerFonts(bundledFontPaths());
  } catch (err) {
    console.error("[fonts] registerFonts 失败:", err);
  }
}
```

- [ ] **Step 5: 在 index.ts 接线（terminal IPC 注册之前）**

Modify `src/main/index.ts`，顶层 import 加：

```typescript
import { registerBundledFonts } from "./fonts/register-bundled-fonts.ts";
```

在 `app.whenReady` 回调内、`registerTerminalIpc(ipcMain);`（行 221）**之前**加：

```typescript
registerBundledFonts();
```

- [ ] **Step 6: 重新编译 native + 类型检查**

Run:
```bash
pnpm setup:worktree && pnpm typecheck
```
Expected: native addon 重编译成功（`gyp info ok`），typecheck 通过。

- [ ] **Step 7: 提交**

```bash
git add native/Sources/GhosttyBridge/GhosttyBridge.swift native/src/addon.mm src/main/ipc/terminal-native-addon.ts src/main/fonts/register-bundled-fonts.ts src/main/index.ts
git commit -m "feat(fonts): register bundled fonts with CoreText for ghostty

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: computeMonoFontFamilyList（纯函数 + TDD）

renderer 产出**字体名数组**（不拼逗号、不加引号），供终端走多行 fallback。

**Files:**
- Modify: `src/renderer/stores/font.store.ts:24-98`
- Create: `src/renderer/stores/font.store.test.ts`

- [ ] **Step 1: 写失败测试**

Create `src/renderer/stores/font.store.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { computeMonoFontFamilyList } from "./font.store.ts";

describe("computeMonoFontFamilyList", () => {
  it("空输入返回内置 fallback 链", () => {
    expect(computeMonoFontFamilyList("")).toEqual([
      "JetBrainsMono Nerd Font Mono",
      "HarmonyOS Sans SC",
      "Menlo",
    ]);
  });

  it("用户字体置于链首", () => {
    expect(computeMonoFontFamilyList("Fira Code")).toEqual([
      "Fira Code",
      "JetBrainsMono Nerd Font Mono",
      "HarmonyOS Sans SC",
      "Menlo",
    ]);
  });

  it("去掉引号与首尾空白", () => {
    expect(computeMonoFontFamilyList('  "My Mono"  ')[0]).toBe("My Mono");
  });

  it("大小写不敏感去重", () => {
    expect(computeMonoFontFamilyList("menlo")).toEqual([
      "menlo",
      "JetBrainsMono Nerd Font Mono",
      "HarmonyOS Sans SC",
    ]);
  });

  it("多个用户字体按逗号拆分且保序", () => {
    expect(computeMonoFontFamilyList("Fira Code, Cascadia Code")).toEqual([
      "Fira Code",
      "Cascadia Code",
      "JetBrainsMono Nerd Font Mono",
      "HarmonyOS Sans SC",
      "Menlo",
    ]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run src/renderer/stores/font.store.test.ts`
Expected: FAIL —— `computeMonoFontFamilyList is not a function`（尚未导出）。

- [ ] **Step 3: 实现 computeMonoFontFamilyList**

Modify `src/renderer/stores/font.store.ts`，在 `MONO_FALLBACK`（行 24-31）之后加一个终端专用的数组 fallback（真实字体名、无 CSS generic）：

```typescript
// 终端 (ghostty) 专用 fallback：必须是真实字体名，不能含 ui-monospace/monospace 这类 CSS generic
const MONO_TERMINAL_FALLBACK = [
  "JetBrainsMono Nerd Font Mono",
  "HarmonyOS Sans SC",
  "Menlo",
];
```

在 `computeMonoFontFamily`（行 96-98）之后加：

```typescript
/**
 * 终端字体族列表 — 返回去重后的字体名数组 (用户字体在前 + 内置 fallback)。
 * 与 computeMonoFontFamily(CSS 串) 区别：用于 ghostty 多行 font-family，
 * 不拼逗号、不加引号、剔除 CSS generic。
 */
export function computeMonoFontFamilyList(userInput: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const name of [...parseUserInput(userInput), ...MONO_TERMINAL_FALLBACK]) {
    const cleaned = name.trim().replace(/^["']|["']$/g, "").trim();
    if (!cleaned) {
      continue;
    }
    const key = cleaned.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(cleaned);
  }
  return result.length > 0 ? result : ["Menlo"];
}
```

（`parseUserInput` 已存在于行 67，按逗号拆分并 trim。）

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run src/renderer/stores/font.store.test.ts`
Expected: PASS（5 个用例全过）。

> 注：若 Task1-Step3 核对出的 family name 不同，同步改 `MONO_TERMINAL_FALLBACK` 与上面测试的期望值。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/stores/font.store.ts src/renderer/stores/font.store.test.ts
git commit -m "feat(fonts): add computeMonoFontFamilyList for terminal fallback chain

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: font-family 数组化贯通（契约 → renderer → IPC → native）

把 `family: string` 全链改成 `string[]`，native 端 `\n` 编码过 C、Swift split 后多次 `withFontFamily`。

**Files:**
- Modify: `src/shared/contracts/terminal.ts:245-248`
- Modify: `src/main/ipc/terminal-native-addon.ts:29-36, 105-109`
- Modify: `src/renderer/panel-kits/terminal/terminal-panel.tsx:13, 272, 402`
- Modify: `src/main/ipc/terminal.ts:243-250, 476-479`
- Modify: `native/src/addon.mm:123, 603`
- Modify: `native/Sources/GhosttyBridge/GhosttyBridge.swift:462, 700-719, 1487-1496`

- [ ] **Step 1: 契约改 string[]**

Modify `src/shared/contracts/terminal.ts`，`TerminalFont`（行 245-248）：

```typescript
export interface TerminalFont {
  /** 字体族 fallback 链 (有序)，已在 renderer 侧由 computeMonoFontFamilyList 产出，native 端逐项喂给 ghostty font-family。 */
  family: string[];
  size: number;
}
```

- [ ] **Step 2: NativeAddon 接口改 string[]**

Modify `src/main/ipc/terminal-native-addon.ts`：

`createTerminal`（行 33）`fontFamily: string` → `fontFamilies: string[]`；`setTerminalFont`（行 107）`fontFamily: string` → `fontFamilies: string[]`：

```typescript
  createTerminal(
    parentHandle: Buffer,
    panelId: string,
    frame: TerminalFrame,
    fontFamilies: string[],
    fontSize: number,
    launch: ResolvedTerminalLaunchOptions | undefined
  ): boolean;
```
```typescript
  setTerminalFont(
    parentHandle: Buffer,
    fontFamilies: string[],
    fontSize: number
  ): void;
```

- [ ] **Step 3: renderer 两处改用 computeMonoFontFamilyList**

Modify `src/renderer/panel-kits/terminal/terminal-panel.tsx`：

行 13 import 改：

```typescript
import { computeMonoFontFamilyList, useFontStore } from "@/stores/font.store.ts";
```

行 272（create 内）：

```typescript
            family: computeMonoFontFamilyList(monoFontFamilyRef.current),
```

行 402（setFont 内）：

```typescript
      family: computeMonoFontFamilyList(monoFontFamily),
```

- [ ] **Step 4: main IPC handler 透传数组**

Modify `src/main/ipc/terminal.ts`：

create handler（行 243-250）把 `args.font.family` 原样传（现在类型已是 `string[]`，无需改逻辑，仅确认类型通过）。set-font handler（行 476-479）同理传 `font.family`。两处调用代码不变，靠类型收紧驱动 native 接口对齐。

- [ ] **Step 5: addon.mm 两处取数组 join("\n")**

Modify `native/src/addon.mm`：

`JsCreateTerminal` 行 123，把：
```cpp
    std::string fontFamily = info[3].As<Napi::String>().Utf8Value();
```
改为：
```cpp
    std::string fontFamily;
    if (info[3].IsArray()) {
        Napi::Array arr = info[3].As<Napi::Array>();
        for (uint32_t i = 0; i < arr.Length(); i++) {
            if (i > 0) fontFamily += "\n";
            fontFamily += arr.Get(i).As<Napi::String>().Utf8Value();
        }
    }
```

`JsSetFontConfig` 行 603，把：
```cpp
    std::string fontFamily = info[1].As<Napi::String>().Utf8Value();
```
改为：
```cpp
    std::string fontFamily;
    if (info[1].IsArray()) {
        Napi::Array arr = info[1].As<Napi::Array>();
        for (uint32_t i = 0; i < arr.Length(); i++) {
            if (i > 0) fontFamily += "\n";
            fontFamily += arr.Get(i).As<Napi::String>().Utf8Value();
        }
    }
```

（`ghostty_bridge_create_terminal` / `ghostty_bridge_set_font_config` 的 C 签名与下传 `fontFamily.c_str()` 不变 —— 现在内容是 `\n` 分隔的多字体。）

- [ ] **Step 6: Swift 端 split 并多次 withFontFamily**

Modify `native/Sources/GhosttyBridge/GhosttyBridge.swift`：

行 462，`TerminalRuntimePreferences.fontFamily`：
```swift
    var fontFamilies: [String] = []
```

`terminalConfiguration(from:)`（行 700-719）内行 705-707：
```swift
        for family in preferences.fontFamilies where !family.isEmpty {
            builder.withFontFamily(family)
        }
```

`applyFontConfig`（行 1487-1496）把入参的 `\n` 串 split 后写入数组：
```swift
    func applyFontConfig(
        window: NSWindow,
        fontFamily: String,
        fontSize: Float
    ) {
        let families = fontFamily.split(separator: "\n").map(String.init)
        mutateTerminalRuntimePreferences(window: window) { preferences in
            preferences.fontFamilies = families
            preferences.fontSize = fontSize
        }
    }
```

（`createTerminal` 与两个 C 导出函数的 `fontFamily: String` 参数名/签名保持不变 —— 它们只是把 `\n` 串透传到 `applyFontConfig`，由后者 split。）

- [ ] **Step 7: 重编译 + 全量检查**

Run:
```bash
pnpm setup:worktree && pnpm check
```
Expected: native 重编译成功；typecheck / lint / depcruise / file-size 全过。

- [ ] **Step 8: 提交**

```bash
git add src/shared/contracts/terminal.ts src/main/ipc/terminal-native-addon.ts src/renderer/panel-kits/terminal/terminal-panel.tsx src/main/ipc/terminal.ts native/src/addon.mm native/Sources/GhosttyBridge/GhosttyBridge.swift
git commit -m "feat(terminal): feed font-family as multi-line fallback chain to ghostty

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: 端到端验证

**Files:** 无（验证）

- [ ] **Step 1: dev 跑起来，终端混排测试**

```bash
pnpm dev
```
在终端面板执行：
```bash
echo "恢复 复 復 测试对齐 test 123 || ||"
```
Expected: 中文**不再压瘦**、与西文按等宽网格对齐；西文为 JetBrains Mono 字形。

- [ ] **Step 2: Nerd Font 图标**

终端执行：`echo "    "`（粘贴几个 Nerd Font 图标字符，如 powerline 箭头）
Expected: 图标正常显示（说明 JetBrains Nerd Font 已被 ghostty 经 CoreText 用上）。

- [ ] **Step 3: 界面中文回归**

打开设置页等含中文的界面。
Expected: 界面中文正常（HarmonyOS Sans SC 经 `pier-asset://` 加载），无方块、无明显字体回退。

- [ ] **Step 4: 修改终端字体设置热更新**

设置里改等宽字号 / 字体族，回终端。
Expected: `setFont` 生效，字体/字号即时更新，中文仍不压瘦。

- [ ] **Step 5: prod 打包验证**

```bash
pnpm build && pnpm exec electron-builder --dir
```
启动 `dist-builder/mac-arm64/Pier.app`，重复 Step 1-3。
Expected: 打包后 `pier-asset://` 协议、`process.resourcesPath/fonts` 注册、ghostty 字体均正常（验证 extraResources 路径与 isPackaged 分支）。

- [ ] **Step 6: 全量测试兜底**

Run: `pnpm test:unit`
Expected: 全过（含新增 computeMonoFontFamilyList 用例）。

---

## 自检备注

- **spec 覆盖**：§4.2 单副本+协议 → Task 1/2/3；§4.3 CoreText 注册 → Task 4；§4.4 多行喂法 → Task 5/6；§4.5 family name 核对 → Task1-Step3 + Task3-Step2.5 + Task5-Step4 注；§5 回归 → Task 7-Step3；§6 验证清单 → Task 7。
- **类型一致**：`TerminalFont.family: string[]`（Task6-S1）↔ `computeMonoFontFamilyList(): string[]`（Task5）↔ NativeAddon `fontFamilies: string[]`（Task6-S2）↔ addon.mm `info[].IsArray()`（Task6-S5）↔ Swift `\n` split（Task6-S6）。`registerFonts(paths: string[])`（Task4-S3）↔ `bundledFontPaths(): string[]`（Task2-S1）。
- **C ABI**：font-family 与 paths 均走 `\n` join/split，C 签名不变。
