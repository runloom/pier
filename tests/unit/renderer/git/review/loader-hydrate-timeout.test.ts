import { describe, expect, it, vi } from "vitest";
import { GitReviewDocumentLoader } from "../../../../../src/plugins/builtin/git/renderer/review/document/loader.ts";
import type { GitReviewIndexEntry } from "../../../../../src/shared/contracts/git/review.ts";

function entry(path: string): GitReviewIndexEntry {
  return {
    entryKey: `entry:${path}`,
    oldPaths: [],
    path,
    renderSlots: [
      {
        additions: 1,
        deletions: 0,
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

describe("GitReviewDocumentLoader.failHydrateTimeout", () => {
  it("turns idle demanded entries into retryable timeout errors", () => {
    const item = entry("a.ts");
    const loader = new GitReviewDocumentLoader({
      cancel: vi.fn(async () => undefined),
      entries: [item],
      load: vi.fn(() => new Promise(() => undefined)),
    });
    expect(loader.failHydrateTimeout([item.entryKey])).toBe(true);
    const resource = loader.getResource(item.entryKey);
    expect(resource?.kind).toBe("error");
    if (resource?.kind === "error") {
      expect(resource.failure.reason).toBe("timeout");
      expect(resource.failure.retryable).toBe(true);
    }
    loader.retry(item.entryKey);
    expect(loader.getResource(item.entryKey)?.kind).toBe("idle");
  });

  it("ignores pure-rename meta entries (never materialize)", () => {
    const pure: GitReviewIndexEntry = {
      entryKey: "entry:rename",
      oldPaths: ["old.ts"],
      path: "new.ts",
      renderSlots: [
        {
          additions: 0,
          deletions: 0,
          group: "staged",
          oldPath: "old.ts",
          sectionKey: "section:rename",
          status: "renamed",
          targetPath: "new.ts",
        },
      ],
      status: "renamed",
    };
    const loader = new GitReviewDocumentLoader({
      cancel: vi.fn(async () => undefined),
      entries: [pure],
      load: vi.fn(() => new Promise(() => undefined)),
    });
    expect(loader.failHydrateTimeout([pure.entryKey])).toBe(false);
    expect(loader.getResource(pure.entryKey)?.kind).toBe("idle");
    expect(loader.isSettled()).toBe(true);
  });

  it("does not override loaded resources", () => {
    const item = entry("b.ts");
    const loader = new GitReviewDocumentLoader({
      cancel: vi.fn(async () => undefined),
      entries: [item],
      load: vi.fn(async () => ({
        kind: "ok",
        document: {
          entryKey: item.entryKey,
          kind: "ok",
          revision: "r1",
          sections: [],
          surfaceSections: {
            committed: null,
            head: null,
            index: null,
            staged: null,
          },
        },
      })),
    });
    loader.hydrateLoaded(
      new Map([
        [
          item.entryKey,
          {
            document: {
              entryKey: item.entryKey,
              kind: "ok",
              revision: "r1",
              sections: [],
              surfaceSections: {
                committed: null,
                head: null,
                index: null,
                staged: null,
              },
            },
            entry: item,
            kind: "loaded",
          },
        ],
      ])
    );
    expect(loader.failHydrateTimeout([item.entryKey])).toBe(false);
    expect(loader.getResource(item.entryKey)?.kind).toBe("loaded");
  });
});
