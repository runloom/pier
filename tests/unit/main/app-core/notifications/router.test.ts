/**
 * W5：notifications envelope schema + authorize 薄回归（不拉起全 command-router 图）。
 */
import { authorizeCommand } from "@main/app-core/permissions.ts";
import { pierCommandEnvelopeSchema } from "@shared/contracts/commands.ts";
import { DEFAULT_CAPABILITIES_BY_CLIENT_KIND } from "@shared/contracts/permissions.ts";
import { describe, expect, it } from "vitest";

function envelope(command: Record<string, unknown>, clientId = "cli-local") {
  return {
    protocolVersion: 1 as const,
    requestId: "req-ncs",
    clientId,
    command,
  };
}

describe("notifications schema + authorize (W5 hardening)", () => {
  it("accepts list for cli-local capabilities", () => {
    const parsed = pierCommandEnvelopeSchema.safeParse(
      envelope({ type: "notifications.list" })
    );
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      return;
    }
    const client = {
      id: "cli-local",
      kind: "cli-local" as const,
      capabilities: [...DEFAULT_CAPABILITIES_BY_CLIENT_KIND["cli-local"]],
      createdAt: 1,
      lastSeenAt: 1,
    };
    expect(authorizeCommand(parsed.data.command, client).ok).toBe(true);
  });

  it("rejects mark-read with neither id nor all", () => {
    const parsed = pierCommandEnvelopeSchema.safeParse(
      envelope({ type: "notifications.mark-read" })
    );
    expect(parsed.success).toBe(false);
  });

  it("rejects mark-read with both id and all", () => {
    const parsed = pierCommandEnvelopeSchema.safeParse(
      envelope({
        type: "notifications.mark-read",
        id: "n1",
        all: true,
      })
    );
    expect(parsed.success).toBe(false);
  });

  it("denies mark-read without notification:write", () => {
    const parsed = pierCommandEnvelopeSchema.safeParse(
      envelope({ type: "notifications.mark-read", id: "n1" })
    );
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      return;
    }
    const client = {
      id: "cli-ro",
      kind: "cli-local" as const,
      capabilities: ["notification:read" as const],
      createdAt: 1,
      lastSeenAt: 1,
    };
    const auth = authorizeCommand(parsed.data.command, client);
    expect(auth.ok).toBe(false);
  });

  it("accepts mark-read with id for full cli-local caps", () => {
    const parsed = pierCommandEnvelopeSchema.safeParse(
      envelope({ type: "notifications.mark-read", id: "n1" })
    );
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      return;
    }
    const client = {
      id: "cli-local",
      kind: "cli-local" as const,
      capabilities: [...DEFAULT_CAPABILITIES_BY_CLIENT_KIND["cli-local"]],
      createdAt: 1,
      lastSeenAt: 1,
    };
    expect(authorizeCommand(parsed.data.command, client).ok).toBe(true);
  });
});
