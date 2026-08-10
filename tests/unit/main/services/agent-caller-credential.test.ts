import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAgentCallerCredentialFile } from "@main/services/agent-caller/credential-file.ts";
import {
  createAgentCallerCredentialStore,
  resolveAgentCredential,
} from "@main/services/agent-caller/credential-store.ts";
import type { AgentCallerCredentialMaterial } from "@shared/contracts/local-control/agent-credential.ts";
import { describe, expect, it } from "vitest";

function sampleMaterial(
  over: Partial<AgentCallerCredentialMaterial> = {}
): AgentCallerCredentialMaterial {
  return {
    credentialId: "cred_1",
    bootId: "boot_1",
    callerRuntimeId: "rt_1",
    callerGeneration: 0,
    grantId: "grant_1",
    parentClauseId: "clause_1",
    allowedAgents: ["codex"],
    operations: ["agents.self", "agents.catalog"],
    maxDepth: 2,
    maxActiveChildren: 3,
    expiresAt: Date.now() + 60_000,
    worktreeKey: "/tmp/proj",
    incarnationId: "inc_1",
    secret: "s3cret",
    ...over,
  };
}

describe("agent caller credential store", () => {
  it("resolves valid credential for boot with secret", () => {
    const store = createAgentCallerCredentialStore();
    store.put(sampleMaterial());
    const result = resolveAgentCredential({
      store,
      credentialId: "cred_1",
      secret: "s3cret",
      expectedBootId: "boot_1",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects wrong secret, unknown, wrong boot, expired", () => {
    const store = createAgentCallerCredentialStore();
    store.put(sampleMaterial());
    expect(
      resolveAgentCredential({
        store,
        credentialId: "cred_1",
        secret: "wrong",
        expectedBootId: "boot_1",
      }).ok
    ).toBe(false);

    store.put(sampleMaterial({ expiresAt: Date.now() - 1 }));
    expect(
      resolveAgentCredential({
        store,
        credentialId: "missing",
        secret: "s3cret",
        expectedBootId: "boot_1",
      }).ok
    ).toBe(false);
    store.put(
      sampleMaterial({ credentialId: "c2", bootId: "other", secret: "s3cret" })
    );
    expect(
      resolveAgentCredential({
        store,
        credentialId: "c2",
        secret: "s3cret",
        expectedBootId: "boot_1",
      }).ok
    ).toBe(false);
    expect(
      resolveAgentCredential({
        store,
        credentialId: "cred_1",
        secret: "s3cret",
        expectedBootId: "boot_1",
      }).ok
    ).toBe(false);
  });
});

describe("loadAgentCallerCredentialFile", () => {
  it("loads owner-only file", () => {
    if (process.platform === "win32") {
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), "pier-cred-"));
    const file = join(dir, "cred.json");
    const material = sampleMaterial();
    writeFileSync(file, JSON.stringify(material), { mode: 0o600 });
    chmodSync(file, 0o600);
    const loaded = loadAgentCallerCredentialFile(file);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.material.credentialId).toBe("cred_1");
      expect(loaded.material.secret).toBe("s3cret");
    }
  });

  it("rejects world-readable credential file", () => {
    if (process.platform === "win32") {
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), "pier-cred-open-"));
    const file = join(dir, "cred.json");
    writeFileSync(file, JSON.stringify(sampleMaterial()), { mode: 0o644 });
    chmodSync(file, 0o644);
    const loaded = loadAgentCallerCredentialFile(file);
    expect(loaded.ok).toBe(false);
  });
});

describe("issueAgentCallerCredential exclusive write", () => {
  it("refuses to overwrite an existing credential path", async () => {
    const { issueAgentCallerCredential, writeCredentialFileExclusive } =
      await import("@main/services/agent-caller/issue-credential.ts");
    const dir = mkdtempSync(join(tmpdir(), "pier-issue-"));
    const store = createAgentCallerCredentialStore();
    const once = issueAgentCallerCredential({
      store,
      bootId: "boot_x",
      directory: dir,
    });
    expect(() =>
      writeCredentialFileExclusive(once.credentialFilePath, "{}")
    ).toThrow();
  });
});
