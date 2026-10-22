import type { PierDiffViewItem } from "@pier/ui/diff-view/items.ts";
import {
  allowInlineDiffFallback,
  INLINE_FALLBACK_MAX_ITEMS,
  INLINE_FALLBACK_MAX_PATCH_BYTES,
} from "@pier/ui/diff-view/view/inline-fallback.ts";
import { describe, expect, it } from "vitest";

const item = (
  id: string,
  patch: string | null = "diff --git a b"
): PierDiffViewItem => ({
  cacheKey: id,
  id,
  patch,
});

describe("allowInlineDiffFallback", () => {
  it("allows a small single-file view", () => {
    expect(allowInlineDiffFallback([item("one", "x".repeat(1024))])).toBe(true);
  });

  it("rejects a review with too many files", () => {
    const items = Array.from(
      { length: INLINE_FALLBACK_MAX_ITEMS + 1 },
      (_, index) => item(String(index), "")
    );
    expect(allowInlineDiffFallback(items)).toBe(false);
  });

  it("rejects a single file over the patch byte budget", () => {
    expect(
      allowInlineDiffFallback([
        item("large", "x".repeat(INLINE_FALLBACK_MAX_PATCH_BYTES + 1)),
      ])
    ).toBe(false);
  });

  it("rejects a small file set whose patches exceed the byte budget", () => {
    const chunk = "x".repeat(
      Math.floor(INLINE_FALLBACK_MAX_PATCH_BYTES / 4) + 1
    );
    expect(
      allowInlineDiffFallback([
        item("a", chunk),
        item("b", chunk),
        item("c", chunk),
        item("d", chunk),
      ])
    ).toBe(false);
  });

  it("counts estimate items without patches by item count", () => {
    const items = Array.from(
      { length: INLINE_FALLBACK_MAX_ITEMS },
      (_, index) => item(String(index), null)
    );
    expect(allowInlineDiffFallback(items)).toBe(true);
    expect(allowInlineDiffFallback([...items, item("extra", null)])).toBe(
      false
    );
  });
});
