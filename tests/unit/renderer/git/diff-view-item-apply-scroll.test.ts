import { describe, expect, it, vi } from "vitest";
import { shouldFlushMembershipLayout } from "../../../../packages/ui/src/diff-view/use-item-apply.ts";

describe("shouldFlushMembershipLayout", () => {
  it("flushes only when membership changed and not suppressed", () => {
    expect(
      shouldFlushMembershipLayout({
        membershipChanged: true,
        suppressMembershipScrollRestore: false,
      })
    ).toBe(true);
  });

  it("does not flush when suppress prop is true", () => {
    expect(
      shouldFlushMembershipLayout({
        membershipChanged: true,
        suppressMembershipScrollRestore: true,
      })
    ).toBe(false);
  });

  it("does not flush when sync getter reports pending", () => {
    expect(
      shouldFlushMembershipLayout({
        getSuppressMembershipScrollRestore: () => true,
        membershipChanged: true,
        suppressMembershipScrollRestore: false,
      })
    ).toBe(false);
  });

  it("does not flush when membership is unchanged", () => {
    expect(
      shouldFlushMembershipLayout({
        membershipChanged: false,
        suppressMembershipScrollRestore: false,
      })
    ).toBe(false);
  });

  it("pendingNav path must not flush layout when suppress is true", () => {
    const flushLayout = vi.fn();
    const shouldFlush = shouldFlushMembershipLayout({
      getSuppressMembershipScrollRestore: () => true,
      membershipChanged: true,
      suppressMembershipScrollRestore: false,
    });
    if (shouldFlush) {
      flushLayout();
    }
    expect(shouldFlush).toBe(false);
    expect(flushLayout).not.toHaveBeenCalled();

    const spy = vi.fn();
    if (
      shouldFlushMembershipLayout({
        membershipChanged: true,
        suppressMembershipScrollRestore: false,
      })
    ) {
      spy();
    }
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
