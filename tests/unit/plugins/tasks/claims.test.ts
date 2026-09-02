import { describe, expect, it } from "vitest";
import { createWorkClaimRegistry } from "../../../../packages/plugin-tasks/src/main/claims.ts";

describe("work claim registry", () => {
  it("grants a claim id exactly once across racing windows", () => {
    const claims = createWorkClaimRegistry();
    const id = claims.issue();
    expect(claims.claimOnce(id)).toBe(true);
    expect(claims.claimOnce(id)).toBe(false);
    expect(claims.claimOnce(id)).toBe(false);
  });

  it("issues unique ids", () => {
    const claims = createWorkClaimRegistry();
    expect(claims.issue()).not.toBe(claims.issue());
  });

  it("rejects empty ids", () => {
    const claims = createWorkClaimRegistry();
    expect(claims.claimOnce("")).toBe(false);
  });

  it("caps memory as a leak guard (evicted ids may re-grant)", () => {
    const claims = createWorkClaimRegistry({ capacity: 2 });
    expect(claims.claimOnce("a")).toBe(true);
    expect(claims.claimOnce("b")).toBe(true);
    expect(claims.claimOnce("c")).toBe(true);
    // "a" was evicted by the capacity guard; re-claim is tolerated because
    // real claims are consumed within milliseconds of being issued.
    expect(claims.claimOnce("a")).toBe(true);
    expect(claims.claimOnce("c")).toBe(false);
  });
});
