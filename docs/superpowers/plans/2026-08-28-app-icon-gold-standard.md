# Pier App Icon Gold Standard Implementation Plan

> Superseded later on 2026-08-28 by the approved PNG-first single-source
> implementation. This plan remains as historical implementation context.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Pier's legacy app icon with the approved berthing-capsule visual system, preserve clarity at 16 px, and use one native macOS asset chain in development and production.

**Architecture:** Three canonical optical SVG renditions feed deterministic per-size raster outputs. macOS uses a validated Icon Composer `Assets.car` with a complete ICNS fallback; PierDev copies those canonical outputs and the runtime never overrides the Dock icon. Tests exercise decoded artifacts and final bundle behavior rather than source-text or compressed-byte change detectors.

**Tech Stack:** Node.js ESM build scripts, SVG/librsvg, ICNS/ICO/PNG, Xcode 26 `actool`/`assetutil`, Electron 43, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-08-28-app-icon-gold-standard-design.md`

## Global Constraints

- Preserve unrelated user changes in the dirty worktree.
- Use `logo.svg` for 256–1024 px, `logo-small.svg` for 64–128 px, and `logo-tiny.svg` for 16–48 px.
- Keep the approved complete composite on every platform; do not revive the legacy unplated F mark.
- macOS 26+ uses a semantic layered `.icon` document; older macOS uses ICNS fallback.
- Development and production consume the same ICNS and validated CAR.
- No runtime `app.dock.setIcon` call.
- Every behavior change follows a red-green-refactor cycle.
- Generated icon binaries are rebuilt by `pnpm build:icons`, never hand-edited.

---

### Task 1: Canonical optical source contract

**Files:**
- Create: `build/app-icon-small.svg`
- Create: `build/app-icon-tiny.svg`
- Modify: `build/app-icon-master.svg`
- Modify: `build/design-sources/pier-logo.svg`
- Modify: `build/design-sources/index.html`
- Modify: `.gitignore`
- Test: `tests/unit/scripts/app-icon-assets.test.ts`

**Interfaces:**
- Consumes: approved `logo.svg`, `logo-small.svg`, and `logo-tiny.svg` source files.
- Produces: canonical repository SVGs with stable semantic group identifiers and exact approved raster appearance.

- [ ] **Step 1: Write failing source and canonical-raster tests**

  Add tests that rasterize the three repository sources to their target sizes
  and compare decoded RGBA data with hand-approved PNG fixtures. Add semantic
  checks for the shell, bay, berth rim, and terminal prompt groups, allowing
  internal fragment references while rejecting external URLs and embedded
  raster images.

- [ ] **Step 2: Run the focused test and confirm RED**

  Run `CI=true pnpm exec vitest run tests/unit/scripts/app-icon-assets.test.ts`.
  Expected failure: missing small/tiny sources and repository rasters differing
  from the approved berthing-capsule fixtures.

- [ ] **Step 3: Install the approved sources**

  Copy the approved master/small/tiny SVG content into the canonical build
  files, replace the old cross-platform source with the complete approved
  composite, update the design-source preview, and track the new source files.

- [ ] **Step 4: Run the focused test and confirm GREEN**

  Run the same Vitest target and require zero failures.

### Task 2: Three-tier raster and container routing

**Files:**
- Modify: `scripts/build-app-icons.mjs`
- Modify: `scripts/app-icon-icns.mjs`
- Modify: `tests/unit/scripts/app-icon-build.test.ts`
- Modify: `tests/unit/scripts/app-icon-icns.test.ts`
- Modify: `tests/unit/scripts/app-icon-assets.test.ts`

**Interfaces:**
- Consumes: `master`, `small`, and `tiny` SVG paths.
- Produces: exact size routing for ICNS, ICO, Linux PNGs, and the generic window PNG.

- [ ] **Step 1: Write failing routing tests**

  Add literal table-driven assertions for ICNS slots and generated
  Windows/Linux sizes: 16/24/32/48 tiny, 64/96/128 small, and 256+ master.
  Add a regression assertion that same-sized ICNS slots decode identically.

- [ ] **Step 2: Run the routing tests and confirm RED**

  Run `CI=true pnpm exec vitest run tests/unit/scripts/app-icon-icns.test.ts tests/unit/scripts/app-icon-build.test.ts`.
  Expected failure: the current two-tier merger routes all <=128 frames through
  one micro source and cross-platform outputs through one unplated source.

- [ ] **Step 3: Implement three-tier routing**

  Extend the build source manifest, build independent tiny/small/master
  renditions, select ICNS frames by actual pixel size, and generate ICO/Linux
  frames from the matching optical source. Generate the generic 512 PNG from
  master. Remove `icon-dock.png` as a runtime/build contract.

- [ ] **Step 4: Run the focused tests and confirm GREEN**

  Require both routing suites to pass with identical decoded pixels in duplicate
  slots.

### Task 3: Native layered macOS document

**Files:**
- Create: `build/app-icon.icon/Assets/harbor.svg`
- Create: `build/app-icon.icon/Assets/berth-rim.svg`
- Create: `build/app-icon.icon/Assets/prompt.svg`
- Modify: `build/app-icon.icon/icon.json`
- Modify: `scripts/app-icon-layered.mjs`
- Modify: `tests/unit/scripts/app-icon-layered.test.ts`
- Modify: `tests/unit/scripts/app-icon-build.test.ts`

**Interfaces:**
- Consumes: a committed Icon Composer document with four semantic SVG layers.
- Produces: validated `Assets.car`, `Assets.car.inputs`, and the staged `.icon` document without mutating its assets during build.

- [ ] **Step 1: Write failing layered-document tests**

  Assert that the document exposes two named groups and three vector layers, the build never
  derives a foreground layer with string replacement, fingerprinting includes
  compiler schema inputs, and invalid/missing appearance stacks are rejected.

- [ ] **Step 2: Run the layered tests and confirm RED**

  Expected failure: current code strips exact legacy plate strings and overwrites
  one PNG foreground layer.

- [ ] **Step 3: Author and compile the semantic document**

  Split the approved master into `harbor` and `prompt` groups without changing the flattened
  appearance, update `icon.json`, remove `tahoeMarkSvg`, compile with `actool`,
  inspect with `assetutil`, and refresh the sidecar fingerprint.

- [ ] **Step 4: Run layered tests and confirm GREEN**

  Require the focused tests plus a real `assetutil --info` inspection to pass.

### Task 4: One canonical development and production macOS path

**Files:**
- Modify: `scripts/dev-profile.mjs`
- Modify: `src/main/index.ts`
- Modify: `tests/unit/app/dev-profile-electron-icon.test.ts`
- Modify: `tests/unit/scripts/app-icon-container-governance.test.ts`

**Interfaces:**
- Consumes: canonical `build/icon.icns`, `build/Assets.car`, and matching fingerprint.
- Produces: a branded PierDev.app whose plist and resources match production, with corrupt/stale layered assets rejected.

- [ ] **Step 1: Write failing bundle behavior tests**

  Assert that PierDev copies the canonical ICNS byte-for-byte, rejects missing or
  mismatched CAR sidecars, stamps the correct plist keys, and main-process startup
  performs no Dock override.

- [ ] **Step 2: Run the bundle tests and confirm RED**

  Expected failure: current code rebuilds an invalid iconset, accepts arbitrary
  CAR bytes, and calls `app.dock.setIcon`.

- [ ] **Step 3: Implement the canonical copy and validation path**

  Remove the old crop/iconutil pipeline, validate the layered artifact before
  installing it, update cache inputs, copy the same resources to helpers, and
  delete the runtime Dock override and unused imports.

- [ ] **Step 4: Run the focused tests and confirm GREEN**

  Require all dev-profile and container-governance tests to pass on macOS 26.

### Task 5: Small-size visual quality gates

**Files:**
- Modify: `tests/unit/scripts/app-icon-assets.test.ts`
- Create: `scripts/render-app-icon-review.mjs`
- Create: `build/design-sources/app-icon-review.png`

**Interfaces:**
- Consumes: decoded 16/32/64/128/256/512/1024 outputs and approved canonical PNGs.
- Produces: automated clarity metrics and a reference-versus-output comparison sheet.

- [ ] **Step 1: Write failing legibility tests**

  Add literal bounds for 16 px body alpha, prompt footprint, cursor footprint,
  prompt/berth separation, continuous berth curve, hidden transparent RGB, and
  black/white/Dock-dark composite halos.

- [ ] **Step 2: Run the visual test and confirm RED where applicable**

  Each new test must fail against the legacy generated outputs for the named
  visual defect, not because a fixture is missing.

- [ ] **Step 3: Make only optical-source adjustments needed for clarity**

  Prefer the approved tiny/small sources unchanged. If an automated or visual
  gate exposes a real 16/32 px defect, adjust only the relevant optical source
  while preserving the master silhouette and regenerate its approved fixture.

- [ ] **Step 4: Render and inspect the comparison sheet**

  Produce aligned outputs on transparent, black, white, and Dock-dark stages;
  inspect the original-resolution sheet and require no clipped edges, halos,
  broken berth curve, or unreadable prompt.

### Task 6: Freshness, documentation, and final review

**Files:**
- Modify: `docs/development.md`
- Modify: `.github/workflows/ci.yml`
- Modify: `scripts/build-dist.sh`
- Modify: `scripts/verify-mac-release-artifacts.mjs`
- Modify: relevant icon tests under `tests/unit/scripts/`

**Interfaces:**
- Consumes: all canonical icon sources and generated artifacts.
- Produces: CI/release gates that cannot package stale or malformed icon assets.

- [ ] **Step 1: Write failing freshness and package-smoke tests**

  Add behavior tests that change one canonical input and prove freshness fails,
  and inspect a fixture `.app` for matching plist keys, ICNS, CAR, and sidecar.

- [ ] **Step 2: Run the release-focused tests and confirm RED**

  Expected failure: current release scripts do not rebuild/check icon inputs or
  inspect packaged app resources.

- [ ] **Step 3: Implement gates and update documentation**

  Add the icon freshness step, complete CI path filters, final `.app` smoke
  inspection, and documentation for the three optical sources and native bundle
  ownership.

- [ ] **Step 4: Run full icon verification**

  Run `pnpm build:icons`, all icon/dev-profile unit tests, formatting/lint for
  touched source, and the real layered-asset inspection. Require fresh output
  and zero failures.

- [ ] **Step 5: Run iterative independent review**

  Dispatch clean visual, macOS pipeline, and repository-governance reviewers.
  Fix every blocking/important finding with a new red-green cycle, regenerate,
  and repeat until all reviewers return no blocking findings.
