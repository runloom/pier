import { afterEach, describe, expect, it } from "vitest";
import {
  allocateCommentRevealNonce,
  resetCommentRevealNonceForTests,
} from "@/lib/comments/open-git-changes.ts";

afterEach(() => {
  resetCommentRevealNonceForTests();
});

describe("allocateCommentRevealNonce", () => {
  it("is monotonic across callers (dialog remount safe)", () => {
    const a = allocateCommentRevealNonce();
    const b = allocateCommentRevealNonce();
    const c = allocateCommentRevealNonce();
    expect(b).toBe(a + 1);
    expect(c).toBe(b + 1);
  });
});
