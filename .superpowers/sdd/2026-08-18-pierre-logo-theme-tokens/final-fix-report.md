# Final fix report — branded code themes reach production renderers

## Scope and base

- Base commit: `0425a107`
- Authority: `docs/superpowers/specs/2026-08-18-pierre-logo-theme-tokens-design.md`
- Fix brief: `.superpowers/sdd/2026-08-18-pierre-logo-theme-tokens/final-fix-brief.md`
- Scope stayed within the approved final wave: Pierre theme registration, plugin appearance/Markdown highlighting transport, palette-derived selection alpha, and non-Pierre registry identity coverage.
- No `node_modules`, third-party theme preset, product status color, plugin boundary, or icon/design asset was changed.

## Root cause

The brand overlay was present in `STYLE_PRESET_REGISTRY`, but both production code-renderer boundaries discarded it:

1. `getShikiThemePair` returned upstream Pierre names. Pierre Diffs therefore resolved its own bundled registrations under those names instead of Pier's overlaid objects.
2. Markdown sent only a theme string to its Worker. The Worker intentionally maps an unbundled string to GitHub light/dark, so the overlaid decorator rules never reached `codeToTokens`.

The two minor findings were independent: selection alpha duplicated the primary literal, and the non-Pierre identity test covered only GitHub rather than the full `StylePresetId` schema.

## TDD evidence

### RED

Tests were written before production edits.

Command:

```text
pnpm vitest run tests/unit/renderer/lib/theme/pierre-brand-overlay.test.ts tests/unit/renderer/lib/theme/register-custom-themes.test.ts tests/unit/renderer/lib/plugins/appearance-context.test.ts tests/unit/plugins/markdown-code-highlighter.test.ts tests/unit/plugins/markdown-preview.test.tsx
```

Exact summary:

```text
Test Files  5 failed (5)
Tests  7 failed | 30 passed (37)
```

The seven failures were the intended missing behaviors:

- Diffs alias remained the upstream name: `expected 'pierre-light' not to be 'pierre-light'`.
- Selection stayed hardcoded: `expected '#8549ff4d' to be '#1234564d'`.
- Source registry was absent: `expected undefined to be defined`.
- Plugin appearance raw registration was absent: `Received: undefined`.
- Preview did not forward `themeRegistration`.
- Both Markdown Worker cases initially reached the first-token shape assertion before the color assertion (`@sealed` versus `@`). The assertion was corrected, without production changes, to accept the grammar's token boundary and check the actual color.

Corrected Worker RED command:

```text
pnpm vitest run tests/unit/plugins/markdown-code-highlighter.test.ts
```

Exact color failures:

```text
expected '#e1e4e8' to be '#b66cff'
expected '#24292e' to be '#8549ff'
Test Files  1 failed (1)
Tests  2 failed | 3 passed (5)
```

After adding the per-Worker payload-lifetime regression, still before production edits, the same command produced:

```text
Test Files  1 failed (1)
Tests  3 failed | 3 passed (6)
```

The additional failure showed that the first request lacked the matching raw registration; the two color failures remained the same GitHub fallback colors.

### Focused GREEN

Theme/registry/Diffs cycle:

```text
pnpm vitest run tests/unit/renderer/lib/theme/pierre-brand-overlay.test.ts tests/unit/renderer/lib/theme/register-custom-themes.test.ts tests/unit/renderer/lib/theme/tokyo-night-preset.test.ts

Test Files  3 passed (3)
Tests  13 passed (13)
```

Appearance/Markdown cycle:

```text
pnpm vitest run tests/unit/renderer/lib/plugins/appearance-context.test.ts tests/unit/plugins/markdown-code-highlighter.test.ts tests/unit/plugins/markdown-preview.test.tsx

Test Files  3 passed (3)
Tests  28 passed (28)
```

An intermediate `pnpm typecheck:host` found only a test-side `ShikiThemeLike.name` optionality narrowing error after a cleanup removed the earlier test cast. The fixture now constructs a required-name registration. No production type error was present.

### Final GREEN

Full relevant theme, plugin/Markdown, renderer Git/diff, UI diff, Markdown preference, and icon archive suites:

```text
pnpm vitest run tests/unit/renderer/lib/theme tests/unit/renderer/lib/plugins/appearance-context.test.ts tests/unit/plugins tests/unit/renderer/files/markdown tests/unit/renderer/git tests/unit/packages/ui/diff-view tests/unit/scripts/app-icon-assets.test.ts

Test Files  123 passed (123)
Tests  986 passed (986)
Duration  18.45s
```

Full typecheck:

```text
pnpm typecheck

$ pnpm typecheck:host && pnpm typecheck:packages && pnpm typecheck:canvases
$ tsc --noEmit
$ tsc -p packages/ui/tsconfig.json --noEmit && tsc -p packages/plugin-api/tsconfig.json --noEmit && tsc -p packages/plugin-api/src/peer-sync/tsconfig.json --noEmit && tsc -p packages/plugin-codex/tsconfig.json --noEmit && tsc -p packages/plugin-grok/tsconfig.json --noEmit && tsc -p packages/plugin-ssh/tsconfig.json --noEmit && tsc -p packages/plugin-claude/tsconfig.json --noEmit
$ tsc -p tsconfig.canvases.json --noEmit
exit_code: 0
```

Touched-file format/lint:

```text
pnpm exec ultracite check <19 touched TypeScript/TSX files>

Checked 19 files in 1350ms. No fixes applied.
```

Whitespace/static diff check:

```text
git diff --check

exit_code: 0 (no output)
```

## Implementation and design choices

### Pierre Diffs

- Split the theme registry into `STYLE_PRESET_SOURCE_REGISTRY` and the final `STYLE_PRESET_REGISTRY`.
- Only `pierre` and `pierre-soft` are replaced by overlaid outputs. Every other final entry and light/dark theme object retains source identity.
- `getShikiThemePair` now returns four unique host aliases for the two Pierre presets and two modes. Every non-Pierre name/fallback path is unchanged.
- `ensureCustomShikiThemesRegistered` registers alias-named shallow copies whose raw data comes from `getShikiTheme`. The registration `name` exactly matches its alias before the existing Diff Worker host initializes.

### Markdown and plugin appearance

- Added optional `RendererPluginAppearance.codeThemeRegistration`; existing required string fields and all old appearance objects remain compatible.
- The host publishes the active overlaid raw object only for Pierre/Pierre Soft. This bounds payload and Worker lifetime storage while leaving bundled themes on their existing string-only path.
- Preview forwards the raw registration only when all of these are true: no explicit `codeTheme` override, the reading appearance selects the active app appearance, and registration/name agree. Explicit overrides and opposite-mode GitHub fallbacks stay string-only.
- The highlighter sends a matching raw registration once per registration object per Worker lifetime. It resends after Worker failure/restart or if the registration object changes.
- The Worker caches registrations by name and passes the matching object to Shiki. Missing/mismatched registrations retain the previous bundled-name/GitHub-fallback behavior.

### Completeness fixes

- `editor.selectionBackground` now appends `4d`/`2e` through a local hex-alpha helper fed by `PIER_BRAND_PALETTE.primary`.
- The preservation test iterates `stylePresetIdSchema.options`, excludes only the two Pierre presets, and checks final entry plus light/dark object identity against the source registry for all 18 non-Pierre presets.

## Files changed

Production:

- `src/renderer/lib/theme/pierre-brand-overlay.ts`
- `src/renderer/lib/theme/preset-registry.ts`
- `src/renderer/lib/theme/register-custom-themes.ts`
- `src/renderer/lib/plugins/host/appearance-context.ts`
- `src/plugins/api/renderer-appearance.ts`
- `src/plugins/api/renderer.ts`
- `src/plugins/builtin/files/renderer/markdown/preview.tsx`
- `src/plugins/builtin/files/renderer/markdown/preview-code-theme.ts`
- `src/plugins/builtin/files/renderer/markdown/ir-renderer.tsx`
- `src/plugins/builtin/files/renderer/markdown/ir-inlines.tsx`
- `src/plugins/builtin/files/renderer/markdown/code-block.tsx`
- `src/plugins/builtin/files/renderer/markdown/code-highlighter.ts`
- `src/plugins/builtin/files/renderer/markdown/code-highlight-protocol.ts`
- `src/plugins/builtin/files/renderer/markdown/code-highlight.worker.ts`

Tests:

- `tests/unit/renderer/lib/theme/pierre-brand-overlay.test.ts`
- `tests/unit/renderer/lib/theme/register-custom-themes.test.ts`
- `tests/unit/renderer/lib/plugins/appearance-context.test.ts`
- `tests/unit/plugins/markdown-code-highlighter.test.ts`
- `tests/unit/plugins/markdown-preview.test.tsx`

## Self-review

- Structured-clone safety: the actual host-published overlaid registration is exercised with `structuredClone`; it contains data only. A clone failure during `postMessage` also follows the existing Worker failure/plain-text recovery path.
- Alias/name agreement: Diffs integration resolves every alias and asserts the resolved name equals the requested alias; Markdown requires `registration.name === theme` in preview, highlighter, and Worker.
- Registration idempotence: the existing module guard remains; it is now set only after all registrations complete. The dependency's custom registry also rejects duplicate names safely across module reloads.
- Payload size/lifetime: only Pierre/Pierre Soft publish raw data; a registration is posted once per object per Worker lifetime, retained in bounded maps (at most four branded names), and the renderer-side map clears whenever the Worker stops.
- Plugin API compatibility: the new field is optional; existing `codeTheme`, `codeThemes`, `theme`, and typography fields remain. Full host and external plugin package typechecks pass.
- Explicit/fallback compatibility: integration coverage proves an explicit `github-dark` override and opposite-mode `github-light` fallback omit raw registration and keep their original string behavior.
- Non-Pierre identity: all 18 non-Pierre schema entries preserve the original source entry and both theme objects. Existing GitHub and Tokyo Night name-pair tests also remain green.
- Literal ownership: no new concrete palette literal exists outside `pierre-brand-overlay.ts` and tests. The scan found only the already-approved static icon/design sources in `build/` plus the palette owner.
- Third-party integrity: no file under `node_modules` or any vendored/third-party preset was modified.

## Concerns

None open. The intentional behavior change is limited to Pierre/Pierre Soft code rendering; string-only overrides and all non-Pierre presets retain their previous behavior.
