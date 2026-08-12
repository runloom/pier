/**
 * CA 归属图：仅父 principal 可控自己 start 的子 runtime；other 拒绝。
 */
import {
  assertRuntimeWriteAccess,
  attachChildCapabilityRef,
  releaseRuntimeReservation,
  reserveChildForStart,
  resetRuntimeReservationsForTests,
} from "@main/adapters/cli/local-control/capability-hot-path.ts";
import { createCapabilityAuthority } from "@main/services/capability/authority.ts";
import { describe, expect, it } from "vitest";

describe("CA relation hot path", () => {
  it("owner can control child runtime; other principal denied", () => {
    resetRuntimeReservationsForTests();
    const ca = createCapabilityAuthority({ maxActiveChildren: 4 });
    const parent = "human:peer";
    const other = "human:other-peer";
    const reserved = reserveChildForStart({
      authority: ca,
      principalRef: parent,
    });
    expect(reserved && "childRef" in reserved).toBe(true);
    if (!(reserved && "childRef" in reserved)) {
      return;
    }
    attachChildCapabilityRef(
      {
        runtime: { bootId: "b", runtimeId: "rt-1", generation: 1 },
        panelId: "p1",
        windowId: "w1",
        agentId: "codex",
      },
      reserved
    );

    expect(
      assertRuntimeWriteAccess({
        authority: ca,
        principalRef: parent,
        targetRuntimeId: "rt-1",
      }).ok
    ).toBe(true);

    const foreign = assertRuntimeWriteAccess({
      authority: ca,
      principalRef: other,
      targetRuntimeId: "rt-1",
    });
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) {
      expect(foreign.code).toBe("permission_denied");
    }

    releaseRuntimeReservation({ authority: ca, runtimeId: "rt-1" });
  });

  it("cli-human unknown runtime keeps self escape for UI-launched", () => {
    resetRuntimeReservationsForTests();
    const ca = createCapabilityAuthority();
    expect(
      assertRuntimeWriteAccess({
        authority: ca,
        principalRef: "human:peer",
        targetRuntimeId: "ui-launched-panel",
      }).ok
    ).toBe(true);
  });
});
