import { CodeView } from "@pierre/diffs";
import { afterEach, describe, expect, it } from "vitest";
import { parsePatchFileDiff } from "../../../packages/ui/src/diff-view/file-diff/from-patch.ts";

/**
 * 锁定 `patches/@pierre__diffs@1.2.12.patch` 的 reset() 补丁。
 *
 * 上游 CodeView 在 createItem 时即 `new VirtualizedFileDiff(...)`，其构造函数
 * 向单例 WorkerPoolManager.themeSubscribers 注册；reset()/cleanUp() 只清理
 * 已渲染窗口内的 item。未渲染过的 item 永不退订 → 单例钉住整个 CodeView 及其
 * DOM（线上堆快照：487 个陈旧 VirtualizedFileDiff / 38 个已 cleanUp 的 CodeView，
 * 约 39MB）。
 */

interface FakeThemeSubscriber {
  onThemeChange(): void;
}

function createFakeWorkerManager() {
  const themeSubscribers = new Set<FakeThemeSubscriber>();
  return {
    themeSubscribers,
    subscribeToThemeChanges(instance: FakeThemeSubscriber) {
      themeSubscribers.add(instance);
      return () => {
        themeSubscribers.delete(instance);
      };
    },
    unsubscribeToThemeChanges(instance: FakeThemeSubscriber) {
      themeSubscribers.delete(instance);
    },
    // DiffHunksRenderer probes the pool at construction / cleanup; a
    // non-working pool keeps the item on the synchronous (no-op here) path.
    cleanUpTasks: () => undefined,
    getDiffRenderOptions: () => ({}),
    getDiffResultCache: () => undefined,
    initialize: () => Promise.resolve(),
    isInitialized: () => true,
    isWorkingPool: () => false,
    queueBroadcastStateChanges: () => undefined,
  };
}

function diffItem(index: number) {
  const path = `src/file-${index}.ts`;
  return {
    fileDiff: parsePatchFileDiff({
      cacheKey: `test:${index}`,
      id: path,
      patch: `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old ${index}\n+new ${index}\n`,
    }),
    id: path,
    type: "diff" as const,
  };
}

describe("CodeView theme subscriptions", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("drops every item subscription on cleanUp, including never-rendered items", () => {
    const manager = createFakeWorkerManager();
    const root = document.createElement("div");
    document.body.appendChild(root);
    const view = new CodeView(
      { theme: { dark: "github-dark", light: "github-light" } },
      manager as never,
      true
    );
    view.setup(root);
    view.setItems(Array.from({ length: 12 }, (_, index) => diffItem(index)));
    // Rendering an item calls `virtualizedSetup()` (re-subscribe). Items that
    // later fall out of the tracked render window (resetRenderState paths)
    // stay subscribed, which is exactly what reset() must clean up.
    const items = (
      view as unknown as {
        items: Array<{ instance: { virtualizedSetup(): void } }>;
      }
    ).items;
    expect(items).toHaveLength(12);
    for (const item of items) {
      item.instance.virtualizedSetup();
    }
    expect(manager.themeSubscribers.size).toBe(13);

    view.cleanUp();

    expect(manager.themeSubscribers.size).toBe(0);
  });
});
