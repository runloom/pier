import {
  LSP_MAX_MESSAGE_BYTES,
  lspPolicyPrefsSchema,
  lspSessionClosedEventSchema,
  lspSessionEnsureRequestSchema,
  lspSessionMessageEventSchema,
  lspSessionSendRequestSchema,
} from "@shared/contracts/lsp.ts";
import { describe, expect, it } from "vitest";

describe("LSP contracts", () => {
  it("does not expose an unreachable per-workspace enable override", () => {
    const request = lspSessionEnsureRequestSchema.parse({
      explicitEnable: true,
      rootPath: "/repo/worktree",
    });

    expect(request).not.toHaveProperty("explicitEnable");
  });

  it("selects providers from file paths without a legacy language discriminator", () => {
    const request = lspSessionEnsureRequestSchema.parse({
      filePath: "/repo/main.py",
      rootPath: "/repo",
    });

    expect(request).not.toHaveProperty("language");
  });

  it("validates idle release time within one minute and one day", () => {
    expect(
      lspPolicyPrefsSchema.safeParse({ idleReleaseMs: 59_999 }).success
    ).toBe(false);
    expect(
      lspPolicyPrefsSchema.safeParse({ idleReleaseMs: 60_000 }).success
    ).toBe(true);
    expect(
      lspPolicyPrefsSchema.safeParse({ idleReleaseMs: 86_400_000 }).success
    ).toBe(true);
    expect(
      lspPolicyPrefsSchema.safeParse({ idleReleaseMs: 86_400_001 }).success
    ).toBe(false);
  });

  it("enforces the shared UTF-8 message byte limit in both directions", () => {
    expect(LSP_MAX_MESSAGE_BYTES).toBe(4 * 1024 * 1024);
    const atLimit = `${"a".repeat(LSP_MAX_MESSAGE_BYTES - 2)}é`;
    const overLimit = `${atLimit}a`;

    expect(Buffer.byteLength(atLimit, "utf8")).toBe(LSP_MAX_MESSAGE_BYTES);
    expect(Buffer.byteLength(overLimit, "utf8")).toBe(
      LSP_MAX_MESSAGE_BYTES + 1
    );
    expect(overLimit.length).toBeLessThanOrEqual(LSP_MAX_MESSAGE_BYTES);

    for (const schema of [
      lspSessionSendRequestSchema,
      lspSessionMessageEventSchema,
    ]) {
      expect(
        schema.safeParse({ message: atLimit, sessionId: "session-1" }).success
      ).toBe(true);
      expect(
        schema.safeParse({ message: overLimit, sessionId: "session-1" }).success
      ).toBe(false);
    }
  });

  it("discriminates requested close causes from abnormal termination", () => {
    const causes = [
      "client-release",
      "policy-disabled",
      "workspace-evicted",
      "idle-release",
      "owner-destroyed",
      "app-quit",
    ] as const;

    for (const cause of causes) {
      const event = lspSessionClosedEventSchema.parse({
        cause,
        reason: "closed",
        sessionId: "session-1",
      });
      expect(event).toEqual({
        cause,
        reason: "closed",
        sessionId: "session-1",
      });
      if (event.reason !== "closed") {
        throw new Error(`Expected a closed event, received ${event.reason}`);
      }
      const narrowedCause: (typeof causes)[number] = event.cause;
      expect(narrowedCause).toBe(cause);
    }

    for (const reason of ["exited", "failed"] as const) {
      const event = lspSessionClosedEventSchema.parse({
        reason,
        sessionId: "session-1",
      });
      expect(event).toEqual({ reason, sessionId: "session-1" });
      expect(event.reason).toBe(reason);
    }

    expect(
      lspSessionClosedEventSchema.safeParse({
        reason: "closed",
        sessionId: "session-1",
      }).success
    ).toBe(false);
    expect(
      lspSessionClosedEventSchema.safeParse({
        cause: "unexpected",
        reason: "closed",
        sessionId: "session-1",
      }).success
    ).toBe(false);
  });
});
