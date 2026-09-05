import type { PierCoreServices } from "@main/app-core/command-router-services.ts";
import { executeGitCommand } from "@main/app-core/commands/git.ts";
import { authorizeCommand } from "@main/app-core/permissions.ts";
import { createGitService } from "@main/services/git/service.ts";
import { pierCommandSchema } from "@shared/contracts/commands.ts";
import type { PierClient } from "@shared/contracts/permissions.ts";
import { describe, expect, it, vi } from "vitest";
import {
  commitFile,
  makeBaselineRepo,
} from "../../../../support/git-file-baseline.ts";

describe("file baseline command contract", () => {
  it("serves the typed baseline without pulsing a git mutation", async () => {
    const root = await makeBaselineRepo();
    const headOid = await commitFile(root);
    const command = pierCommandSchema.parse({
      type: "git.getFileBaseline",
      root,
      path: "file.txt",
    });
    const pulse = vi.fn();
    const services = {
      git: createGitService(),
      gitWatch: { pulse },
    } as unknown as PierCoreServices;
    expect(
      await executeGitCommand("baseline-1", command, services)
    ).toMatchObject({
      ok: true,
      requestId: "baseline-1",
      data: {
        status: "ready",
        headOid,
        contents: "at HEAD\n",
        existsAtHead: true,
      },
    });
    expect(pulse).not.toHaveBeenCalled();
  });

  it("requires git:read and rejects attempts to choose an index/ref baseline", () => {
    const input = {
      type: "git.getFileBaseline",
      root: "/repo",
      path: "file.txt",
    };
    const command = pierCommandSchema.parse(input);
    const client: PierClient = {
      id: "test",
      kind: "desktop-renderer",
      createdAt: 0,
      lastSeenAt: 0,
      capabilities: [],
    };
    expect(authorizeCommand(command, client)).toEqual({
      ok: false,
      reason: "missing capability: git:read",
    });
    expect(
      authorizeCommand(command, { ...client, capabilities: ["git:read"] })
    ).toEqual({ ok: true });
    expect(pierCommandSchema.safeParse({ ...input, ref: ":0" }).success).toBe(
      false
    );
    expect(
      pierCommandSchema.safeParse({ ...input, path: "file\0.txt" }).success
    ).toBe(false);
  });
});
