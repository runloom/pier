import type {
  PierDiffReviewDriftThread,
  PierDiffViewItem,
} from "@pier/ui/diff-view/items.ts";
import { buildDriftAnnotations } from "@pier/ui/diff-view/review/annotation-anchors.ts";
import { isReviewDriftAnnotation } from "@pier/ui/diff-view/review/annotation-types.ts";
import {
  driftKeyOf,
  itemCacheKeyOf,
} from "@pier/ui/diff-view/review/drift-cache-key.ts";
import type { FileDiffMetadata } from "@pierre/diffs";
import { describe, expect, it } from "vitest";

function makeThread(opts: {
  line?: number;
  side?: "additions" | "deletions";
  threadId?: string;
}): PierDiffReviewDriftThread {
  return {
    ...(opts.line === undefined ? {} : { line: opts.line }),
    ...(opts.side === undefined ? {} : { side: opts.side }),
    threadId: opts.threadId ?? "t1",
  };
}

function makeItem(
  driftComments?: readonly PierDiffReviewDriftThread[]
): PierDiffViewItem {
  return {
    cacheKey: "base-key",
    ...(driftComments === undefined ? {} : { driftComments }),
    id: "i1",
    patch: null,
  };
}

describe("buildDriftAnnotations", () => {
  it("driftComments undefined → undefined", () => {
    expect(buildDriftAnnotations(undefined, "change")).toBeUndefined();
  });

  it("driftComments 空数组 → undefined", () => {
    expect(buildDriftAnnotations([], "change")).toBeUndefined();
  });

  it("非空 → 单个文件级 annotation（lineNumber 0 + review-drift metadata）", () => {
    const threads = [makeThread({ line: 5, threadId: "t1" })];
    const result = buildDriftAnnotations(threads, "change");
    expect(result).toHaveLength(1);
    const first = result?.[0];
    expect(first?.lineNumber).toBe(0);
    expect(first?.metadata.kind).toBe("review-drift");
    if (isReviewDriftAnnotation(first?.metadata)) {
      expect(first?.metadata.threads).toBe(threads);
    }
  });

  it("fileType deleted → side deletions", () => {
    const result = buildDriftAnnotations([makeThread({})], "deleted");
    expect(result?.[0]?.side).toBe("deletions");
  });

  it("fileType new/change/rename-changed → side additions", () => {
    const types: FileDiffMetadata["type"][] = [
      "new",
      "change",
      "rename-changed",
    ];
    for (const type of types) {
      const result = buildDriftAnnotations([makeThread({})], type);
      expect(result?.[0]?.side).toBe("additions");
    }
  });
});

describe("driftKeyOf", () => {
  it("undefined → 空串", () => {
    expect(driftKeyOf(undefined)).toBe("");
  });

  it("空数组 → 空串", () => {
    expect(driftKeyOf([])).toBe("");
  });

  it("非空 → threadId:line:side 指纹（无 state/count）", () => {
    const key = driftKeyOf([
      makeThread({
        line: 5,
        side: "additions",
        threadId: "t1",
      }),
    ]);
    expect(key).toBe("t1:5:additions");
  });

  it("line/side undefined → 0 / 空占位", () => {
    const key = driftKeyOf([makeThread({ threadId: "t1" })]);
    expect(key).toBe("t1:0:");
  });

  it("多线程 → 逗号连接", () => {
    const key = driftKeyOf([
      makeThread({ threadId: "t1" }),
      makeThread({
        line: 9,
        side: "deletions",
        threadId: "t2",
      }),
    ]);
    expect(key).toBe("t1:0:,t2:9:deletions");
  });
});

describe("itemCacheKeyOf", () => {
  it("driftComments 缺省 → 返回原 cacheKey", () => {
    expect(itemCacheKeyOf(makeItem())).toBe("base-key");
  });

  it("driftComments 非空 → cacheKey#drift=... 拼接", () => {
    const item = makeItem([makeThread({ line: 5, threadId: "t1" })]);
    expect(itemCacheKeyOf(item)).toBe("base-key#drift=t1:5:");
  });
});

describe("isReviewDriftAnnotation", () => {
  it("kind review-drift + threads 数组 → true", () => {
    expect(isReviewDriftAnnotation({ kind: "review-drift", threads: [] })).toBe(
      true
    );
  });

  it("kind 错 → false", () => {
    expect(
      isReviewDriftAnnotation({ kind: "review-thread", threads: [] })
    ).toBe(false);
  });

  it("threads 非数组 → false", () => {
    expect(
      isReviewDriftAnnotation({ kind: "review-drift", threads: "x" })
    ).toBe(false);
  });

  it("null / 非对象 → false", () => {
    expect(isReviewDriftAnnotation(null)).toBe(false);
    expect(isReviewDriftAnnotation("x")).toBe(false);
  });
});
