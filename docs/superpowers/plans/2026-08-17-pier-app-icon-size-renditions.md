# Pier App Icon Size Renditions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已确认的 F 标准稿和 I Micro 稿接入 Pier 的全部正式图标资产，并让 macOS ICNS 按尺寸选择正确稿件。

**Architecture:** SVG 是唯一设计源。macOS 先用 electron-builder 固定版本的官方工具分别生成 F/I 现代 ICNS 条目，再由 macOS `sips` 为 I 生成系统兼容的非 Retina 16/32px legacy RGB + alpha 条目，最后由纯函数模块完整校验并合并；Windows、Linux 从透明 F 稿生成，开发 Dock 从 I 稿生成。

**Tech Stack:** SVG、Node.js 24 ESM、electron-builder 26.15.3 `runIconsTool`、`rsvg-convert`、Vitest 4、Electron Builder。

## Global Constraints

- F 必须与 `/private/tmp/pier-logo-preview/f-decoupled-terminal.svg` 的 SHA-256 `ed1f59e2d4f95f62ed4a3336999f83e72003f31449a842b70f2d21b6e7ce8f2d` 完全一致。
- I 必须与 `/private/tmp/pier-logo-preview/i-micro-clean-screen.svg` 的 SHA-256 `8e3387d34d9eef1861d3e1768798ca09be1d07c087aed2ea2426afe95eb17ae3` 完全一致。
- macOS 16、32、64、128px 使用 I；256、512、1024px 使用 F，包含 Retina 条目。
- `build/icon.png` 使用 I；Windows ICO、Linux PNG 与公开 SVG 母版使用透明 F。
- SVG 禁止嵌入位图、文本、base64、data URI 或外部资源。
- 不修改产品 UI、功能、启动流程、品牌文案或系统遮罩规则。
- 保留当前工作区的相关图标改动；提交不得夹带无关文件。

## File Structure

- `build/app-icon-master.svg`：F 标准 macOS 源。
- `build/app-icon-micro.svg`：I Micro macOS 源。
- `build/design-sources/pier-logo.svg`：透明 210×170 F 母版。
- `build/app-icon-unplated.svg`：透明 1024×1024 F 平台模板。
- `scripts/app-icon-icns.mjs`：无文件系统副作用的 ICNS 解析、校验、编码和合并。
- `scripts/build-app-icons.mjs`：调用官方工具并写出平台资产。
- `tests/unit/scripts/app-icon-assets.test.ts`：设计源、脚本和平台引用治理。
- `tests/unit/scripts/app-icon-icns.test.ts`：ICNS 二进制和尺寸分配测试。
- `build/icon.icns`、`build/icon.ico`、`build/icon.png`、`build/icons/*.png`：生成资产。
- `.gitignore`、`electron-builder.yml`、`docs/development.md`、`build/design-sources/index.html`：项目集成与说明。

## 2026-08-18 system-decoder correction (authoritative)

macOS 26 的 `iconutil` 会把 electron-builder 产出的 `icp4` / `icp5` / `icp6` PNG 条目错误解码成彩色噪点；因此最终 ICNS 不得包含这三个非 Retina PNG 条目。最终容器必须使用：

- I Micro：`is32` + `s8mk`（16px）、`il32` + `l8mk`（32px），以及 `ic11`（32px Retina）、`ic12`（64px Retina）、`ic07`（128px）。legacy 条目由 `rsvg-convert` + macOS `sips` 生成。
- F Standard：`ic08`（256px）、`ic09`（512px）、`ic10`（1024px）；`ic13` 是 256px Retina 槽并复用 `ic08` 数据，`ic14` 是 512px Retina 槽并复用 `ic09` 数据。
- PNG 校验必须覆盖 CRC、IEND、zlib、非交错 8-bit RGBA、完整 scanline 长度和每行 filter 值，不能只检查签名与 IHDR。
- 生成必须先写 staging，再一次性发布；测试必须注入离线 converter，禁止触发工具下载或网络访问。
- macOS CI 必须用系统 `iconutil` 解包最终 ICNS，核对官方 10 个文件名和逐像素内容，防止容器兼容性回归。

下方早期 red-phase 代码片段只记录 TDD 推进方式；若与本节冲突，以本节和仓库中的最终实现为准。

---

### Task 1: Lock approved vector sources

**Files:**
- Modify: `build/app-icon-master.svg`
- Create: `build/app-icon-micro.svg`
- Modify: `build/design-sources/pier-logo.svg`
- Modify: `build/app-icon-unplated.svg`
- Modify: `.gitignore`
- Create: `tests/unit/scripts/app-icon-assets.test.ts`

**Interfaces:**
- Consumes: 批准的 F/I 文件与固定哈希。
- Produces: 后续生成脚本唯一可读取的四个矢量源。

- [ ] **Step 1: Write the failing source-governance test**

```ts
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

describe("Pier application icon sources", () => {
  it("locks approved F and I byte-for-byte", () => {
    expect(sha256(read("build/app-icon-master.svg"))).toBe(
      "ed1f59e2d4f95f62ed4a3336999f83e72003f31449a842b70f2d21b6e7ce8f2d"
    );
    expect(sha256(read("build/app-icon-micro.svg"))).toBe(
      "8e3387d34d9eef1861d3e1768798ca09be1d07c087aed2ea2426afe95eb17ae3"
    );
  });

  it("keeps I optical corrections and transparent F exports", () => {
    const micro = read("build/app-icon-micro.svg");
    const mark = read("build/design-sources/pier-logo.svg");
    const unplated = read("build/app-icon-unplated.svg");
    expect(micro).toMatch(/id="screen-left-top-glow"[^>]*opacity="0"/);
    expect(micro).toMatch(/id="terminal-material-effects"[^>]*opacity="0"/);
    expect(micro).toContain('stroke-width="6.6"');
    expect(micro).toContain('stroke-width="7"');
    expect(micro).toContain("2.4 19-17.6 35-40 35");
    expect(mark).toContain('viewBox="0 0 210 170"');
    expect(mark).toContain(
      'id="berth-layer" transform="translate(104.5 145) scale(0.9) translate(-104.5 -145)"'
    );
    expect(mark).not.toContain("app-plate-fill");
    expect(unplated).not.toContain("app-plate-fill");
  });

  it("contains vectors only", () => {
    for (const path of [
      "build/app-icon-master.svg",
      "build/app-icon-micro.svg",
      "build/design-sources/pier-logo.svg",
      "build/app-icon-unplated.svg",
    ]) {
      const source = read(path);
      expect(source).not.toMatch(/<image(?:\s|>)/i);
      expect(source).not.toMatch(/<text(?:\s|>)/i);
      expect(source).not.toMatch(/(?:base64|data:|\shref=)/i);
    }
  });
});
```

- [ ] **Step 2: Run the test and observe the expected failure**

Run: `pnpm exec vitest run tests/unit/scripts/app-icon-assets.test.ts`

Expected: FAIL because `build/app-icon-micro.svg` is absent and F differs.

- [ ] **Step 3: Install exact F/I and derive transparent F**

Verify first:

```bash
shasum -a 256 \
  /private/tmp/pier-logo-preview/f-decoupled-terminal.svg \
  /private/tmp/pier-logo-preview/i-micro-clean-screen.svg
```

Use `apply_patch` to replace `build/app-icon-master.svg` byte-for-byte with F and create `build/app-icon-micro.svg` byte-for-byte from I. For `build/design-sources/pier-logo.svg`, use the root `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 170" width="210" height="170" role="img" aria-label="Pier docked terminal mark">`, then transplant the complete contents of F's `pier-logo-mark` group without changing its nested `defs`, `berth-layer`, or `terminal-layer`. For `build/app-icon-unplated.svg`, transplant that same complete subtree inside `<g id="pier-logo-mark" transform="translate(32 123.4285714286) scale(4.5714285714)">`. Both transparent sources exclude all siblings before F's `pier-logo-mark` group, which removes the macOS plate deterministically.

Add `!/build/app-icon-micro.svg` to `.gitignore`.

- [ ] **Step 4: Verify and commit the vectors**

Run: `pnpm exec vitest run tests/unit/scripts/app-icon-assets.test.ts`

Expected: PASS, 3 tests.

```bash
git add .gitignore build/app-icon-master.svg build/app-icon-micro.svg \
  build/app-icon-unplated.svg build/design-sources/pier-logo.svg \
  tests/unit/scripts/app-icon-assets.test.ts
git commit -m "feat: add Pier icon size renditions"
```

---

### Task 2: Add a validated ICNS rendition merger

**Files:**
- Create: `scripts/app-icon-icns.mjs`
- Create: `tests/unit/scripts/app-icon-icns.test.ts`

**Interfaces:**
- Consumes: F/I 两个 modern ICNS `Buffer`，以及 16/32px 两个 `sips` legacy ICNS `Buffer`。
- Produces: `parseIcns`, `encodeIcns`, `mergeIcnsRenditions`, `ICNS_DIMENSIONS`, `MICRO_ICNS_TYPES`, `STANDARD_ICNS_TYPES`.

- [ ] **Step 1: Write the failing ICNS tests**

Use complete PNG fixtures built from valid `IHDR` / `IDAT` / `IEND` chunks with real CRC32 values and zlib-compressed RGBA scanlines. The test suite must cover:

- I selection for the official legacy 16/32px pairs plus `ic11`, `ic12`, and `ic07`.
- F selection for `ic08`, `ic09`, and `ic10`, with `ic13` sourced from `ic08` and `ic14` sourced from `ic09`.
- malformed ICNS headers and lengths, duplicate entries, missing entries, wrong dimensions, corrupt CRC/IEND/zlib data, invalid RGBA metadata, invalid scanline length/filter, and invalid legacy masks.

Do not use signature-only pseudo-PNGs: they would bypass the same corruption class this validator is intended to prevent.

- [ ] **Step 2: Run the test and observe the expected failure**

Run: `pnpm exec vitest run tests/unit/scripts/app-icon-icns.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the pure module**

Use these exact maps and signatures:

```js
export const ICNS_DIMENSIONS = Object.freeze({
  ic07: 128,
  ic08: 256,
  ic09: 512,
  ic10: 1024,
  ic11: 32,
  ic12: 64,
  ic13: 256,
  ic14: 512,
});

export const MICRO_ICNS_TYPES = Object.freeze([
  "ic07", "ic11", "ic12",
]);

export const STANDARD_ICNS_TYPES = Object.freeze([
  "ic08", "ic09", "ic10", "ic13", "ic14",
]);

export function parseIcns(buffer) {
  // Validate ICNS signature and total length; validate modern PNG entries
  // completely and validate official legacy RGB/alpha entry pairs.
  // Return [{ type, data }] in file order.
}

export function encodeIcns(entries) {
  // Reject duplicate/non-four-byte types, encode uint32 BE lengths,
  // and prefix the ICNS signature plus total length.
}

export function mergeIcnsRenditions(
  standardBuffer,
  microBuffer,
  legacy16Buffer,
  legacy32Buffer
) {
  // Require official legacy pairs and all modern types, verify dimensions,
  // choose Micro/Standard sources, and encode in deterministic order.
}
```

All errors must name the failing type and expected dimension.

- [ ] **Step 4: Verify and commit the module**

Run: `pnpm exec vitest run tests/unit/scripts/app-icon-icns.test.ts`

Expected: all ICNS merger and validator tests PASS.

```bash
git add scripts/app-icon-icns.mjs tests/unit/scripts/app-icon-icns.test.ts
git commit -m "feat: merge macOS icon renditions"
```

---

### Task 3: Wire and generate all platform assets

**Files:**
- Modify: `scripts/build-app-icons.mjs`
- Modify: `tests/unit/scripts/app-icon-assets.test.ts`
- Modify: `build/icon.icns`
- Modify: `build/icon.ico`
- Modify: `build/icon.png`
- Create/Modify: `build/icons/*.png`

**Interfaces:**
- Consumes: Task 1 SVGs and Task 2 merger.
- Produces: final deterministic macOS, Windows, Linux, and development assets.

- [ ] **Step 1: Add failing pipeline behavior tests**

Test generated asset behavior rather than implementation strings: assert the final modern ICNS entry hashes, system `iconutil` round-trip pixels and official filename set, approved development Dock hash, complete transparent ICO/Linux sizes, package/runtime references, transactional rollback, dependency preflight, and injected offline conversion.

Run: `pnpm exec vitest run tests/unit/scripts/app-icon-assets.test.ts`

Expected: FAIL because the current pipeline has no Micro input.

- [ ] **Step 2: Implement dual official-tool ICNS generation**

Add `SRC_MICRO`, import `readFileSync`/`writeFileSync` and `mergeIcnsRenditions`. Replace the one-source ICNS path with:

```js
async function convertToBuffer(source, format, workingDirectory, temporaryName, convertIcons) {
  const outputDirectory = join(workingDirectory, ".icon-tool-" + temporaryName);
  rmSync(outputDirectory, { recursive: true, force: true });
  mkdirSync(outputDirectory, { recursive: true });
  try {
    await convertIcons({
      inputFile: source,
      outputFormat: format,
      outDir: outputDirectory,
    });
    return readFileSync(join(outputDirectory, "icon." + format));
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true });
  }
}

async function buildIcns(stagingDirectory) {
  const standard = await convertToBuffer(SRC_MASTER, "icns", stagingDirectory, "icns-standard");
  const micro = await convertToBuffer(SRC_MICRO, "icns", stagingDirectory, "icns-micro");
  const { legacy16, legacy32 } = await encodeLegacyIconsWithSips({
    source: SRC_MICRO,
    stagingDirectory,
  });
  writeFileSync(
    join(stagingDirectory, "icon.icns"),
    mergeIcnsRenditions(standard, micro, legacy16, legacy32)
  );
}

function buildDevDockPng(stagingDirectory) {
  rasterize(SRC_MICRO, 512, join(stagingDirectory, "icon.png"));
}
```

Keep ICO and Linux generation on `SRC_UNPLATED` and retain the 96px Linux slot. Generate every target under one staging directory, then publish the complete set transactionally; inject the converter and legacy encoder in tests so this path is offline and deterministic.

- [ ] **Step 3: Verify tests, generation, cleanup, and determinism**

```bash
pnpm exec vitest run \
  tests/unit/scripts/app-icon-assets.test.ts \
  tests/unit/scripts/app-icon-icns.test.ts \
  tests/unit/scripts/app-icon-build.test.ts
pnpm build:icons
find build -maxdepth 1 -name '.icon-tool-*' -print
shasum -a 256 build/icon.icns build/icon.ico build/icon.png build/icons/*.png
pnpm build:icons
shasum -a 256 build/icon.icns build/icon.ico build/icon.png build/icons/*.png
```

Expected: tests PASS; `find` prints nothing; both hash lists match exactly.

- [ ] **Step 4: Commit pipeline and generated assets**

```bash
git add scripts/build-app-icons.mjs tests/unit/scripts/app-icon-assets.test.ts \
  build/icon.icns build/icon.ico build/icon.png build/icons
git commit -m "build: generate Pier platform icons"
```

---

### Task 4: Finish project integration and independent review

**Files:**
- Modify: `docs/development.md`
- Modify: `build/design-sources/index.html`
- Modify if current mapping is absent: `electron-builder.yml`
- Verify: `src/main/index.ts`
- Verify: `src/main/windows/factory.ts`
- Modify: `tests/unit/scripts/app-icon-assets.test.ts`

**Interfaces:**
- Consumes: Generated assets.
- Produces: documented ownership, correct runtime/package references, contact sheet, and zero-finding reviews.

- [ ] **Step 1: Add failing documentation and packaging assertions**

```ts
it("documents and packages every rendition", () => {
  const docs = read("docs/development.md");
  const builder = read("electron-builder.yml");
  const archive = read("build/design-sources/index.html");
  expect(docs).toContain("app-icon-micro.svg");
  expect(docs).toContain("16–128px");
  expect(docs).toContain("256–1024px");
  expect(builder).toContain("icon: build/icon.icns");
  expect(builder).toContain("icon: build/icon.ico");
  expect(builder).toContain("icon: build/icons");
  expect(archive).not.toContain("build/app-icon.svg</code> 占位图");
});
```

Run: `pnpm exec vitest run tests/unit/scripts/app-icon-assets.test.ts`

Expected: FAIL on the missing F/I documentation and obsolete archive copy.

- [ ] **Step 2: Update docs and confirm all references**

Add these exact responsibilities to `docs/development.md`:

```markdown
- `build/app-icon-master.svg`：F 标准稿，macOS 256–1024px。
- `build/app-icon-micro.svg`：I Micro 稿，macOS 16–128px 与开发环境 Dock。
- `build/app-icon-unplated.svg`：透明 F，Windows 与 Linux。
- `pnpm build:icons`：唯一正式生成入口；生成文件不得手改。
```

Replace the obsolete icon-selection sentence in `build/design-sources/index.html` with `pier-logo.svg 是当前选定的透明 F 母版`. Confirm `electron-builder.yml` maps macOS to `build/icon.icns`, Windows to `build/icon.ico`, and Linux to `build/icons`. Confirm both development runtime references remain `build/icon.png`.

- [ ] **Step 3: Run focused and project checks**

```bash
pnpm exec vitest run \
  tests/unit/scripts/app-icon-assets.test.ts \
  tests/unit/scripts/app-icon-icns.test.ts \
  tests/unit/scripts/app-icon-build.test.ts
pnpm lint
pnpm build:icons
git diff --check
```

Expected: every command exits 0; soft file-size warnings may remain informational.

- [ ] **Step 4: Build and inspect a final size contact sheet**

Render/extract 16, 32, 64, 128, 256, 512, and 1024px into `/private/tmp/pier-icon-final-review/` on light and dark backgrounds. Verify 16–128px has I's clean screen, thinner harbor base, stronger glyph, and removed collapsing shadows; verify 256–1024px retains F's full material detail and standard harbor. Verify terminal/harbor spacing, transparent Windows/Linux bounds, and:

```bash
shasum -a 256 build/icon.png
```

Expected: `26742aaa53f47aa8dbc8a33c7e77caba6220a5895cfd39ff8913267fe634ef32`.

- [ ] **Step 5: Run the required subagent review/fix loop**

Send one reviewer the approved spec, hashes, contact sheet, ICNS map, and relevant diff. Send a second reviewer the generator, ICNS tests, asset metadata, and package/runtime references. Require Critical/Important/Minor counts. For every finding, patch it, rerun Steps 3–4, and resubmit both reviews. Stop only when both report Critical 0, Important 0, Minor 0.

- [ ] **Step 6: Commit docs and final verification**

```bash
git add docs/development.md build/design-sources/index.html \
  electron-builder.yml tests/unit/scripts/app-icon-assets.test.ts
git commit -m "docs: document Pier icon rendition pipeline"
git status --short
git log --oneline -5
git diff HEAD^ --check
```

Expected: no uncommitted plan files, all planned commits present, and both independent reviews at zero findings.
