# Pier Minimal Vector App Icon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the old rendered terminal icon with one exact SVG `>_ + berth` source and regenerate every shipped Pier app icon from it.

**Architecture:** `build/app-icon-source.svg` becomes the only authored artwork. The existing pinned electron-builder icon tool rasterizes it; the builder extracts the generated ICNS 1024 frame to a temporary PNG for the existing macOS 26 Icon Composer compilation path. PierDev continues to install the generated ICNS directly, so no runtime material layer changes its appearance.

**Tech Stack:** SVG 1.1 subset, Node.js ESM, electron-builder icons tool (resvg-wasm + vips), Xcode `actool`, macOS `sips`, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-28-minimal-vector-app-icon-design.md`

## Global Constraints

- The only authored application-icon source is `build/app-icon-source.svg` with `viewBox="0 0 1024 1024"`.
- The canonical chevron, underscore, and berth path data are copied verbatim from the spec.
- Shape, position, and scale never vary by output size.
- Prompt and berth use identical material-effect parameters; only their colors differ.
- No outer glow, glossy frame, extra Dock source, favicon, PWA asset, or alternate optical SVG is added.
- Existing platform output filenames remain unchanged.
- PierDev installs `build/icon.icns` directly and does not use `app.dock.setIcon`.
- `Assets.car.inputs` must prove the current SVG and the actual ICNS `ic10`
  pixels are fresh;
  stale inputs stop development startup instead of installing an old ICNS.
- PierDev and all Helpers are ICNS-only: no `Assets.car` and no
  `CFBundleIconName` remain in their bundles.

---

### Task 1: Lock the vector source contract

**Files:**
- Create: `build/app-icon-source.svg`
- Create: `tests/unit/scripts/app-icon-svg-source.test.ts`
- Delete: `tests/unit/scripts/app-icon-png-source.test.ts`
- Modify: `tests/unit/scripts/app-icon-container-governance.test.ts`

**Interfaces:**
- Produces: self-contained SVG bytes accepted by `runIconsTool({ inputFile, outputFormat, outDir })`.
- Produces: canonical element IDs `pier-body`, `pier-berth`, `pier-chevron`, and `pier-underscore` for structural verification only.

- [ ] **Step 1: Write the failing SVG behavior tests**

  Assert the source exists, parses as XML, has the exact viewBox and canonical
  paths, exact `rx=164`, exact artwork transform and matching clip, contains no
  external URL/font/image references, has one shared relief
  filter used by prompt and berth, and leaves the superseded optical SVG names
  absent.

- [ ] **Step 2: Run the focused tests and verify RED**

  Run `pnpm exec vitest run tests/unit/scripts/app-icon-svg-source.test.ts tests/unit/scripts/app-icon-container-governance.test.ts` and confirm failure because `build/app-icon-source.svg` is missing and PNG-first expectations remain.

- [ ] **Step 3: Add the minimal SVG source**

  Use the exact spec geometry, an 820×820 centered legacy container, shared
  user-space lighting, and restrained gradients without an exterior stroke.

- [ ] **Step 4: Re-run the focused tests and verify GREEN**

  Run the same command and confirm all source-contract tests pass.

### Task 2: Route every generated icon through SVG

**Files:**
- Modify: `scripts/build-app-icons.mjs`
- Modify: `scripts/app-icon-layered.mjs`
- Modify: `tests/unit/scripts/app-icon-build.test.ts`
- Modify: `tests/unit/scripts/app-icon-layered-document.test.ts`

**Interfaces:**
- Consumes: `build/app-icon-source.svg`.
- Produces: `extractLargestIconPng(icns: Buffer): Buffer` selecting the literal `ic10` 1024 frame.
- Produces: a temporary `app-icon-source.png` passed to `buildMacLayeredIcon` and removed with staging.
- Produces: `Assets.car.inputs` from SVG bytes, the actual extracted `ic10` PNG
  bytes, and the fixed renderer/compile contract, while the native PNG remains
  temporary.

- [ ] **Step 1: Change tests to require SVG input and an extracted temporary PNG**

  Use a hand-built ICNS fixture with a literal 1024 RGBA PNG payload; assert
  the builder passes the SVG to set/ico/icns conversions, passes the extracted
  PNG to the Icon Composer staging callback, publishes no source PNG, and
  removes stale PNG/icon-document outputs. Mutating the SVG while holding the
  temporary PNG constant must still change the native sidecar fingerprint.

- [ ] **Step 2: Run focused build tests and verify RED**

  Run `pnpm exec vitest run tests/unit/scripts/app-icon-build.test.ts tests/unit/scripts/app-icon-layered-document.test.ts` and confirm failures identify the PNG-only builder behavior.

- [ ] **Step 3: Implement the SVG builder path**

  Validate a self-contained 1024 SVG, call the pinned converter unchanged,
  parse the generated ICNS, write its 1024 frame only inside staging, and keep
  transactional publication behavior.

- [ ] **Step 4: Re-run focused build tests and verify GREEN**

  Run the same command and confirm all cases pass, including rollback.

### Task 3: Align PierDev, CI, documentation, and freshness contracts

**Files:**
- Modify: `scripts/dev-profile.mjs`
- Modify: `tests/unit/app/dev-profile-electron-icon.test.ts`
- Modify: `tests/unit/scripts/app-icon-assets.test.ts`
- Modify: `tests/unit/scripts/app-icon-small-output.test.ts`
- Modify: `.gitignore`
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/development.md`
- Modify: `electron-builder.yml`
- Modify: `AGENTS.md`
- Delete: `build/app-icon-source.png`

**Interfaces:**
- Consumes: `build/app-icon-source.svg`, `build/icon.icns`, and existing generated containers.
- Produces: `macDevBundleVersion(sourceVersion: string): string`, always three
  numeric components with the icon revision folded into the third.
- Produces: a freshness guard comparing
  `macIconFingerprint(sourceSvg, extractedIc10Png)` with `Assets.car.inputs`
  before any PierDev bundle mutation.
- Produces: PierDev icon cache hashes based on the installed ICNS and validated
  sidecar, not an unbuilt source mutation.

- [ ] **Step 1: Update tests first for the SVG source and ICNS-only PierDev contract**

  Assert PierDev copies ICNS, removes stale CAR from the main runtime and all
  Helpers, removes every `CFBundleIconName`, rejects a mismatched SVG sidecar
  before mutation, uses a valid three-component bundle version, and hashes the
  generated ICNS plus validated sidecar.

- [ ] **Step 2: Run focused governance tests and verify RED**

  Run `pnpm exec vitest run tests/unit/app/dev-profile-electron-icon.test.ts tests/unit/scripts/app-icon-assets.test.ts tests/unit/scripts/app-icon-small-output.test.ts tests/unit/scripts/app-icon-container-governance.test.ts`.

- [ ] **Step 3: Update contracts and prose**

  Change source names and comments without adding new renderer/favicon assets;
  keep release `CFBundleIconName=app-icon` and dev ICNS-only behavior distinct.

- [ ] **Step 4: Re-run focused governance tests and verify GREEN**

  Run the same command and confirm the conflicting CAR/ICNS dev expectations are resolved.

### Task 4: Regenerate and visually verify all platform assets

**Files:**
- Regenerate: `build/icon.icns`, `build/icon.ico`, `build/icon.png`, `build/icons/*.png`, `build/Assets.car`, `build/Assets.car.inputs`
- Update: `build/design-sources/index.html`

**Interfaces:**
- Consumes: the completed source and builder.
- Produces: byte-consistent platform assets and a review page that shows one
  real generated 512 px final icon. Smaller output checks remain internal.

- [ ] **Step 1: Run the icon build**

  Run `pnpm build:icons` and confirm all staged assets publish atomically.

- [ ] **Step 2: Run the complete icon test set**

  Run `pnpm exec vitest run tests/unit/scripts/app-icon-*.test.ts tests/unit/app/dev-profile-electron-icon.test.ts`.

- [ ] **Step 3: Render native-size comparison boards**

  Inspect 16/32/48/64/128/256 px outputs over black, Dock gray, and white;
  verify the geometry remains unchanged, prompt components remain separate,
  berth continuity remains intact, and no exterior halo appears. Do not expose
  these internal checks as visible design alternatives on the review page.

- [ ] **Step 4: Run repository verification**

  Run `pnpm typecheck:host`, `git diff --check`, and the relevant icon asset
  integrity scripts. Obtain an independent final visual and build-pipeline
  review; address every blocking finding before completion.
