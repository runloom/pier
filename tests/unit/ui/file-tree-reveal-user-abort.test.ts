import {
  createFileTreeScrollOwner,
  FILE_TREE_USER_SCROLL_CLAIM_MS,
} from "@pier/ui/file/tree-scroll-owner.ts";
import { describe, expect, it } from "vitest";

/**
 * Behavioral stand-in for G1: once claim fires, sticky demotion must outlive
 * the 150ms window (mirrors use-tree-reveal-controller + owner contract).
 */
describe("reveal user abort stickiness (G1)", () => {
  it("keeps demoted scroll intent after claim window expires", () => {
    let nowMs = 1_000_000;
    const owner = createFileTreeScrollOwner({ now: () => nowMs });
    let pendingScroll: "nearest" | "none" = "nearest";
    let userAborted = false;

    owner.subscribeUserClaim(() => {
      userAborted = true;
      pendingScroll = "none";
    });

    expect(pendingScroll).toBe("nearest");
    owner.claimUserScroll();
    expect(userAborted).toBe(true);
    expect(pendingScroll).toBe("none");

    nowMs += FILE_TREE_USER_SCROLL_CLAIM_MS + 50;
    expect(owner.isUserScrolling()).toBe(false);
    expect(userAborted).toBe(true);
    expect(pendingScroll).toBe("none");

    const effectiveScroll = userAborted ? "none" : pendingScroll;
    expect(effectiveScroll).toBe("none");
  });

  it("drops reveal hold so path-sync compensate is not blocked after claim", () => {
    const owner = createFileTreeScrollOwner({ now: () => 0 });
    owner.beginReveal();
    expect(owner.isRevealActive()).toBe(true);
    owner.claimUserScroll();
    expect(owner.isRevealActive()).toBe(false);
  });
});
