import { describe, expect, it } from "vitest";
import type { GitReviewDocumentResource } from "../../../../../../src/plugins/builtin/git/renderer/review/document/resource.ts";
import {
  clearAllReviewDocumentSoftCachesForTests,
  publishReviewDocumentSoftCache,
  readReviewDocumentSoftCache,
  reviewDocumentSoftCacheScopeKey,
} from "../../../../../../src/plugins/builtin/git/renderer/review/document/soft-cache.ts";
import type { GitReviewIndexEntry } from "../../../../../../src/shared/contracts/git/review.ts";
import { patchDocument } from "./fixture.ts";

function entry(path: string): GitReviewIndexEntry {
  return {
    entryKey: `entry:${path}`,
    oldPaths: [],
    path,
    renderSlots: [
      {
        group: "unstaged",
        oldPath: null,
        sectionKey: `section:${path}`,
        status: "modified",
        targetPath: path,
      },
    ],
    status: "modified",
  };
}

function loaded(
  path: string
): Extract<GitReviewDocumentResource, { kind: "loaded" }> {
  const item = entry(path);
  const sectionKey = item.renderSlots[0]?.sectionKey;
  if (sectionKey === undefined) {
    throw new Error("missing section key");
  }
  return {
    document: patchDocument({
      entryKey: item.entryKey,
      patch: `diff --git a/${path} b/${path}\n@@ -1 +1 @@\n-old\n+new\n`,
      sectionKey,
    }),
    entry: item,
    kind: "loaded",
  };
}

describe("review document soft-cache", () => {
  it("publishes loaded resources for cross-surface soft-retain", () => {
    clearAllReviewDocumentSoftCachesForTests();
    const scopeKey = reviewDocumentSoftCacheScopeKey({
      contextId: "ctx",
      gitRootPath: "/repo",
      target: { kind: "uncommitted" },
    });
    const a = loaded("a.ts");
    publishReviewDocumentSoftCache(scopeKey, new Map([[a.entry.entryKey, a]]));
    expect(readReviewDocumentSoftCache(scopeKey).get(a.entry.entryKey)).toBe(a);

    const b = loaded("b.ts");
    publishReviewDocumentSoftCache(scopeKey, [b]);
    const cache = readReviewDocumentSoftCache(scopeKey);
    expect(cache.get(a.entry.entryKey)).toBe(a);
    expect(cache.get(b.entry.entryKey)).toBe(b);
  });

  it("caps soft-cache size with LRU-ish eviction", () => {
    clearAllReviewDocumentSoftCachesForTests();
    const scopeKey = reviewDocumentSoftCacheScopeKey({
      contextId: "ctx-cap",
      gitRootPath: "/repo",
      target: { kind: "uncommitted" },
    });
    for (let index = 0; index < 100; index += 1) {
      publishReviewDocumentSoftCache(scopeKey, [loaded(`f-${index}.ts`)]);
    }
    const cache = readReviewDocumentSoftCache(scopeKey);
    expect(cache.size).toBeLessThanOrEqual(96);
    expect(cache.has("entry:f-99.ts")).toBe(true);
    expect(cache.has("entry:f-0.ts")).toBe(false);
  });

  it("scopes soft cache by context/gitRoot/target, not reading surface", () => {
    clearAllReviewDocumentSoftCachesForTests();
    const left = reviewDocumentSoftCacheScopeKey({
      contextId: "ctx",
      gitRootPath: "/repo",
      target: { kind: "uncommitted" },
    });
    const right = reviewDocumentSoftCacheScopeKey({
      contextId: "ctx",
      gitRootPath: "/repo",
      target: { kind: "uncommitted" },
    });
    expect(left).toBe(right);
  });
});
