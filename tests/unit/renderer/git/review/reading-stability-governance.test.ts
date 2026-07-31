import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GIT_REVIEW_GROUP_ORDER } from "@shared/contracts/git/review.ts";
import { describe, expect, it } from "vitest";
import { GIT_REVIEW_PRESENTATION_GROUP_ORDER } from "../../../../../src/plugins/builtin/git/renderer/review/surface-group.ts";

const ROOT = process.cwd();

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

describe("Git 变更阅读稳定性治理", () => {
  it("产品展示顺序完整且不重复地覆盖协议分组", () => {
    expect(new Set(GIT_REVIEW_PRESENTATION_GROUP_ORDER).size).toBe(
      GIT_REVIEW_PRESENTATION_GROUP_ORDER.length
    );
    expect([...GIT_REVIEW_PRESENTATION_GROUP_ORDER].sort()).toEqual(
      [...GIT_REVIEW_GROUP_ORDER].sort()
    );
  });

  it("renderer 不持有滚动位置，也不通过帧循环或定时器补偿导航", () => {
    const runtime = [
      "src/plugins/builtin/git/renderer/review/content.tsx",
      "src/plugins/builtin/git/renderer/review/surface-view.tsx",
      "src/plugins/builtin/git/renderer/review/surfaces.tsx",
      "src/plugins/builtin/git/renderer/hooks/use-document-generation-effect.ts",
      "src/plugins/builtin/git/renderer/hooks/use-navigation.ts",
      "src/plugins/builtin/git/renderer/hooks/use-navigation-try.ts",
      "src/plugins/builtin/git/renderer/hooks/use-navigation-targets.ts",
      "src/plugins/builtin/git/renderer/hooks/use-tree-open.ts",
      "src/plugins/builtin/git/renderer/hooks/use-viewport-effects.ts",
    ]
      .map(read)
      .join("\n");

    expect(runtime).not.toMatch(/\bgetScrollTop\b/);
    expect(runtime).not.toMatch(/\bsetScrollTop\b/);
    expect(runtime).not.toMatch(/\brestoreAnchor\b/);
    expect(runtime).not.toMatch(/\bcaptureTopAnchor\b/);
    expect(runtime).not.toMatch(/\brequestAnimationFrame\b/);
    expect(runtime).not.toMatch(/\bsetTimeout\b/);
  });

  it("成员更新只有 packages/ui 的锚定事务可以读取滚动坐标", () => {
    const apply = read("packages/ui/src/diff-view/use-item-apply.ts");
    const sync = read("packages/ui/src/diff-view/item-sync.ts");

    expect(apply).toContain("applyCodeViewItemsAnchored");
    expect(apply).not.toMatch(/\brequestAnimationFrame\b/);
    expect(apply).not.toMatch(/\bgetScrollTop\b/);
    expect(apply).not.toMatch(/\bsetScrollTop\b/);
    expect(sync).toContain("captureCodeViewItemAnchor");
    expect(sync).toContain("deletedAnchorFallbackId");
    expect(sync).toContain('behavior: "instant"');
  });

  it("暂存写入以无防抖权威读取作为提交屏障，不依赖 watch 序号", () => {
    const commit = read(
      "src/plugins/builtin/git/renderer/hooks/use-mutation-commit.ts"
    );
    const panelState = read(
      "src/plugins/builtin/git/renderer/hooks/use-changes-panel-index-state.ts"
    );

    expect(commit).toContain("waitForAuthoritativeState");
    expect(commit).not.toContain("hydrateLoaded");
    expect(commit).not.toContain("refreshIndex");
    expect(commit).not.toContain("requestAnimationFrame");
    expect(panelState).toContain("refreshNow");
    expect(panelState).not.toContain("stateSequence");
  });

  it("冲突、未暂存与已暂存是隔离阅读面，跨面导航等待真实正文后再切换", () => {
    const surfaces = read(
      "src/plugins/builtin/git/renderer/review/surfaces.tsx"
    );
    const content = read("src/plugins/builtin/git/renderer/review/content.tsx");
    const handoff = read(
      "src/plugins/builtin/git/renderer/hooks/use-surface-navigation-handoff.ts"
    );
    const surfaceView = read(
      "src/plugins/builtin/git/renderer/review/surface-view.tsx"
    );
    const switcher = read(
      "src/plugins/builtin/git/renderer/review/surface-switcher.tsx"
    );
    const projection = read(
      "src/plugins/builtin/git/renderer/review/document/ledger-projection.ts"
    );
    const surfaceGroups = read(
      "src/plugins/builtin/git/renderer/review/surface-group.ts"
    );
    const sessionCache = read(
      "src/plugins/builtin/git/renderer/review/session-cache.ts"
    );
    const tree = read("src/plugins/builtin/git/renderer/review/tree.tsx");

    expect(surfaces).toContain("GIT_REVIEW_UNCOMMITTED_READING_SURFACES");
    expect(surfaces).not.toContain('["conflict", "staged", "index"]');
    expect(surfaces).not.toContain('["head", "index", "staged"]');
    expect(surfaces).toContain("mountedSurfaces");
    expect(surfaces).toContain("navigationRequestRef");
    expect(surfaces).toContain("onNavigationMaterialized");
    expect(surfaces).toContain("data-git-review-surface");
    expect(surfaces).toContain("inert={active ? undefined : true}");
    expect(surfaceView).toContain("projection={projection}");
    expect(surfaceView).not.toContain("renderedProjectionRef");
    expect(surfaceView).not.toContain("readOnlyReviewProjection");
    expect(content).toContain("enabledRef: activeRef");
    expect(content).toContain("useGitReviewSurfaceNavigationHandoff");
    expect(handoff).toContain("isReviewEstimateCacheKey");
    expect(handoff).toContain("isReviewPlaceholderCacheKey");
    expect(handoff).toContain("useLayoutEffect(() =>");
    expect(projection).not.toContain('options.diffBase === "head"');
    expect(projection).toContain("reviewGroupsForSurface(diffBase)");
    expect(surfaceGroups).toContain(
      'surface === "index" ? ["unstaged"] : [surface]'
    );
    expect(tree).toContain("GIT_REVIEW_PRESENTATION_GROUP_ORDER");
    expect(sessionCache).toContain("GIT_REVIEW_READING_SURFACES");
    expect(switcher).toContain("groups.map((group)");
    expect(switcher).toContain("{labels[group]}");
    expect(switcher).not.toContain("UNCOMMITTED_SURFACES");
    expect(switcher).not.toContain("reviewSurfaceIndex");
    expect(switcher).not.toContain("reviewSurfaceStaged");
  });

  it("非活动阅读面保留模型但不更新隐藏的 Pierre DOM", () => {
    const replay = read(
      "src/plugins/builtin/git/renderer/hooks/use-item-replay.ts"
    );
    const projectionCommit = read(
      "src/plugins/builtin/git/renderer/hooks/use-projection-commit.ts"
    );

    expect(replay).toContain("if (!enabledRef.current)");
    expect(replay).toContain("latestItemUpdatesRef.current.set");
    expect(projectionCommit).toContain("!active");
  });

  it("刷新不能合成树导航或第二条定位链路", () => {
    const navigation = read(
      "src/plugins/builtin/git/renderer/hooks/use-navigation.ts"
    );
    const selectionSync = read(
      "src/plugins/builtin/git/renderer/hooks/use-navigation-resume.ts"
    );
    const treeLayout = read(
      "src/plugins/builtin/git/renderer/review/panel-layout.tsx"
    );

    expect(navigation).not.toContain('"rebind"');
    expect(selectionSync).not.toContain("scrollToItem");
    expect(selectionSync).not.toContain("applyNavigationDemand");
    expect(treeLayout).not.toContain("revealPath");
  });

  it("新 index 代际的首次正文需求沿用当前树选择的锚点保护", () => {
    const generation = read(
      "src/plugins/builtin/git/renderer/hooks/use-document-generation-effect.ts"
    );

    expect(generation).toContain(
      "protectSelectedAnchor: selectedEntryKey !== null"
    );
  });
});
