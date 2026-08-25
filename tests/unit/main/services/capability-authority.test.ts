import {
  attachChildCapabilityRef,
  releaseRuntimeReservation,
  reserveChildForStart,
  resetRuntimeReservationsForTests,
} from "@main/adapters/cli/local-control/capability-hot-path.ts";
import { createCapabilityAuthority } from "@main/services/capability/authority.ts";
import { describe, expect, it } from "vitest";

describe("CapabilityAuthority (W4-S4 / W6-S4)", () => {
  it("hot-path reserve attaches childCapabilityRef and release frees slot", () => {
    resetRuntimeReservationsForTests();
    const ca = createCapabilityAuthority({ maxActiveChildren: 1 });
    const reserved = reserveChildForStart({
      authority: ca,
      principalRef: "parent-1",
    });
    expect(reserved && "childRef" in reserved).toBe(true);
    if (!(reserved && "childRef" in reserved)) {
      return;
    }
    const data = attachChildCapabilityRef(
      {
        runtime: { bootId: "b", runtimeId: "rt-1", generation: 1 },
        panelId: "p1",
        windowId: "w1",
        agentId: "codex",
      },
      reserved
    ) as { childCapabilityRef: { childRef: string } };
    expect(data.childCapabilityRef.childRef).toBe(reserved.childRef);
    const denied = reserveChildForStart({
      authority: ca,
      principalRef: "parent-1",
    });
    expect(denied).toMatchObject({ ok: false });
    releaseRuntimeReservation({ authority: ca, runtimeId: "rt-1" });
    const again = reserveChildForStart({
      authority: ca,
      principalRef: "parent-1",
    });
    expect(again && "childRef" in again).toBe(true);
  });

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
        op: "control.snapshot",
        params: {},
      }).ok
    ).toBe(true);
  });

  it("default maxActiveChildren is 4 (R10 boot-scoped quota)", () => {
    resetRuntimeReservationsForTests();
    const ca = createCapabilityAuthority();
    for (let i = 0; i < 4; i += 1) {
      const reserved = reserveChildForStart({
        authority: ca,
        principalRef: "p",
      });
      expect(reserved && "childRef" in reserved).toBe(true);
    }
    const fifth = reserveChildForStart({ authority: ca, principalRef: "p" });
    expect(fifth).toMatchObject({
      ok: false,
      code: "quota_exceeded",
      message: "maxActiveChildren (4) exceeded for parent",
    });
  });
});
