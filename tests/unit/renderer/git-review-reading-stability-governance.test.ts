/**
 * P0 阅读稳定门禁：禁止内容变更主路径 scrollTop freeze / 外层 item 级 scrollTo 抢 Pierre。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../../..");

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("git-review reading stability governance (P0)", () => {
  it("forbids scroll freeze API on content mutation path", () => {
    const handle = read("packages/ui/src/use-diff-view-handle.ts");
    expect(handle).not.toContain("beginScrollFreeze");
    expect(handle).not.toContain("endScrollFreeze");
    expect(handle).not.toContain("reapplyScrollFreeze");

    const codeView = read(
      "src/plugins/builtin/git/renderer/git-review-code-view.tsx"
    );
    expect(codeView).not.toContain("beginScrollFreeze");
    expect(codeView).not.toContain("endScrollFreeze");

    const content = read(
      "src/plugins/builtin/git/renderer/git-review-content.tsx"
    );
    expect(content).not.toContain("beginScrollFreeze");
    expect(content).toContain("restoreReviewReadingViewport");
  });

  it("item replay defaults to preserveAnchor false (Pierre line anchor)", () => {
    const replay = read(
      "src/plugins/builtin/git/renderer/use-git-review-item-replay.ts"
    );
    expect(replay).toContain("preserveAnchor: false");
  });

  it("reading anchor policy: same-id never external restore; id-lost remaps", () => {
    const policy = read(
      "src/plugins/builtin/git/renderer/git-review-reading-anchor.ts"
    );
    expect(policy).toContain("preferredSide");
    expect(policy).toContain("neighborhood");
    expect(policy).toContain("resolveReviewReadingAnchor");
    expect(policy).toContain("shouldRestoreReadingAnchorExternally");
    // 同 id 存活（含半暂存）禁止外层 restore
    expect(policy).toContain(
      "return !currentItemIds.includes(pending.anchor.id)"
    );
    expect(policy).toContain("禁止对同 id 外层 scrollTo");
  });

  it("R7: membership apply forbids raw scrollTop pin and item-level scrollTo restore", () => {
    const apply = read("packages/ui/src/use-diff-view-item-apply.ts");
    expect(apply).not.toMatch(/scrollTopBefore/);
    expect(apply).not.toMatch(/container\.scrollTop\s*=/);
    // 禁止 membership 后 scrollTo 抢行锚
    expect(apply).not.toContain("captureMembershipContentAnchor");
    expect(apply).not.toContain("restoreMembershipContentAnchor");
    // 拓扑变后 paint 前同步 layout + Pierre 行锚
    expect(apply).toContain("render(true)");
    expect(apply).toContain("shouldFlushMembershipLayout");
  });

  it("settle path only external-restores on identity loss", () => {
    const projection = read(
      "src/plugins/builtin/git/renderer/git-review-document-projection.ts"
    );
    expect(projection).toContain("shouldRestoreReadingAnchorExternally");
    expect(projection).toContain("restoreReviewReadingViewport");
    const restoreStart = projection.indexOf(
      "export function restoreReviewReadingViewport"
    );
    const restoreEnd = projection.indexOf(
      "export function restoreReviewViewportFreeze",
      restoreStart
    );
    const restoreFn = projection.slice(
      restoreStart,
      restoreEnd > restoreStart ? restoreEnd : restoreStart + 800
    );
    expect(restoreFn).not.toContain("setScrollTop");
  });

  it("session captures preferredSide + previous entryKey before index reassignment", () => {
    const session = read(
      "src/plugins/builtin/git/renderer/use-git-review-document-session.ts"
    );
    expect(session).toContain("previousEntryKeyBySectionId");
    expect(session).toContain("preferredSide");
    expect(session).toContain("previousItemIds");
    expect(session).toContain("flush: true");
  });

  it("content pending lifecycle defers identity restore to layout tryPendingAnchor", () => {
    const content = read(
      "src/plugins/builtin/git/renderer/git-review-content.tsx"
    );
    // endReadingRefresh must not call restoreReviewReadingViewport (race)
    const endStart = content.indexOf("const endReadingRefresh = useCallback");
    const endEnd = content.indexOf("const getReadingMode", endStart);
    const endBody = content.slice(
      endStart,
      endEnd > endStart ? endEnd : endStart + 800
    );
    expect(endBody).toContain("shouldRestoreReadingAnchorExternally");
    expect(endBody).not.toContain("restoreReviewReadingViewport");
    // layout path still restores
    expect(content).toContain("tryPendingAnchor");
    expect(content).toContain("restoreReviewReadingViewport");
  });

  it("git review content path forbids preserveAnchor true", () => {
    const replay = read(
      "src/plugins/builtin/git/renderer/use-git-review-item-replay.ts"
    );
    expect(replay).not.toMatch(/preserveAnchor:\s*true/);
    const content = read(
      "src/plugins/builtin/git/renderer/git-review-content.tsx"
    );
    expect(content).not.toMatch(/preserveAnchor:\s*true/);
  });
});
