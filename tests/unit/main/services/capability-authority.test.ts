import { createCapabilityAuthority } from "@main/services/capability/authority.ts";
import { describe, expect, it } from "vitest";

describe("CapabilityAuthority (W4-S4)", () => {
  it("default denies cross-project and sibling access", () => {
    const ca = createCapabilityAuthority();
    expect(
      ca.assertRuntimeAccess({
        callerProjectRoot: "/a",
        targetProjectRoot: "/b",
        relation: "child",
      }).ok
    ).toBe(false);
    expect(
      ca.assertRuntimeAccess({
        callerProjectRoot: "/a",
        targetProjectRoot: "/a",
        relation: "sibling",
      }).ok
    ).toBe(false);
    expect(
      ca.assertRuntimeAccess({
        callerProjectRoot: "/a",
        targetProjectRoot: "/a",
        relation: "child",
      }).ok
    ).toBe(true);
  });

  it("maxActiveChildren reservation is bounded and releasable", () => {
    const ca = createCapabilityAuthority({ maxActiveChildren: 1 });
    const first = ca.tryReserveChild?.("parent");
    expect(first?.ok).toBe(true);
    if (first?.ok) {
      expect(first.childRef).toBeTruthy();
      expect(ca.tryReserveChild?.("parent")?.ok).toBe(false);
      ca.releaseChild?.("parent", first.childRef);
      expect(ca.tryReserveChild?.("parent")?.ok).toBe(true);
    }
    const limited = createCapabilityAuthority({ maxActiveChildren: 0 });
    expect(limited.tryReserveChild?.("p")?.ok).toBe(false);
  });

  it("authorize delegates to base (cli-human agents.list ok)", () => {
    const ca = createCapabilityAuthority();
    const result = ca.authorize({
      principalKind: "cli-human",
      material: null,
      op: "agents.list",
      params: {},
    });
    expect(result.ok).toBe(true);
  });

  it("authorize allows control.snapshot for cli-human", () => {
    const ca = createCapabilityAuthority();
    expect(
      ca.authorize({
        principalKind: "cli-human",
        material: null,
        op: "control.snapshot",
        params: {},
      }).ok
    ).toBe(true);
  });
});
