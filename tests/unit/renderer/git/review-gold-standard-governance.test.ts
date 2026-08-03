import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../../..");

function read(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), "utf8");
}

/**
 * 金标准终态文档与硬禁令（G0）。
 * @see docs/superpowers/specs/2026-07-31-git-review-gold-standard-endstate-design.md
 */
describe("git review gold-standard governance", () => {
  const gold = read(
    "docs/superpowers/specs/2026-07-31-git-review-gold-standard-endstate-design.md"
  );

  it("locks the gold-standard design as product-confirmed authority", () => {
    expect(gold).toContain("产品已确认");
    expect(gold).toContain("终态唯一权威");
    expect(gold).toContain("G0–G6 全绿 = 金标准交付");
    expect(gold).toContain("bodyClass");
    expect(gold).toContain("pending_scroll");
    expect(gold).toContain("lineDiffType");
    expect(gold).toContain("Zed Project Diff");
    expect(gold).toContain("DiffsHub");
  });

  it("locks hard bans against symptom patches and dual-track config", () => {
    expect(gold).toContain("禁止再合");
    expect(gold).toContain("症状补丁");
    expect(gold).toContain("只改 CodeView 不改 Worker");
    expect(gold).toContain("永久 spinner");
  });

  it("bodyClass filters CodeView projection and materialize queue", () => {
    const ledger = read(
      "src/plugins/builtin/git/renderer/review/document/ledger-projection.ts"
    );
    const bodyClass = read(
      "src/plugins/builtin/git/renderer/review/document/body-class.ts"
    );
    const loaderRuntime = read(
      "src/plugins/builtin/git/renderer/review/document/loader-runtime.ts"
    );
    expect(bodyClass).toContain("isReviewEntryBodyHydratable");
    expect(bodyClass).toContain("reviewContentEntryKeysInOrder");
    expect(ledger).toContain("isReviewSlotIncludedInBody(slot)");
    // 不得再有 demand 裁剪显示集的 pendingEntryKeys 旋钮
    expect(ledger).not.toContain("pendingEntryKeys");
    expect(ledger).toContain("demand 不决定有无 id");
    expect(ledger).toContain("禁止");
    expect(loaderRuntime).toContain(
      "isReviewEntryBodyHydratable(resource.entry)"
    );
    expect(bodyClass).not.toContain("始终进 CodeView 账本");
  });

  it("render profile is single-sourced for CodeView and Worker", () => {
    const profile = read("packages/ui/src/diff-view/render-profile.ts");
    const codeOptions = read("packages/ui/src/diff-view/use-code-options.ts");
    const worker = read("packages/ui/src/diff-view/worker.tsx");
    expect(profile).toContain('export const PIER_DIFF_LINE_DIFF_TYPE = "none"');
    expect(codeOptions).toContain("PIER_DIFF_LINE_DIFF_TYPE");
    expect(worker).toContain("PIER_DIFF_LINE_DIFF_TYPE");
    expect(worker).toContain("setRenderOptions");
    // theme sync must re-assert lineDiffType (not theme-only)
    expect(worker).toMatch(
      /setRenderOptions\(\{[\s\S]*lineDiffType:\s*PIER_DIFF_LINE_DIFF_TYPE[\s\S]*theme/u
    );
  });

  it("related specs supersede to the gold-standard document", () => {
    const zed = read(
      "docs/superpowers/specs/2026-07-31-git-review-zed-feel-design.md"
    );
    const ledger = read(
      "docs/superpowers/specs/2026-07-27-git-review-stable-ledger-design.md"
    );
    const diffsHub = read(
      "docs/superpowers/specs/2026-07-27-diffshub-full-alignment-design.md"
    );
    for (const doc of [zed, ledger, diffsHub]) {
      expect(doc).toContain(
        "2026-07-31-git-review-gold-standard-endstate-design.md"
      );
    }
  });

  it("G2: 8s hydrate timeout forces error (no permanent spinner)", () => {
    const hydrate = read(
      "src/plugins/builtin/git/renderer/review/document/hydrate-timeout.ts"
    );
    const loader = read(
      "src/plugins/builtin/git/renderer/review/document/loader.ts"
    );
    const generation = read(
      "src/plugins/builtin/git/renderer/hooks/use-document-generation-effect.ts"
    );
    const ledger = read(
      "src/plugins/builtin/git/renderer/review/document/ledger-projection.ts"
    );
    expect(hydrate).toContain("GIT_REVIEW_BODY_HYDRATE_TIMEOUT_MS = 8000");
    expect(loader).toContain("failHydrateTimeout");
    expect(loader).toContain('reason: "timeout"');
    expect(generation).toContain("createHydrateTimeoutWatchdog");
    expect(generation).toContain("failHydrateTimeout");
    expect(ledger).toContain("projectionMissingSectionItem");
    expect(ledger).toContain("projection-empty");
  });

  it("G3: estimate skeleton geometry is single-sourced real DOM", () => {
    const skeleton = read("packages/ui/src/diff-view/estimate-skeleton.ts");
    const geometry = read("packages/ui/src/diff-view/geometry.ts");
    const estimateHeight = read("packages/ui/src/diff-view/layout-apply.ts");
    const items = read("packages/ui/src/diff-view/items.ts");
    const demand = read(
      "src/plugins/builtin/git/renderer/review/document/demand.ts"
    );
    const estimates = read(
      "src/plugins/builtin/git/renderer/review/document/estimates.ts"
    );
    const feedback = read(
      "src/plugins/builtin/git/renderer/review/feedback.tsx"
    );
    expect(skeleton).toContain("PIER_DIFF_ESTIMATE_SKELETON_LINES = 5");
    // 金标准：与 header padding-inline 12 对齐，禁止 28/48 假 gutter
    expect(skeleton).toContain("PAD_LEFT_PX = 12");
    expect(skeleton).toContain("PAD_RIGHT_PX = 12");
    expect(skeleton).toContain("PIER_TREE_SKELETON_PAD_X_PX = 4");
    expect(skeleton).toContain("syncEstimateSkeleton");
    // inline 几何：无 host CSS 时仍可见错落条（防整宽灰板）
    expect(skeleton).toContain("bar.style.height");
    expect(skeleton).toContain("bar.style.width = width");
    expect(skeleton).toContain("backgroundColor");
    // 骨架行数单源：ui estimate-skeleton → review re-export
    expect(estimates).toContain("PIER_DIFF_ESTIMATE_SKELETON_LINES");
    expect(estimates).toContain("GIT_REVIEW_ESTIMATE_SKELETON_LINES");
    expect(feedback).toContain("PIER_DIFF_ESTIMATE_SKELETON_PAD_LEFT_PX");
    expect(feedback).toContain("ReviewTreeLoading");
    // 侧栏底色 = muted：树骨架禁止 bg-muted
    expect(feedback).toContain("bg-sidebar-foreground/");
    expect(feedback).not.toMatch(
      /ReviewTreeLoading[\s\S]{0,800}bg-muted(?!-)/u
    );
    // A2：虚拟高度单源 geometry；禁止平行 144 / estimateLines 估高 / 死身份字段
    expect(geometry).toContain("export function slotVirtualHeight");
    expect(geometry).toContain("export function totalScrollHeight");
    expect(geometry).toContain("export function diffMetrics");
    expect(estimateHeight).toContain("slotVirtualHeight");
    expect(estimateHeight).toContain("export function applyDiffVirtualHeights");
    expect(estimateHeight).not.toMatch(/=\s*144\b/u);
    expect(items).not.toContain("PIER_DIFF_ESTIMATE_SLOT_HEIGHT_PX");
    expect(items).not.toContain("estimateLinesForFileStatus");
    expect(items).not.toContain("estimateLines");
    expect(demand).toContain("diffMetrics");
    expect(demand).toContain("skeletonSlotHeight");
    expect(demand).toContain("codeFontSize");
    expect(demand).not.toMatch(/=\s*144\b/u);
    const headers = read("packages/ui/src/diff-view/use-headers.tsx");
    const useHandle = read("packages/ui/src/diff-view/use-handle.ts");
    // 单槽折叠：apply + pin；collapse-all：批量不逐项 apply（避免 O(n²)）
    expect(headers).toContain("applyDiffVirtualHeights");
    expect(headers).toContain("pinCodeViewScrollHeight");
    expect(headers).toContain("reconcileHeights");
    expect(useHandle).toContain(
      "setItemCollapsed(id, collapsed, false, false)"
    );
    expect(estimateHeight).toContain("isCollapseAllIntent?.() === true");
    // emit 路径仅 collapse-all 全表 apply，普通滚动不 O(n)
    expect(estimateHeight).toContain("普通滚动：不付 O(n) 全表代价");
    const sessionCache = read(
      "src/plugins/builtin/git/renderer/review/session-cache.ts"
    );
    expect(sessionCache).not.toContain("measuredEstimateLinesByPath");
    expect(estimates).not.toContain("recordReviewRenderedHeightEstimates");
  });

  it("G4: pending_scroll boosts demand; settle is not navigation gate", () => {
    const demand = read(
      "src/plugins/builtin/git/renderer/review/document/demand.ts"
    );
    const navTry = read(
      "src/plugins/builtin/git/renderer/hooks/use-navigation-try.ts"
    );
    const targets = read(
      "src/plugins/builtin/git/renderer/hooks/use-navigation-targets.ts"
    );
    const view = read(
      "src/plugins/builtin/git/renderer/review/document/view.tsx"
    );
    expect(demand).toContain("boost");
    expect(demand).not.toMatch(
      /navigationPending[\s\S]{0,120}visibleEntryKeys:\s*\[selectedEntryKey\]/u
    );
    expect(navTry).toContain('TREE_NAV_SCROLL_BEHAVIOR = "instant"');
    expect(navTry).toContain("不挂 loader.settled");
    expect(targets).toContain("pending_scroll");
    expect(view).toContain('data-git-review-navigation-gate="false"');
    expect(view).toContain("data-git-review-body-hydrate-timeout-ms");
  });

  it("G5: Z1 content-only concurrent ≥8 is product path until Z2 stream", () => {
    const options = read(
      "src/plugins/builtin/git/renderer/review/document/loader-options.ts"
    );
    const generation = read(
      "src/plugins/builtin/git/renderer/hooks/use-document-generation-effect.ts"
    );
    const demandHook = read(
      "src/plugins/builtin/git/renderer/hooks/use-document-demand.ts"
    );
    const changelog = read("CHANGELOG.md");
    expect(options).toMatch(
      /DEFAULT_MAX_CONCURRENT_DOCUMENTS\s*=\s*(?:1[2-9]|[2-9]\d+)/u
    );
    expect(generation).toContain("reviewContentEntryKeysInOrder");
    expect(generation).toContain(
      "gitReviewSeedEntryKeys(contentEntryKeysInOrder)"
    );
    expect(generation).toContain("tickHydrateTimeout()");
    expect(demandHook).toContain("isReviewEntryBodyHydratable");
    // Z2 未合入时必须 changelog 明示风险
    expect(changelog).toContain("Z2");
    expect(changelog).toContain("未完成");
  });

  it("G6: e2e probe coverage for hydrate timeout and pure-rename empty body", () => {
    const e2e = read("tests/e2e/git/review.spec.ts");
    expect(e2e).toContain("gold-standard probes");
    expect(e2e).toContain("createPureRenameReviewRepository");
    expect(e2e).toContain("data-git-review-body-hydrate-timeout-ms");
    expect(e2e).toContain("data-git-review-navigation-gate");
    expect(e2e).toContain('data-git-review-document-content="empty"');
  });
});
