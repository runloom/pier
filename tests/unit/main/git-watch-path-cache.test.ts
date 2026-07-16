import { GitWatchPathCache } from "@main/services/git-watch-path-cache.ts";
import { describe, expect, it } from "vitest";

describe("GitWatchPathCache", () => {
  it("命中会提升 LRU 次序，第 129 项只淘汰最久未访问路径", () => {
    const cache = new GitWatchPathCache<number>(128);
    for (let index = 0; index < 128; index += 1) {
      cache.set(`/repo-${index}`, `marker-${index}`, index);
    }

    expect(cache.get("/repo-0", "marker-0")).toBe(0);
    cache.set("/repo-128", "marker-128", 128);

    expect(cache.get("/repo-1", "marker-1")).toBeUndefined();
    expect(cache.get("/repo-0", "marker-0")).toBe(0);
    expect(cache.get("/repo-128", "marker-128")).toBe(128);
  });

  it("同路径 .git 标记变化立即失效，delete 与 clear 不保留旧身份", () => {
    const cache = new GitWatchPathCache<string>(2);
    cache.set("/repo", "old-marker", "old-anchor");
    expect(cache.get("/repo", "new-marker")).toBeUndefined();

    cache.set("/repo", "new-marker", "new-anchor");
    cache.delete("/repo");
    expect(cache.get("/repo", "new-marker")).toBeUndefined();

    cache.set("/repo-a", "a", "anchor-a");
    cache.set("/repo-b", "b", "anchor-b");
    cache.clear();
    expect(cache.get("/repo-a", "a")).toBeUndefined();
    expect(cache.get("/repo-b", "b")).toBeUndefined();
  });
});
