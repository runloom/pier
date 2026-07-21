import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClaudeProvider } from "../../../packages/plugin-claude/src/main/claude-provider.ts";
import { createFileBackend } from "../../../packages/plugin-claude/src/main/credential-store.ts";
import {
  type ManagedClaudeCredential,
  serializeManagedCredential,
} from "../../../packages/plugin-claude/src/main/identity.ts";

const OAUTH_ACCOUNT = {
  accountUuid: "uuid-a",
  emailAddress: "a@example.com",
  organizationName: "Acme",
};

const CREDENTIAL_ENVELOPE = JSON.stringify({
  claudeAiOauth: {
    accessToken: "access-a",
    refreshToken: "refresh-a",
    subscriptionType: "max",
  },
});

const MANAGED: ManagedClaudeCredential = {
  credential: CREDENTIAL_ENVELOPE,
  oauthAccount: OAUTH_ACCOUNT,
};

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pier-claude-provider-"));
});

afterEach(async () => {
  await rm(dir, { force: true, recursive: true });
});

function memoryCredentials() {
  const values = new Map<string, string>();
  return {
    delete: vi.fn(async (key: string) => {
      values.delete(key);
    }),
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    values,
  };
}

async function writeActiveLogin(
  credentialsFilePath: string,
  claudeJsonPath: string
): Promise<void> {
  await mkdir(dirname(credentialsFilePath), { recursive: true });
  await mkdir(dirname(claudeJsonPath), { recursive: true });
  await writeFile(credentialsFilePath, CREDENTIAL_ENVELOPE, { mode: 0o600 });
  await writeFile(
    claudeJsonPath,
    JSON.stringify({ oauthAccount: OAUTH_ACCOUNT, theme: "dark" }),
    { mode: 0o600 }
  );
}

describe("pier.claude provider", () => {
  it("materializes a managed credential into the active file backend and oauthAccount", async () => {
    const credentials = memoryCredentials();
    const managedHome = join(dir, "runtime-homes", "claude", "account-a");
    const credentialsFilePath = join(dir, "active", ".credentials.json");
    const claudeJsonPath = join(dir, "active", ".claude.json");
    credentials.values.set(
      "accounts/account-a/credential",
      serializeManagedCredential(MANAGED)
    );

    const provider = createClaudeProvider({
      backend: createFileBackend(credentialsFilePath),
      claudeJsonPath,
      credentials,
      credentialsFilePath,
    });

    await provider.materialize(managedHome);
    await expect(readFile(credentialsFilePath, "utf8")).resolves.toBe(
      CREDENTIAL_ENVELOPE
    );
    const claudeJson = JSON.parse(await readFile(claudeJsonPath, "utf8"));
    expect(claudeJson.oauthAccount).toEqual(OAUTH_ACCOUNT);
    await expect(provider.readCurrentIdentity()).resolves.toMatchObject({
      email: "a@example.com",
      providerAccountId: "uuid-a",
      subscriptionType: "max",
    });
  });

  it("syncBack captures the current login into managed storage", async () => {
    const credentials = memoryCredentials();
    const managedHome = join(dir, "runtime-homes", "claude", "account-a");
    const credentialsFilePath = join(dir, "active", ".credentials.json");
    const claudeJsonPath = join(dir, "active", ".claude.json");
    await writeActiveLogin(credentialsFilePath, claudeJsonPath);

    const provider = createClaudeProvider({
      backend: createFileBackend(credentialsFilePath),
      claudeJsonPath,
      credentials,
      credentialsFilePath,
    });

    await expect(provider.syncBack(managedHome, "uuid-a")).resolves.toBe("ok");
    const stored = credentials.values.get("accounts/account-a/credential");
    expect(stored).toBeTruthy();
    expect(JSON.parse(stored ?? "")).toMatchObject({
      credential: CREDENTIAL_ENVELOPE,
      oauthAccount: OAUTH_ACCOUNT,
    });
  });

  it("rejects syncBack on identity mismatch and missing login", async () => {
    const credentials = memoryCredentials();
    const managedHome = join(dir, "runtime-homes", "claude", "account-a");
    const credentialsFilePath = join(dir, "active", ".credentials.json");
    const claudeJsonPath = join(dir, "active", ".claude.json");
    const provider = createClaudeProvider({
      backend: createFileBackend(credentialsFilePath),
      claudeJsonPath,
      credentials,
      credentialsFilePath,
    });

    await expect(provider.syncBack(managedHome, "uuid-a")).resolves.toBe(
      "no-login"
    );

    await writeActiveLogin(credentialsFilePath, claudeJsonPath);
    await expect(provider.syncBack(managedHome, "other-uuid")).resolves.toBe(
      "identity-mismatch"
    );
    expect(credentials.values.has("accounts/account-a/credential")).toBe(false);
  });

  it("restores the previous credential when the oauthAccount write fails mid-materialize", async () => {
    const credentials = memoryCredentials();
    const managedHome = join(dir, "runtime-homes", "claude", "account-a");
    const credentialsFilePath = join(dir, "active", ".credentials.json");
    // Point .claude.json at a path whose parent is a FILE so the second
    // write fails after the credential store write succeeded.
    const blockedParent = join(dir, "blocked");
    await writeFile(blockedParent, "not a directory");
    const claudeJsonPath = join(blockedParent, "nested", ".claude.json");
    credentials.values.set(
      "accounts/account-a/credential",
      serializeManagedCredential(MANAGED)
    );

    const provider = createClaudeProvider({
      backend: createFileBackend(credentialsFilePath),
      claudeJsonPath,
      credentials,
      credentialsFilePath,
    });
    await mkdir(dirname(credentialsFilePath), { recursive: true });
    await writeFile(credentialsFilePath, "previous-credential", {
      mode: 0o600,
    });

    await expect(provider.materialize(managedHome)).rejects.toThrow();
    // Torn write rolled back: the active store still holds the old envelope.
    await expect(readFile(credentialsFilePath, "utf8")).resolves.toBe(
      "previous-credential"
    );
  });

  it("returns no identity when the store holds non-OAuth content despite a cached oauthAccount", async () => {
    // API-key-mode installs can leave a stale oauthAccount in ~/.claude.json
    // while the credential store holds no usable claude.ai OAuth envelope —
    // trusting the cache would surface the wrong account.
    const credentials = memoryCredentials();
    const credentialsFilePath = join(dir, "active", ".credentials.json");
    const claudeJsonPath = join(dir, "active", ".claude.json");
    await mkdir(dirname(credentialsFilePath), { recursive: true });
    await writeFile(credentialsFilePath, '{"somethingElse":true}', {
      mode: 0o600,
    });
    await writeFile(
      claudeJsonPath,
      JSON.stringify({ oauthAccount: OAUTH_ACCOUNT }),
      { mode: 0o600 }
    );
    const provider = createClaudeProvider({
      backend: createFileBackend(credentialsFilePath),
      claudeJsonPath,
      credentials,
      credentialsFilePath,
    });
    await expect(provider.readCurrentIdentity()).resolves.toBeNull();
  });

  it("returns no identity for an expired envelope without a refresh token", async () => {
    const credentials = memoryCredentials();
    const credentialsFilePath = join(dir, "active", ".credentials.json");
    const claudeJsonPath = join(dir, "active", ".claude.json");
    await mkdir(dirname(credentialsFilePath), { recursive: true });
    await writeFile(
      credentialsFilePath,
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "dead",
          expiresAt: Date.now() - 1000,
        },
      }),
      { mode: 0o600 }
    );
    await writeFile(
      claudeJsonPath,
      JSON.stringify({ oauthAccount: OAUTH_ACCOUNT }),
      { mode: 0o600 }
    );
    const provider = createClaudeProvider({
      backend: createFileBackend(credentialsFilePath),
      claudeJsonPath,
      credentials,
      credentialsFilePath,
    });
    await expect(provider.readCurrentIdentity()).resolves.toBeNull();
  });

  it("detects API-key mode from the hydrated env and primaryApiKey", async () => {
    const credentials = memoryCredentials();
    const credentialsFilePath = join(dir, "active", ".credentials.json");
    const claudeJsonPath = join(dir, "active", ".claude.json");
    await mkdir(dirname(claudeJsonPath), { recursive: true });

    const envProvider = createClaudeProvider({
      backend: createFileBackend(credentialsFilePath),
      claudeJsonPath,
      credentials,
      credentialsFilePath,
      processEnv: { ANTHROPIC_API_KEY: "sk-ant-xxx" },
    });
    await expect(envProvider.detectApiKeyMode()).resolves.toBe(true);

    await writeFile(
      claudeJsonPath,
      JSON.stringify({ primaryApiKey: "sk-ant-yyy" }),
      { mode: 0o600 }
    );
    const fileProvider = createClaudeProvider({
      backend: createFileBackend(credentialsFilePath),
      claudeJsonPath,
      credentials,
      credentialsFilePath,
      processEnv: {},
    });
    await expect(fileProvider.detectApiKeyMode()).resolves.toBe(true);

    await writeFile(claudeJsonPath, JSON.stringify({}), { mode: 0o600 });
    await expect(fileProvider.detectApiKeyMode()).resolves.toBe(false);
  });

  it("deleteCredential removes only the managed secret copy", async () => {
    const credentials = memoryCredentials();
    const managedHome = join(dir, "runtime-homes", "claude", "account-a");
    credentials.values.set(
      "accounts/account-a/credential",
      serializeManagedCredential(MANAGED)
    );
    const provider = createClaudeProvider({
      backend: createFileBackend(join(dir, ".credentials.json")),
      claudeJsonPath: join(dir, ".claude.json"),
      credentials,
    });

    await provider.deleteCredential(managedHome);
    expect(credentials.values.has("accounts/account-a/credential")).toBe(false);
    expect(existsSync(join(dir, ".credentials.json"))).toBe(false);
  });
});
