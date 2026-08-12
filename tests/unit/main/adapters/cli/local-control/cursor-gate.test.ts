/**
 * W6-S5：资源 cursor 门禁（T-C1..C3 镜像）。
 */

import { controlWatchParamsSchema } from "@shared/contracts/local-control/control-snapshot.ts";
import {
  CONTROL_CURSOR_SCOPE_GLOBAL,
  CONTROL_CURSOR_SCOPE_NOTIFICATIONS,
  CONTROL_CURSOR_SCOPE_RESOURCE_AGENTS,
} from "@shared/contracts/local-control/cursor.ts";
import { describe, expect, it } from "vitest";
import { assertCursorResume } from "../../../../../../src/main/adapters/cli/local-control/cursor-gate.ts";

const BOOT = "boot-alpha";
const BOOT_OTHER = "boot-beta";

describe("assertCursorResume (W6-S5)", () => {
  it("T-C1: no after → snapshot mode at session boot", () => {
    const r = assertCursorResume({
      after: undefined,
      sessionBootId: BOOT,
      expectedScope: CONTROL_CURSOR_SCOPE_GLOBAL,
    });
    expect(r).toEqual({
      ok: true,
      revision: -1,
      scope: CONTROL_CURSOR_SCOPE_GLOBAL,
      bootId: BOOT,
      mode: "snapshot",
    });
  });

  it("T-C1: number after → resume with session boot + expected scope", () => {
    const r = assertCursorResume({
      after: 7,
      sessionBootId: BOOT,
      expectedScope: CONTROL_CURSOR_SCOPE_GLOBAL,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.mode).toBe("resume");
    expect(r.revision).toBe(7);
    expect(r.bootId).toBe(BOOT);
    expect(r.scope).toBe(CONTROL_CURSOR_SCOPE_GLOBAL);
  });

  it("T-C2: wrong boot → snapshot_required (no mix)", () => {
    const r = assertCursorResume({
      after: {
        bootId: BOOT_OTHER,
        revision: 3,
        scope: CONTROL_CURSOR_SCOPE_GLOBAL,
      },
      sessionBootId: BOOT,
      expectedScope: CONTROL_CURSOR_SCOPE_GLOBAL,
    });
    expect(r.ok).toBe(false);
    if (r.ok) {
      return;
    }
    expect(r.code).toBe("snapshot_required");
    expect(r.message).toMatch(/boot_changed/i);
  });

  it("T-C2: below minRetainedRevision → snapshot_required (expired)", () => {
    const r = assertCursorResume({
      after: { bootId: BOOT, revision: 2 },
      sessionBootId: BOOT,
      expectedScope: CONTROL_CURSOR_SCOPE_GLOBAL,
      minRetainedRevision: 10,
    });
    expect(r.ok).toBe(false);
    if (r.ok) {
      return;
    }
    expect(r.code).toBe("snapshot_required");
    expect(r.message).toMatch(/expired/i);
  });

  it("T-C3: notifications cursor must not resume global watch", () => {
    const r = assertCursorResume({
      after: {
        bootId: BOOT,
        revision: 5,
        scope: CONTROL_CURSOR_SCOPE_NOTIFICATIONS,
      },
      sessionBootId: BOOT,
      expectedScope: CONTROL_CURSOR_SCOPE_GLOBAL,
    });
    expect(r.ok).toBe(false);
    if (r.ok) {
      return;
    }
    expect(r.code).toBe("snapshot_required");
    expect(r.message).toMatch(/scope mismatch/i);
  });

  it("T-C3: resource:agents cursor must not resume global", () => {
    const r = assertCursorResume({
      after: {
        bootId: BOOT,
        revision: 1,
        scope: CONTROL_CURSOR_SCOPE_RESOURCE_AGENTS,
      },
      sessionBootId: BOOT,
      expectedScope: CONTROL_CURSOR_SCOPE_GLOBAL,
    });
    expect(r.ok).toBe(false);
    if (r.ok) {
      return;
    }
    expect(r.code).toBe("snapshot_required");
  });

  it("matching structured after → resume", () => {
    const r = assertCursorResume({
      after: {
        bootId: BOOT,
        revision: 12,
        scope: CONTROL_CURSOR_SCOPE_GLOBAL,
      },
      sessionBootId: BOOT,
      expectedScope: CONTROL_CURSOR_SCOPE_GLOBAL,
    });
    expect(r).toMatchObject({
      ok: true,
      mode: "resume",
      revision: 12,
      bootId: BOOT,
      scope: CONTROL_CURSOR_SCOPE_GLOBAL,
    });
  });
});

describe("controlWatchParamsSchema after (W6-S5)", () => {
  it("accepts legacy number after", () => {
    const p = controlWatchParamsSchema.safeParse({ after: 2, timeoutMs: 1000 });
    expect(p.success).toBe(true);
    if (p.success) {
      expect(p.data.after).toBe(2);
    }
  });

  it("accepts structured after", () => {
    const p = controlWatchParamsSchema.safeParse({
      after: {
        bootId: BOOT,
        revision: 4,
        scope: CONTROL_CURSOR_SCOPE_GLOBAL,
      },
    });
    expect(p.success).toBe(true);
  });

  it("rejects invalid scope enum", () => {
    const p = controlWatchParamsSchema.safeParse({
      after: { revision: 1, scope: "agents" },
    });
    expect(p.success).toBe(false);
  });
});
