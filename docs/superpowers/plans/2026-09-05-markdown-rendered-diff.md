# Markdown rendered local diff implementation plan

> Execute inline with test-driven development. The user approved the researched direction on 2026-09-05; no delegation, staging, commits or pushes.

**Goal:** Reading-mode local changes retain Markdown layout, expose removed content, and provide source comparison for precise review.

**Architecture:** Keep the existing HEAD baseline and comparison resource. Parse complete before/after documents with the existing Markdown Worker. Project the selected change onto complete Markdown blocks and render them through the existing IR renderer. Native jsdiff (already used by Pierre) handles bounded block/inline alignment; no replacement diff service or Markdown engine.

**Tech stack:** React 19, existing Markdown IR/remark pipeline, jsdiff 9.0.0, Vitest, existing Electron E2E runner.

**Spec:** The approved research response in this conversation and the existing Files local diff specification. Rendered content supersedes the source-only restriction of the unimplemented Markdown inline-container proposal; changing the Popover container is independent and is not required here.

## Constraints and behavior

- HEAD → current contents still includes unsaved changes and ignores staging.
- Reading mode defaults to rendered content; source mode retains its current source excerpt.
- The local preview toolbar offers Preview / Source using shared controls and translated labels in all four locales.
- Text and compatible inline formatting changes retain their paragraph/heading and show inserted/deleted spans. Whole deleted blocks remain visible. Lists/tables and incompatible structures show complete before/after blocks.
- Parse full documents before selecting blocks, so fences, references, lists and tables retain context.
- Links and image attributes have explicit old/new details. HTML, source-only edits and rendering failures offer a visible source fallback. Historical image bytes are not supplied by the text-only baseline API: never label current disk pixels as HEAD pixels.
- Comparison renderers are read-only: no task edits, table preference writes, applet execution, or duplicate comment/outline chrome.
- Use existing document fonts, reading preferences, semantic diff tokens and the bounded local scroll surface.
- Each source file stays at or below 500 lines; no cross-plugin imports or generic service abstraction.

## Task 1 — Preserve rendered content and deleted blocks

Files: `renderer/git-changes/markdown/{model,inlines,attributes}.ts`, shared `markdown/{ir,ir-inlines,ir-renderer}.tsx` as appropriate; `tests/unit/plugins/files/rendered-diff/model.test.ts`.

Interfaces:

```ts
interface MarkdownDiffBlock {
  block: MarkdownBlock;
  kind: "added" | "deleted" | "modified";
  side: "before" | "after";
}
interface MarkdownDiffModel {
  blocks: MarkdownDiffBlock[];
  attributes: Array<{ kind: "link" | "image"; before: string; after: string }>;
  hasHtml: boolean;
  hasHistoricalImages: boolean;
}
function buildMarkdownDiff(input: {
  before: MarkdownIrDocument;
  after: MarkdownIrDocument;
  range: FileChangeRange;
}): MarkdownDiffModel;
```

- [x] Write tests using real Markdown parsing and real text comparison. Assert literal removed/new text, heading depth, complete deleted list/table/fence content, reference-link address changes, unchanged-block exclusion and CJK/emoji preservation.
- [x] Run those tests and observe failure before implementing.
- [x] Add bounded native alignment; reuse original IR objects for unchanged contents and clone only decorated inline nodes.
- [x] Add renderer support for optional inline change decoration and explicitly read-only block rendering; run tests to green.

Example first assertion:

```ts
const before = "# Guide\n\nKeep **old** wording.\n";
const after = "# Guide\n\nKeep **new** wording.\n";
// Rendering the selected change must contain <strong><del>old</del><ins>new</ins></strong>.
// The unchanged Guide heading is outside the selected change.
```

## Task 2 — Parse ownership, cache and stale results

Files: `renderer/git-changes/markdown/documents.ts`; `tests/unit/plugins/files/rendered-diff/documents.test.ts`.

Interface: `loadMarkdownDiffDocuments(owner: object, before: string, after: string, runtime?: MarkdownRuntime): Promise<{ before: MarkdownIrDocument; after: MarkdownIrDocument }>`.

- [x] Test that repeated opens of the same pair reuse parsing, changed current text reparses, failed parses can retry, and unique sessions close after success/failure.
- [x] Implement one cached pair per live owner, full-document Worker parsing, and closed-session cleanup.
- [x] Ensure the React consumer ignores obsolete outcomes after range/document/mode changes.

## Task 3 — Reading/source integration

Files: `renderer/git-changes/markdown/{content,view}.tsx`, `styles.css`, `peek-content.tsx`, `surface.tsx`, four Files locales; `tests/component/files/rendered-diff.test.tsx`.

- [x] Write failing component tests for default rendered headings, deleted words, source switching, read-only task boxes, source-only/failure fallback, and reading preference updates.
- [x] Use the shared IR renderer with current resources only for the current side; historical resources remain explicit placeholders with address details.
- [x] Add the Preview / Source control in the existing toolbar. Keep source gutter behavior, close/focus/navigation, and immutable snapshot semantics.
- [x] Reuse the existing prose CSS and reading store; scope new CSS to diff decorations and layout only.
- [x] Run existing local peek and Markdown regression suites together.

## Task 4 — Verification and documentation

- [x] Extend the existing E2E flow to inspect rendered paragraphs/deletions, Preview/Source switching and bounded width; cover heading and source-only fallback in the actual browser component harness.
- [x] Run focused unit/component tests, host/UI typecheck, scoped lint, architecture, file size and directory-density checks.
- [x] Use the approved remote-first Electron runner for the affected scenario; report any infrastructure blocker accurately.
- [x] Inspect actual rendered content in light/dark and narrow/wide surfaces. Fix observed defects in a bounded pass.
- [x] Update the Files local diff specification and superseded source-only proposal; record tests and limitations in the implementation report.


## Verification record — 2026-09-05

Implemented the approved content layer, retaining the existing non-modal Popover. Source mode remains the existing Pierre excerpt. Native jsdiff is a direct dependency at the already-installed 9.0.0 version; no dependency upgrades or additional parsing engine were introduced.

- 39 focused Vitest files / 277 tests passed, including full Markdown regressions, local peek interactions, source fallback, parse ownership, reference isolation, historical images, CJK/emoji, locale parity, copy governance and the shared diff boundary.
- A further color/layout verification run passed 4 files / 40 tests, including the 14 color-token governance tests. The layout tests overlap the earlier focused suite.
- Full host/packages/Canvas typecheck passed; host typecheck was repeated after the final TypeScript changes. Full lint passed. Dependency-cruiser, file-size, directory-density and whitespace checks passed. The largest modified source file is the existing IR renderer at 488 lines.
- Isolated Chromium verification uses the actual Markdown Worker, shared renderer/styles and real Pierre source view. Preview ↔ Source passed at 320px / 640px component widths in light/dark, with no horizontal overflow or browser errors. Heading, complete deleted list/table, paired table versions, code fences, source-only changes and light paper in a dark app were checked. Screenshots and replay script are under `/tmp/pier-rendered-diff-qa-20260905/`.
- The remote-first Electron runner successfully built plugins, main/preload/renderer and mobile web, then timed out at 120 seconds after `workspace ready`, before the fixture-open milestone. Its Electron process also stalled during cleanup and was terminated. End-to-end app integration is **not claimed passed**. The timeout occurred on the first implementation snapshot; later boundary and color fixes were verified by local tests and actual browser rendering.
- Impeccable detect reported no findings. Manual screenshot inspection confirmed readable deletions, shared typography/paper and bounded widths.

Remaining limits are explicit product behavior: historical image bytes are unavailable from the text-only HEAD API, invisible/oversized content falls back to complete Source, and complex structural edits show whole before/after blocks. Rendered-mode performance has not been given the source-mode P95 measurements from the existing specification. The inline-container proposal remains unimplemented and independent of this change.

## Follow-up — link details in context

- [x] Remove the always-visible link-address footer for ordinary additions/deletions.
- [x] Attach existing destination/title edits to the current link with a shared hover/focus Tooltip and dotted underline; preserve current navigation and read-only focus discipline.
- [x] Anchor unchanged links before matching edited labels/targets with bounded native jsdiff. Preserve reference-only additions/deletions and immutable parsed documents.
- [x] Verify real-parser/component regressions, locale parity, typecheck and actual light/dark browser rendering at 320/640px.

Final follow-up regression run passed 42 files / 306 tests. The unchanged local-peek focus-handoff file passed seven tests in isolation but one timing-sensitive case failed in broader runs; it is explicitly recorded in `.superpowers/sdd/2026-09-05-files-local-diff-peek/rendered-diff-report.md`. Full-app Electron E2E remains subject to the earlier timeout.
