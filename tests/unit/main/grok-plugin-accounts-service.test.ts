import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGrokAccountsService } from "../../../packages/plugin-grok/src/main/accounts-service.ts";
import type { GrokAccountProvider } from "../../../packages/plugin-grok/src/main/grok-provider.ts";
import { createGrokProvider } from "../../../packages/plugin-grok/src/main/grok-provider.ts";
import type { AccountIdentity } from "../../../packages/plugin-grok/src/main/identity.ts";
import { createGrokAccountsStateStore } from "../../../packages/plugin-grok/src/main/state.ts";

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pier-grok-plugin-accounts-"));
});

afterEach(async () => {
  await rm(dir, { force: true, recursive: true });
});

const OIDC_IDENTITY: AccountIdentity = {
  authEntryKey: "https://auth.x.ai::test-client",
  email: "user@example.com",
  kind: "oidc",
  providerAccountId: "user-1",
  teamId: "team-1",
};

function createProvider(
  overrides: Partial<GrokAccountProvider> = {}
): GrokAccountProvider {
  const apiKeys = new Map<string, string>();
  return {
    id: "grok",
    deleteApiKey: vi.fn(async (accountId: string) => {
      apiKeys.delete(accountId);
    }),
    deleteCredential: vi.fn(async () => undefined),
    fetchUsage: vi.fn(async () => ({ status: "ok" as const, windows: [] })),
    login: vi.fn(async () => undefined),
    materializeApiKey: vi.fn(async () => undefined),
    materializeEmptyAuth: vi.fn(async () => undefined),
    materializeOidc: vi.fn(async () => undefined),
    moveCredential: vi.fn(async () => undefined),
    readApiKey: vi.fn(
      async (accountId: string) => apiKeys.get(accountId) ?? null
    ),
    readCurrentAuthContent: vi.fn(async () => null),
    readCurrentIdentity: vi.fn(async () => null),
    readIdentity: vi.fn(async () => OIDC_IDENTITY),
    readManagedAuthContent: vi.fn(async () => "{}"),
    restoreCurrentAuthContent: vi.fn(async () => undefined),
    storeApiKey: vi.fn(async (accountId: string, apiKey: string) => {
      apiKeys.set(accountId, apiKey);
    }),
    syncBack: vi.fn(async () => "ok" as const),
    watchExternalAuth: vi.fn(() => () => undefined),
    writeCurrentAuthContent: vi.fn(async () => undefined),
    writeManagedAuthContent: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("pier.grok accounts service", () => {
  it("adds an oidc account via mocked spawn login and activates when empty", async () => {
    const stateFile = join(dir, "accounts.json");
    const provider = createProvider({
      login: vi.fn(async () => undefined),
      readIdentity: vi.fn(async () => OIDC_IDENTITY),
    });
    const service = createGrokAccountsService({
      managedBaseDir: join(dir, "managed"),
      onChanged: vi.fn(),
      provider,
      stateStore: createGrokAccountsStateStore(stateFile),
    });
    await service.init();
    await service.add({ kind: "oidc", mode: "oauth" });
    const snapshot = service.snapshot();
    expect(snapshot.accounts).toHaveLength(1);
    expect(snapshot.accounts[0]).toMatchObject({
      email: "user@example.com",
      kind: "oidc",
      label: "user@example.com",
      status: "active",
    });
    expect(snapshot.activeAccountId).toBe(snapshot.accounts[0]?.id);
    expect(provider.materializeOidc).toHaveBeenCalled();
  });

  it("adds an api_key account and materializes empty auth when no active", async () => {
    const stateFile = join(dir, "accounts.json");
    const provider = createProvider();
    const service = createGrokAccountsService({
      managedBaseDir: join(dir, "managed"),
      onChanged: vi.fn(),
      provider,
      stateStore: createGrokAccountsStateStore(stateFile),
    });
    await service.init();
    await service.add({
      apiKey: "  xai-secret  ",
      kind: "api_key",
      label: "Work",
    });
    const snapshot = service.snapshot();
    expect(snapshot.accounts).toHaveLength(1);
    expect(snapshot.accounts[0]).toMatchObject({
      kind: "api_key",
      label: "Work",
      status: "active",
    });
    expect(provider.storeApiKey).toHaveBeenCalledWith(
      snapshot.accounts[0]?.id,
      "xai-secret"
    );
    expect(provider.materializeEmptyAuth).toHaveBeenCalled();
  });

  it("select switches materialize kind between oidc and api_key", async () => {
    const realHome = join(dir, "real-grok");
    await mkdir(realHome, { recursive: true });
    const values = new Map<string, string>();
    const credentials = {
      delete: vi.fn(async (key: string) => {
        values.delete(key);
      }),
      get: vi.fn(async (key: string) => values.get(key) ?? null),
      set: vi.fn(async (key: string, value: string) => {
        values.set(key, value);
      }),
    };
    const provider = createGrokProvider({
      credentials,
      realGrokHome: realHome,
      spawnLogin: async (_cmd, _args, opts) => {
        const home = opts.env.GROK_HOME;
        if (!home) throw new Error("missing GROK_HOME");
        await writeFile(
          join(home, "auth.json"),
          JSON.stringify({
            "https://auth.x.ai::test-client": {
              auth_mode: "oidc",
              create_time: "2026-01-01T00:00:00.000Z",
              email: "user@example.com",
              refresh_token: "r",
              user_id: "user-1",
            },
          }),
          { mode: 0o600 }
        );
      },
    });
    const service = createGrokAccountsService({
      managedBaseDir: join(dir, "managed"),
      onChanged: vi.fn(),
      provider,
      stateStore: createGrokAccountsStateStore(join(dir, "accounts.json")),
    });
    await service.init();
    await service.add({ kind: "oidc", mode: "oauth" });
    await service.add({ apiKey: "xai-key", kind: "api_key" });
    const snap = service.snapshot();
    const oidcId = snap.accounts.find((a) => a.kind === "oidc")?.id;
    const apiId = snap.accounts.find((a) => a.kind === "api_key")?.id;
    expect(oidcId && apiId).toBeTruthy();
    await service.select({ accountId: apiId! });
    await expect(readFile(join(realHome, "auth.json"), "utf8")).resolves.toBe(
      "{}"
    );
    await service.select({ accountId: oidcId! });
    const auth = await readFile(join(realHome, "auth.json"), "utf8");
    expect(auth).toContain("user@example.com");
  });

  it("rejects removing the active account", async () => {
    const stateFile = join(dir, "accounts.json");
    await writeFile(
      stateFile,
      JSON.stringify({
        accounts: [
          {
            createdAt: 1,
            email: "user@example.com",
            id: "active-1",
            kind: "oidc",
            provider: "grok",
            providerAccountId: "user-1",
            updatedAt: 1,
          },
        ],
        activeAccountId: "active-1",
        revision: 1,
        schemaVersion: 1,
      }),
      "utf8"
    );
    const service = createGrokAccountsService({
      managedBaseDir: join(dir, "managed"),
      onChanged: vi.fn(),
      provider: createProvider({
        readCurrentIdentity: vi.fn(async () => OIDC_IDENTITY),
        readIdentity: vi.fn(async () => OIDC_IDENTITY),
      }),
      stateStore: createGrokAccountsStateStore(stateFile),
    });
    await service.init();
    await expect(service.remove({ accountId: "active-1" })).rejects.toThrow(
      "Cannot remove active account — select another first"
    );
  });

  it("adopts current real-home identity when state is empty", async () => {
    const service = createGrokAccountsService({
      managedBaseDir: join(dir, "managed"),
      onChanged: vi.fn(),
      provider: createProvider({
        readCurrentIdentity: vi.fn(async () => OIDC_IDENTITY),
      }),
      stateStore: createGrokAccountsStateStore(join(dir, "accounts.json")),
    });
    await service.init();
    const snapshot = service.snapshot();
    expect(snapshot.accounts).toHaveLength(1);
    expect(snapshot.activeAccountId).toBe(snapshot.accounts[0]?.id);
    expect(snapshot.accounts[0]?.email).toBe("user@example.com");
  });
});
