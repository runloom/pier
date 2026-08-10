import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAgentCallerCredentialFile } from "@main/services/agent-caller/credential-file.ts";
import {
  createAgentCallerCredentialStore,
  resolveAgentBinding,
  resolveAgentCredential,
} from "@main/services/agent-caller/credential-store.ts";
import type { AgentCallerCredentialMaterial } from "@shared/contracts/local-control/agent-credential.ts";
import { describe, expect, it } from "vitest";

function sampleMaterial(
  over: Partial<AgentCallerCredentialMaterial> = {}
): AgentCallerCredentialMaterial {
  return {
    credentialId: "bind_1",
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
    ...over,
  };
}

describe("agent caller binding store", () => {
  it("resolves binding by id without secret (default path)", () => {
    const store = createAgentCallerCredentialStore();
    store.put(sampleMaterial());
    const result = resolveAgentBinding({
      store,
      bindingId: "bind_1",
      expectedBootId: "boot_1",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects unknown, wrong boot, expired binding", () => {
    const store = createAgentCallerCredentialStore();
    store.put(sampleMaterial({ expiresAt: Date.now() - 1 }));
    expect(
      resolveAgentBinding({
        store,
        bindingId: "missing",
        expectedBootId: "boot_1",
      }).ok
    ).toBe(false);
    store.put(sampleMaterial({ credentialId: "c2", bootId: "other" }));
    expect(
      resolveAgentBinding({
        store,
        bindingId: "c2",
        expectedBootId: "boot_1",
      }).ok
    ).toBe(false);
    expect(
      resolveAgentBinding({
        store,
        bindingId: "bind_1",
        expectedBootId: "boot_1",
      }).ok
    ).toBe(false);
  });

  it("optional secret path requires matching secret", () => {
    const store = createAgentCallerCredentialStore();
    store.put(sampleMaterial({ secret: "s3cret" }));
    expect(
      resolveAgentCredential({
        store,
        credentialId: "bind_1",
        secret: "s3cret",
        expectedBootId: "boot_1",
      }).ok
    ).toBe(true);
    expect(
      resolveAgentCredential({
        store,
        credentialId: "bind_1",
        secret: "wrong",
        expectedBootId: "boot_1",
      }).ok
    ).toBe(false);
    // binding without secret cannot use agent-credential
    store.put(sampleMaterial({ credentialId: "bind_ns" }));
    expect(
      resolveAgentCredential({
        store,
        credentialId: "bind_ns",
        secret: "anything",
        expectedBootId: "boot_1",
      }).ok
    ).toBe(false);
  });
});

describe("loadAgentCallerCredentialFile", () => {
  it("loads owner-only file (secret optional)", () => {
    if (process.platform === "win32") {
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), "pier-cred-"));
    const file = join(dir, "cred.json");
    const material = sampleMaterial({ secret: "s3cret" });
    writeFileSync(file, JSON.stringify(material), { mode: 0o600 });
    chmodSync(file, 0o600);
    const loaded = loadAgentCallerCredentialFile(file);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.material.credentialId).toBe("bind_1");
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

describe("issueAgentCallerCredential binding-first", () => {
  it("default: memory + env binding, no secret, no file", async () => {
    const { issueAgentCallerCredential } = await import(
      "@main/services/agent-caller/issue-credential.ts"
    );
    const store = createAgentCallerCredentialStore();
    const once = issueAgentCallerCredential({
      store,
      bootId: "boot_x",
    });
    expect(once.material.credentialId.startsWith("bind_")).toBe(true);
    expect(once.material.secret).toBeUndefined();
    expect(once.credentialFilePath).toBeUndefined();
    expect(once.env.PIER_AGENT_CALLER_BINDING).toBe(once.material.credentialId);
    expect(once.env.PIER_AGENT_CALLER_CREDENTIAL_FILE).toBeUndefined();
    expect(store.get(once.material.credentialId)).toBeTruthy();
  });

  it("writeFile exclusive refuses overwrite", async () => {
    const { issueAgentCallerCredential, writeCredentialFileExclusive } =
      await import("@main/services/agent-caller/issue-credential.ts");
    const dir = mkdtempSync(join(tmpdir(), "pier-issue-"));
    const store = createAgentCallerCredentialStore();
    const once = issueAgentCallerCredential({
      store,
      bootId: "boot_x",
      directory: dir,
      writeFile: true,
    });
    expect(once.credentialFilePath).toBeTruthy();
    expect(() =>
      writeCredentialFileExclusive(once.credentialFilePath as string, "{}")
    ).toThrow();
  });
});
