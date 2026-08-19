# Pierre Logo Theme Tokens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task by task, and `superpowers:test-driven-development` for every behavior change.

**Goal:** Make the built-in `Pierre` and `Pierre Soft` presets derive their brand-facing theme tokens from the approved Pier logo purple palette, while preserving each preset's neutral surfaces and removing the obsolete A/B/C logo archive.

**Architecture:** Add one pure, immutable brand overlay at the theme-source boundary. Apply it only to the four built-in Pierre theme registrations before existing UI-token, terminal, chart, Shiki, and diff consumers read them. Keep all concrete brand colors inside `src/renderer/lib/theme/`, and keep the design archive as a static viewer that references the approved F/I SVG sources instead of embedding competing icon geometry.

**Tech Stack:** TypeScript 6 strict, Vitest 4, Shiki/VS Code theme objects, existing OKLCH helpers, static HTML/CSS, pnpm, Biome/Ultracite.

**Spec:** `docs/superpowers/specs/2026-08-18-pierre-logo-theme-tokens-design.md`

## Global constraints

- Do not edit `node_modules/@pierre/theme` or mutate imported theme objects.
- Do not change third-party presets, status colors, theme names, or preference flows.
- Brand literals belong only in `src/renderer/lib/theme/pierre-brand-overlay.ts`; consumers continue to use semantic theme tokens.
- `Pierre` and `Pierre Soft` must share the same brand values in light and dark mode while retaining their original neutral surfaces.
- Use the approved logo assets as the only icon geometry: F for standard/transparent large sizes, I for 16–128 px.
- Every implementation task starts with a failing test and ends with focused green tests plus an intentional commit.

---

## Task 1: Build the pure Pierre brand overlay

**Files:**

- Create: `src/renderer/lib/theme/pierre-brand-overlay.ts`
- Create: `tests/unit/renderer/lib/theme/pierre-brand-overlay.test.ts`

### Step 1: Write failing contract tests

Create `tests/unit/renderer/lib/theme/pierre-brand-overlay.test.ts` with a small representative source theme. Assert:

1. The three exported palette values are exactly `#b66cff`, `#8549ff`, and `#542ee5`.
2. Dark and light mappings set every specified VS Code color key.
3. Light/dark text accents use `primary`/`highlight` respectively.
4. `meta.decorator`, `entity.name.function.decorator`, `punctuation.definition.decorator`, and `semanticTokenColors.decorator` receive the mode-aware accent.
5. Non-decorator TextMate rules remain byte-for-byte/equality equivalent.
6. The input object, `colors`, `tokenColors`, `semanticTokenColors`, and nested token settings are not mutated.
7. `name`, `type`, backgrounds, foregrounds, and unrelated color entries survive unchanged.

Use a fixture shaped like:

```ts
const source = {
  name: "fixture",
  type: "dark",
  colors: {
    "editor.background": "#101010",
    "editor.foreground": "#f5f5f5",
    "button.background": "#009fff",
    "statusBar.background": "#181818",
  },
  tokenColors: [
    {
      scope: ["meta.decorator", "entity.name.function.decorator"],
      settings: { fontStyle: "italic", foreground: "#69b1ff" },
    },
    { scope: "keyword", settings: { foreground: "#ff0000" } },
  ],
  semanticTokenColors: {
    decorator: "#69b1ff",
    function: "#00ff00",
  },
} as const;
```

Run:

```bash
pnpm exec vitest run tests/unit/renderer/lib/theme/pierre-brand-overlay.test.ts
```

Expected: FAIL because the overlay module does not exist.

### Step 2: Implement the immutable overlay

Create `src/renderer/lib/theme/pierre-brand-overlay.ts` with:

```ts
import { mix, normalizeHex } from "./oklch.ts";

export const PIER_BRAND_PALETTE = {
  highlight: "#b66cff",
  primary: "#8549ff",
  deep: "#542ee5",
} as const;

export interface ThemeTokenColor {
  readonly name?: string;
  readonly scope?: string | readonly string[];
  readonly settings?: Readonly<Record<string, string>>;
}

export interface PierBrandThemeLike {
  readonly colors?: Readonly<Record<string, string>>;
  readonly name?: string;
  readonly semanticTokenColors?: Readonly<Record<string, unknown>>;
  readonly tokenColors?: readonly ThemeTokenColor[];
  readonly type?: string;
}

const DECORATOR_SCOPES = new Set([
  "meta.decorator",
  "entity.name.function.decorator",
  "punctuation.definition.decorator",
]);

function includesDecoratorScope(
  scope: string | readonly string[] | undefined
): boolean {
  const scopes = typeof scope === "string" ? [scope] : (scope ?? []);
  return scopes.some((value) => DECORATOR_SCOPES.has(value));
}

function mixedSurface(
  background: string,
  strength: number
): string {
  return mix(background, PIER_BRAND_PALETTE.primary, strength);
}

export function applyPierBrandOverlay<T extends PierBrandThemeLike>(
  source: T,
  mode: "light" | "dark"
): T {
  const originalColors = source.colors ?? {};
  const background =
    normalizeHex(originalColors["editor.background"]) ??
    (mode === "dark" ? "#0a0a0a" : "#ffffff");
  const textAccent =
    mode === "dark"
      ? PIER_BRAND_PALETTE.highlight
      : PIER_BRAND_PALETTE.primary;
  const selectionStrength = mode === "dark" ? 0.24 : 0.12;
  const activeSelectionStrength = mode === "dark" ? 0.32 : 0.18;
  const inactiveSelectionStrength = mode === "dark" ? 0.18 : 0.1;

  const colors = {
    ...originalColors,
    "activityBar.activeBorder": PIER_BRAND_PALETTE.primary,
    "activityBarBadge.background": PIER_BRAND_PALETTE.primary,
    "activityBarBadge.foreground": "#ffffff",
    "button.background": PIER_BRAND_PALETTE.primary,
    "button.foreground": "#ffffff",
    "button.hoverBackground": PIER_BRAND_PALETTE.deep,
    "charts.blue": PIER_BRAND_PALETTE.primary,
    "editor.selectionBackground":
      mode === "dark" ? "#8549ff4d" : "#8549ff2e",
    "editorCursor.foreground": PIER_BRAND_PALETTE.highlight,
    focusBorder: PIER_BRAND_PALETTE.highlight,
    "gitDecoration.modifiedResourceForeground": textAccent,
    "list.activeSelectionBackground": mixedSurface(
      background,
      activeSelectionStrength
    ),
    "list.focusOutline": PIER_BRAND_PALETTE.highlight,
    "list.inactiveSelectionBackground": mixedSurface(
      background,
      inactiveSelectionStrength
    ),
    "notificationLink.foreground": textAccent,
    "panelTitle.activeBorder": PIER_BRAND_PALETTE.primary,
    "selection.background": mixedSurface(background, selectionStrength),
    "tab.activeBorderTop": PIER_BRAND_PALETTE.primary,
    "terminal.ansiBlue": PIER_BRAND_PALETTE.primary,
    "terminal.ansiBrightBlue": PIER_BRAND_PALETTE.highlight,
    "textLink.activeForeground": textAccent,
    "textLink.foreground": textAccent,
  };

  const tokenColors = source.tokenColors?.map((rule) =>
    includesDecoratorScope(rule.scope)
      ? {
          ...rule,
          settings: { ...rule.settings, foreground: textAccent },
        }
      : rule
  );
  const semanticTokenColors = {
    ...source.semanticTokenColors,
    decorator: textAccent,
  };

  return {
    ...source,
    colors,
    semanticTokenColors,
    ...(tokenColors ? { tokenColors } : {}),
  } as T;
}
```

Before committing, confirm the existing `mix` signature in `oklch.ts`; if its argument order differs, adapt only the call sites while preserving the specified strengths and expected tests.

### Step 3: Run and tighten the tests

Run:

```bash
pnpm exec vitest run tests/unit/renderer/lib/theme/pierre-brand-overlay.test.ts
```

Expected: PASS. Also verify the returned root, `colors`, modified decorator rule, modified settings, and `semanticTokenColors` are new objects, while the unrelated `keyword` rule may retain reference identity.

### Step 4: Commit

```bash
git add src/renderer/lib/theme/pierre-brand-overlay.ts tests/unit/renderer/lib/theme/pierre-brand-overlay.test.ts
git commit -m "feat(theme): add Pier brand overlay"
```

---

## Task 2: Wire the overlay into Pierre and prove every downstream consumer

**Files:**

- Modify: `src/renderer/lib/theme/preset-registry.ts`
- Modify: `tests/unit/renderer/lib/theme/pierre-brand-overlay.test.ts`
- Modify: `tests/unit/renderer/lib/theme/derive-tokens.test.ts`
- Modify: `tests/unit/renderer/lib/theme/derive-terminal-colors.test.ts`

### Step 1: Add failing registry and integration tests

Extend the overlay tests to loop over:

```ts
const PIERRE_CASES = [
  ["pierre", "light"],
  ["pierre", "dark"],
  ["pierre-soft", "light"],
  ["pierre-soft", "dark"],
] as const;
```

For each case, assert `getShikiTheme()` returns:

- `button.background === "#8549ff"`
- `button.hoverBackground === "#542ee5"`
- `focusBorder === "#b66cff"`
- `terminal.ansiBlue === "#8549ff"`
- `terminal.ansiBrightBlue === "#b66cff"`
- `charts.blue === "#8549ff"`
- original `editor.background`, `editor.foreground`, and theme `name` preserved.

Snapshot or capture `getShikiTheme("github", mode)` before/after the new registration path and assert it is unchanged, proving the overlay is Pierre-only.

In `derive-tokens.test.ts`, add one test over all four cases:

```ts
const tokens = deriveAppStyleTokens(getShikiTheme(preset, mode), mode);
expect(tokens.primary).toBe("#8549ff");
expect(tokens["primary-foreground"]).toBe("#ffffff");
expect(tokens["chart-1"]).toBe("#8549ff");
expect(contrast(tokens.primary, tokens["primary-foreground"]))
  .toBeGreaterThanOrEqual(4);
expect(contrast(tokens.background, tokens.primary))
  .toBeGreaterThanOrEqual(3);
```

In `derive-terminal-colors.test.ts`, stop importing raw `pierreDark`; import `getShikiTheme` and assert for all four cases:

```ts
const terminal = deriveTerminalColors(getShikiTheme(preset, mode), mode);
expect(terminal.palette[4]).toBe("#8549ff");
expect(terminal.palette[12]).toBe("#b66cff");
```

Run:

```bash
pnpm exec vitest run tests/unit/renderer/lib/theme/pierre-brand-overlay.test.ts tests/unit/renderer/lib/theme/derive-tokens.test.ts tests/unit/renderer/lib/theme/derive-terminal-colors.test.ts
```

Expected: FAIL because the registry still exposes the original blue themes.

### Step 2: Apply the overlay only at the registry boundary

Modify `src/renderer/lib/theme/preset-registry.ts`:

```ts
import {
  applyPierBrandOverlay,
  type PierBrandThemeLike,
} from "./pierre-brand-overlay.ts";
```

Extend `ShikiThemeLike` structurally so Shiki consumers keep the semantic token data:

```ts
export interface ShikiThemeLike extends PierBrandThemeLike {
  colors?: Record<string, string>;
  name?: string;
  semanticTokenColors?: Record<string, unknown>;
  tokenColors?: readonly ThemeTokenColor[];
  type?: "light" | "dark" | string;
}
```

Import `ThemeTokenColor` from the overlay module if the compiler requires the explicit token-color member; otherwise let the inherited member satisfy it.

Replace only the first two registrations:

```ts
pierre: {
  light: applyPierBrandOverlay(pierreLight, "light"),
  dark: applyPierBrandOverlay(pierreDark, "dark"),
},
"pierre-soft": {
  light: applyPierBrandOverlay(pierreLightSoft, "light"),
  dark: applyPierBrandOverlay(pierreDarkSoft, "dark"),
},
```

Do not touch any other entry.

### Step 3: Run focused and cleanliness tests

```bash
pnpm exec vitest run tests/unit/renderer/lib/theme/pierre-brand-overlay.test.ts tests/unit/renderer/lib/theme/derive-tokens.test.ts tests/unit/renderer/lib/theme/derive-terminal-colors.test.ts tests/unit/renderer/lib/theme/primary-cleanliness.test.ts tests/unit/renderer/stores/theme-store-native-chrome.test.ts
```

Expected: PASS. If a light-mode derived primary is adjusted away from `#8549ff`, fix the source/contrast path rather than weakening the contrast assertions.

### Step 4: Type and lint the touched theme code

```bash
pnpm exec biome check src/renderer/lib/theme/pierre-brand-overlay.ts src/renderer/lib/theme/preset-registry.ts tests/unit/renderer/lib/theme/pierre-brand-overlay.test.ts tests/unit/renderer/lib/theme/derive-tokens.test.ts tests/unit/renderer/lib/theme/derive-terminal-colors.test.ts
pnpm typecheck
```

Expected: PASS.

### Step 5: Commit

```bash
git add src/renderer/lib/theme/pierre-brand-overlay.ts src/renderer/lib/theme/preset-registry.ts tests/unit/renderer/lib/theme/pierre-brand-overlay.test.ts tests/unit/renderer/lib/theme/derive-tokens.test.ts tests/unit/renderer/lib/theme/derive-terminal-colors.test.ts
git commit -m "feat(theme): align Pierre presets with logo purple"
```

---

## Task 3: Remove obsolete logo candidates and rebuild the design archive

**Files:**

- Modify: `tests/unit/scripts/app-icon-assets.test.ts`
- Replace: `build/design-sources/index.html`
- Delete: `build/design-sources/pier-pier.svg`
- Delete: `build/design-sources/pier-panels.svg`
- Delete: `build/design-sources/pier-berth.svg`
- Delete: `build/design-sources/pier-berth-macos.svg`
- Keep unchanged: `build/design-sources/pier-logo.svg`
- Keep unchanged: `build/app-icon-master.svg`
- Keep unchanged: `build/app-icon-micro.svg`

### Step 1: Add a failing archive-governance test

Update the `node:fs` import in `app-icon-assets.test.ts` to include `existsSync`, then add:

```ts
it("keeps the design archive on the approved F and I system only", () => {
  const archive = read("build/design-sources/index.html");

  for (const obsolete of [
    "build/design-sources/pier-pier.svg",
    "build/design-sources/pier-panels.svg",
    "build/design-sources/pier-berth.svg",
    "build/design-sources/pier-berth-macos.svg",
  ]) {
    expect(existsSync(join(ROOT, obsolete))).toBe(false);
  }

  expect(archive).toContain("../app-icon-master.svg");
  expect(archive).toContain("../app-icon-micro.svg");
  expect(archive).toContain("./pier-logo.svg");
  expect(archive).toContain("#b66cff");
  expect(archive).toContain("#8549ff");
  expect(archive).toContain("#542ee5");
  expect(archive).not.toMatch(/三个停靠的方向|Direction [ABC]|ico-[abc]/i);
  expect(archive).not.toMatch(
    /pier-pier\.svg|pier-panels\.svg|pier-berth(?:-macos)?\.svg/
  );
});
```

Run:

```bash
pnpm exec vitest run tests/unit/scripts/app-icon-assets.test.ts
```

Expected: FAIL because the obsolete files and A/B/C inline archive still exist.

### Step 2: Delete the four obsolete candidates

Delete only the four files named above. Do not delete `pier-logo.svg`, since it is the approved transparent F source and is covered by existing asset hashes/geometry tests.

### Step 3: Replace the archive with a source-linked F/I viewer

Replace `build/design-sources/index.html` with one self-contained static page whose markup contains no inline icon `<symbol>`, `<path>`, or second geometry source.

Required document structure:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Pier — Approved Logo System</title>
    <style>
      /* Local archive presentation only. Use the approved three logo colors,
         neutral dark/light surfaces, responsive cards, and native system fonts. */
    </style>
  </head>
  <body>
    <main>
      <header>
        <p class="eyebrow">Pier · Approved Logo System</p>
        <h1>F / I 双版本图标系统</h1>
        <p>F 承担标准与大尺寸展示；I 承担 16–128 px 的小尺寸识别。</p>
      </header>

      <section aria-labelledby="approved-renditions">
        <h2 id="approved-renditions">当前批准稿</h2>
        <article>
          <img src="../app-icon-master.svg" alt="Pier F 标准版图标" />
          <h3>F · Standard</h3>
          <p>macOS Dock 与 256–1024 px 标准输出。</p>
        </article>
        <article>
          <img src="../app-icon-micro.svg" alt="Pier I 小尺寸版图标" />
          <h3>I · Micro</h3>
          <p>16–128 px，减少细节与光效，保持终端和港湾轮廓。</p>
        </article>
        <article class="transparent-preview">
          <img src="./pier-logo.svg" alt="Pier F 透明背景标志" />
          <h3>F · Transparent</h3>
          <p>文档、品牌展示与无系统底板场景。</p>
        </article>
      </section>

      <section aria-labelledby="size-map">
        <h2 id="size-map">尺寸映射</h2>
        <div aria-label="I 版 16 到 128 像素预览">
          <img src="../app-icon-micro.svg" width="16" height="16" alt="I 版 16px" />
          <img src="../app-icon-micro.svg" width="32" height="32" alt="I 版 32px" />
          <img src="../app-icon-micro.svg" width="64" height="64" alt="I 版 64px" />
          <img src="../app-icon-micro.svg" width="128" height="128" alt="I 版 128px" />
        </div>
        <div aria-label="F 版 256 到 1024 像素范围">
          <img src="../app-icon-master.svg" width="160" height="160" alt="F 版 256px 以上" />
          <p>256 / 512 / 1024 px</p>
        </div>
      </section>

      <section aria-labelledby="brand-palette">
        <h2 id="brand-palette">品牌色</h2>
        <ul>
          <li><span style="--swatch: #b66cff"></span><code>#b66cff</code> Highlight</li>
          <li><span style="--swatch: #8549ff"></span><code>#8549ff</code> Primary</li>
          <li><span style="--swatch: #542ee5"></span><code>#542ee5</code> Deep</li>
        </ul>
      </section>

      <section aria-labelledby="theme-preview">
        <h2 id="theme-preview">主题输入示例</h2>
        <div class="theme-grid">
          <article data-theme="pierre-light"><h3>Pierre · Light</h3><button type="button">Primary</button></article>
          <article data-theme="pierre-dark"><h3>Pierre · Dark</h3><button type="button">Primary</button></article>
          <article data-theme="soft-light"><h3>Pierre Soft · Light</h3><button type="button">Primary</button></article>
          <article data-theme="soft-dark"><h3>Pierre Soft · Dark</h3><button type="button">Primary</button></article>
        </div>
      </section>
    </main>
  </body>
</html>
```

Implement the CSS fully rather than leaving the comment as a placeholder. The page must:

- use a restrained neutral background and one purple focus system;
- preserve transparent/checkerboard preview for `pier-logo.svg`;
- visibly distinguish Pierre from Pierre Soft via surface softness, not different brand colors;
- remain usable below 760 px;
- use `img` references exactly as tested;
- avoid interactivity that requires JavaScript.

### Step 4: Run archive and icon regression tests

```bash
pnpm exec vitest run tests/unit/scripts/app-icon-assets.test.ts tests/unit/scripts/app-icon-build.test.ts tests/unit/scripts/app-icon-icns.test.ts
```

Expected: PASS. The locked F/I hashes must remain unchanged.

### Step 5: Visually inspect the archive

Open `build/design-sources/index.html` in the in-app browser and verify:

- all three image sources load;
- F and I are labeled correctly;
- no old A/B/C candidate appears;
- 16, 32, 64, 128 px I previews remain recognizable;
- palette and four theme cards use the same approved purple values;
- mobile width does not overflow.

### Step 6: Commit

```bash
git add tests/unit/scripts/app-icon-assets.test.ts build/design-sources/index.html build/design-sources/pier-logo.svg
git add -u build/design-sources
git commit -m "chore(brand): retire obsolete logo candidates"
```

---

## Task 4: Final static, behavioral, and visual verification

**Files:**

- Verify all files changed by Tasks 1–3
- Do not make unrelated cleanup edits

### Step 1: Run the full focused verification set

```bash
pnpm exec vitest run tests/unit/renderer/lib/theme/pierre-brand-overlay.test.ts tests/unit/renderer/lib/theme/derive-tokens.test.ts tests/unit/renderer/lib/theme/derive-terminal-colors.test.ts tests/unit/renderer/lib/theme/primary-cleanliness.test.ts tests/unit/renderer/stores/theme-store-native-chrome.test.ts tests/unit/scripts/app-icon-assets.test.ts tests/unit/scripts/app-icon-build.test.ts tests/unit/scripts/app-icon-icns.test.ts
```

Expected: all tests PASS.

### Step 2: Run repository static gates

```bash
pnpm check:static
```

Expected: PASS. If the repository has pre-existing unrelated failures, record the exact command/output and prove touched-file checks pass independently.

### Step 3: Review the final diff against the spec

```bash
git diff --check
git diff --stat
git status --short
```

Review specifically that:

- raw brand colors appear only in the overlay module, tests, the design spec, and the static design archive;
- `globals.css` product status tokens did not change;
- no third-party preset registration changed;
- no icon master/micro hashes changed;
- all four obsolete candidate files are absent;
- the archive no longer embeds a competing icon implementation.

### Step 4: Capture visual evidence

Capture one desktop screenshot of the rebuilt design archive showing F, I, the palette, and the four Pierre theme cards. Keep it as verification evidence only unless the repository already has a documented screenshot location.

### Step 5: Final review checkpoint

Request a review focused on:

1. exact correspondence to the approved palette/mapping table;
2. immutability and Pierre-only scope;
3. derived UI/terminal/chart consistency;
4. absence of old design candidates;
5. design archive fidelity and source linking.

Fix any objective mismatch, rerun Steps 1–3, and only then report completion.
