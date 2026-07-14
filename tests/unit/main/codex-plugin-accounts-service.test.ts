import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCodexAccountsService,
  SYSTEM_USAGE_CACHE_KEY,
  USAGE_REFRESH_CONCURRENCY,
} from "../../../packages/plugin-codex/src/main/accounts-service.ts";
import * as crossToolSync from "../../../packages/plugin-codex/src/main/cross-tool-sync.ts";
import type { AccountIdentity } from "../../../packages/plugin-codex/src/main/identity.ts";
import { createCodexAccountsStateStore } from "../../../packages/plugin-codex/src/main/state.ts";
import type {
  AccountUsageResult,
  AgentAccountProvider,
} from "../../../packages/plugin-codex/src/main/types.ts";

vi.mock(
  "../../../packages/plugin-codex/src/main/cross-tool-sync.ts",
  async () => {
    const actual = await vi.importActual<
      typeof import("../../../packages/plugin-codex/src/main/cross-tool-sync.ts")
    >("../../../packages/plugin-codex/src/main/cross-tool-sync.ts");
    return {
      ...actual,
      syncCrossToolCredentials: vi.fn(async () => []),
    };
  }
);

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pier-codex-plugin-accounts-"));
});

afterEach(async () => {
  await rm(dir, { force: true, recursive: true });
});

function createProvider(
  overrides: Partial<AgentAccountProvider> = {}
): AgentAccountProvider {
  return {
    id: "codex",
    fetchUsage: vi.fn(
      async (): Promise<AccountUsageResult> => ({
        status: "ok",
        windows: [],
      })
    ),
    login: vi.fn(async () => undefined),
    materialize: vi.fn(async () => undefined),
    readManagedAuthContent: vi.fn(
      async () =>
        '{"tokens":{"access_token":"x","refresh_token":"y","account_id":"z"}}'
    ),
    readCurrentIdentity: vi.fn(
      async (): Promise<AccountIdentity | null> => ({
        email: "current@example.com",
        providerAccountId: "current-provider",
      })
    ),
    readIdentity: vi.fn(
      async (): Promise<AccountIdentity | null> => ({
        email: "current@example.com",
        providerAccountId: "current-provider",
      })
    ),
    syncBack: vi.fn(async () => "ok" as const),
    watchExternalAuth: vi.fn(() => () => undefined),
    ...overrides,
  };
}

function usageWindow(
  usedPercent: number,
  windowMinutes = 300,
  position: "primary" | "secondary" = "primary"
): AccountUsageResult["windows"][number] {
  return {
    id: `codex:${position}`,
    limitId: "codex",
    usedPercent,
    windowMinutes,
  };
}

async function seedManagedActiveAccount(
  rootDir: string,
  accountId = "managed-active"
): Promise<{
  managedBaseDir: string;
  provider: AgentAccountProvider;
  service: ReturnType<typeof createCodexAccountsService>;
  stateFile: string;
}> {
  const stateFile = join(rootDir, "accounts.json");
  await mkdir(rootDir, { recursive: true });
  await writeFile(
    stateFile,
    JSON.stringify({
      activeAccountId: accountId,
      accounts: [
        {
          createdAt: 1,
          email: "managed@example.com",
          id: accountId,
          provider: "codex",
          providerAccountId: "current-provider",
          updatedAt: 1,
        },
      ],
      revision: 1,
      schemaVersion: 1,
    }),
    "utf8"
  );
  const managedBaseDir = join(rootDir, "managed");
  const provider = createProvider();
  const service = createCodexAccountsService({
    managedBaseDir,
    onChanged: vi.fn(),
    provider,
    stateStore: createCodexAccountsStateStore(stateFile),
  });
  await service.init();
  return { managedBaseDir, provider, service, stateFile };
}

describe("pier.codex accounts service", () => {
  it("rolls back in-memory metadata when add persistence fails", async () => {
    const stateFile = join(dir, "accounts.json");
    const realStore = createCodexAccountsStateStore(stateFile);
    let failNextFlush = false;
    const stateStore = {
      ensureSchemaMarker: () => realStore.ensureSchemaMarker(),
      flush: async () => {
        if (failNextFlush) {
          failNextFlush = false;
          throw new Error("disk unavailable");
        }
        await realStore.flush();
      },
      get: () => realStore.get(),
      init: () => realStore.init(),
      mutate: realStore.mutate,
    };
    const deleteCredential = vi.fn(async () => undefined);
    const provider = createProvider({
      deleteCredential,
      readCurrentIdentity: vi.fn(async () => null),
    });
    const service = createCodexAccountsService({
      managedBaseDir: join(dir, "managed"),
      onChanged: vi.fn(),
      provider,
      stateStore,
    });
    await service.init();
    failNextFlush = true;

    await expect(service.add({})).rejects.toThrow("disk unavailable");
    expect(stateStore.get().accounts).toEqual([]);
    expect(JSON.parse(await readFile(stateFile, "utf8"))).toMatchObject({
      accounts: [],
    });
    expect(deleteCredential).toHaveBeenCalledOnce();
    service.dispose();
  });

  it("persists select and remove mutations before the operation resolves", async () => {
    const stateFile = join(dir, "accounts.json");
    await writeFile(
      stateFile,
      JSON.stringify({
        activeAccountId: "account-1",
        accounts: [
          {
            createdAt: 1,
            id: "account-1",
            provider: "codex",
            providerAccountId: "provider-1",
            updatedAt: 1,
          },
          {
            createdAt: 2,
            id: "account-2",
            provider: "codex",
            providerAccountId: "provider-2",
            updatedAt: 2,
          },
        ],
        revision: 1,
        schemaVersion: 1,
      })
    );
    const provider = createProvider({
      deleteCredential: vi.fn(async () => undefined),
      readCurrentIdentity: vi.fn(async () => null),
      readIdentity: vi.fn(async (homeDir: string) => ({
        email: `${homeDir.split("/").at(-1)}@example.com`,
        providerAccountId: homeDir.endsWith("account-1")
          ? "provider-1"
          : "provider-2",
      })),
    });
    const service = createCodexAccountsService({
      managedBaseDir: join(dir, "managed"),
      onChanged: vi.fn(),
      provider,
      stateStore: createCodexAccountsStateStore(stateFile),
    });
    await service.init();

    await service.select({ accountId: "account-2" });
    expect(JSON.parse(await readFile(stateFile, "utf8"))).toMatchObject({
      activeAccountId: "account-2",
    });
    await service.remove({ accountId: "account-1" });
    expect(JSON.parse(await readFile(stateFile, "utf8"))).toMatchObject({
      accounts: [{ id: "account-2" }],
    });
    service.dispose();
  });

  it("does not delete credentials when remove metadata persistence fails", async () => {
    const stateFile = join(dir, "accounts.json");
    await writeFile(
      stateFile,
      JSON.stringify({
        activeAccountId: "account-1",
        accounts: [
          {
            createdAt: 1,
            id: "account-1",
            provider: "codex",
            providerAccountId: "provider-1",
            updatedAt: 1,
          },
          {
            createdAt: 2,
            id: "account-2",
            provider: "codex",
            providerAccountId: "provider-2",
            updatedAt: 2,
          },
        ],
        revision: 1,
        schemaVersion: 1,
      })
    );
    const realStore = createCodexAccountsStateStore(stateFile);
    let failNextFlush = false;
    const stateStore = {
      ensureSchemaMarker: () => realStore.ensureSchemaMarker(),
      flush: async () => {
        if (failNextFlush) {
          failNextFlush = false;
          throw new Error("disk unavailable");
        }
        await realStore.flush();
      },
      get: () => realStore.get(),
      init: () => realStore.init(),
      mutate: realStore.mutate,
    };
    const deleteCredential = vi.fn(async () => undefined);
    const provider = createProvider({
      deleteCredential,
      readCurrentIdentity: vi.fn(async () => null),
      readIdentity: vi.fn(async (homeDir: string) => ({
        email: "managed@example.com",
        providerAccountId: homeDir.endsWith("account-1")
          ? "provider-1"
          : "provider-2",
      })),
    });
    const service = createCodexAccountsService({
      managedBaseDir: join(dir, "managed"),
      onChanged: vi.fn(),
      provider,
      stateStore,
    });
    await service.init();
    failNextFlush = true;

    await expect(service.remove({ accountId: "account-2" })).rejects.toThrow(
      "disk unavailable"
    );
    expect(stateStore.get().accounts).toHaveLength(2);
    expect(deleteCredential).not.toHaveBeenCalled();
    service.dispose();
  });

  it("migrates legacy Codex accounts before adopting the current ~/.codex identity", async () => {
    const managedBaseDir = join(dir, "managed");
    const stateStore = createCodexAccountsStateStore(
      join(dir, "accounts.json")
    );
    const provider = createProvider();
    const legacyAuthById: Record<string, string> = {
      "legacy-active": '{"tokens":{"id_token":"active"}}',
      "legacy-secondary": '{"tokens":{"id_token":"secondary"}}',
    };
    const service = createCodexAccountsService({
      legacyMigration: {
        legacyAgentAccountsBaseDir: join(dir, "legacy-agent-accounts"),
        legacyAgentAccountsStateFile: join(dir, "agent-accounts.json"),
        readLegacyAuthJson: async (accountId) =>
          legacyAuthById[accountId] ?? null,
        readLegacyStateFile: async () =>
          JSON.stringify({
            activeAccountId: "legacy-secondary",
            accounts: [
              {
                createdAt: 1,
                email: "active@example.com",
                id: "legacy-active",
                planType: "plus",
                provider: "codex",
                providerAccountId: "provider-active",
                updatedAt: 2,
              },
              {
                createdAt: 3,
                email: "secondary@example.com",
                id: "legacy-secondary",
                lastAuthenticatedAt: 4,
                provider: "codex",
                providerAccountId: "provider-secondary",
                updatedAt: 5,
              },
            ],
            version: 1,
          }),
      },
      managedBaseDir,
      onChanged: vi.fn(),
      provider,
      stateStore,
    });

    await service.init();
    service.dispose();

    const snapshot = service.snapshot();
    expect(snapshot.activeAccountId).toBe("legacy-secondary");
    expect(snapshot.accounts.map((account) => account.id)).toEqual([
      "legacy-active",
      "legacy-secondary",
    ]);
    expect(snapshot.accounts.map((account) => account.label)).toEqual([
      "active@example.com",
      "secondary@example.com",
    ]);
    await expect(
      readFile(
        join(managedBaseDir, "codex", "legacy-active", "auth.json"),
        "utf8"
      )
    ).resolves.toBe(legacyAuthById["legacy-active"]);
    await expect(
      readFile(
        join(managedBaseDir, "codex", "legacy-secondary", "auth.json"),
        "utf8"
      )
    ).resolves.toBe(legacyAuthById["legacy-secondary"]);
    expect(provider.readIdentity).toHaveBeenCalledTimes(2);
    expect(provider.readCurrentIdentity).not.toHaveBeenCalled();
  });

  it("does not run legacy migration when plugin-local accounts already exist", async () => {
    const stateFile = join(dir, "accounts.json");
    await mkdir(dir, { recursive: true });
    await writeFile(
      stateFile,
      JSON.stringify({
        activeAccountId: "existing",
        accounts: [
          {
            createdAt: 1,
            email: "existing@example.com",
            id: "existing",
            provider: "codex",
            providerAccountId: "provider-existing",
            updatedAt: 1,
          },
        ],
        revision: 1,
        schemaVersion: 1,
      }),
      "utf8"
    );
    const readLegacyStateFile = vi.fn(async () => null);
    const provider = createProvider();
    const service = createCodexAccountsService({
      legacyMigration: {
        legacyAgentAccountsBaseDir: join(dir, "legacy-agent-accounts"),
        legacyAgentAccountsStateFile: join(dir, "agent-accounts.json"),
        readLegacyAuthJson: async () => null,
        readLegacyStateFile,
      },
      managedBaseDir: join(dir, "managed"),
      onChanged: vi.fn(),
      provider,
      stateStore: createCodexAccountsStateStore(stateFile),
    });

    await service.init();
    service.dispose();

    expect(readLegacyStateFile).not.toHaveBeenCalled();
  });

  it("refreshUsage fetches for system default into activeUsage", async () => {
    const stateFile = join(dir, "accounts.json");
    await mkdir(dir, { recursive: true });
    await writeFile(
      stateFile,
      JSON.stringify({
        activeAccountId: null,
        accounts: [],
        revision: 1,
        schemaVersion: 1,
      }),
      "utf8"
    );
    const provider = createProvider({
      fetchUsage: vi.fn(
        async (): Promise<AccountUsageResult> => ({
          status: "ok",
          windows: [usageWindow(32), usageWindow(12, 10_080, "secondary")],
        })
      ),
      readCurrentIdentity: vi.fn(async () => null),
    });
    const service = createCodexAccountsService({
      managedBaseDir: join(dir, "managed"),
      onChanged: vi.fn(),
      provider,
      stateStore: createCodexAccountsStateStore(stateFile),
    });
    await service.init();

    expect(service.snapshot().activeAccountId).toBeNull();

    await service.refreshUsage({ force: true });

    const snap = service.snapshot();
    expect(snap.activeAccountId).toBeNull();
    expect(snap.activeUsage?.status).toBe("ok");
    expect(
      snap.activeUsage?.windows.map((window) => window.usedPercent)
    ).toEqual([32, 12]);
    expect(provider.fetchUsage).toHaveBeenCalled();
    service.dispose();
  });

  it("activeUsage mirrors managed account usage when one is active", async () => {
    const { provider, service } = await seedManagedActiveAccount(dir);
    vi.mocked(provider.fetchUsage).mockResolvedValue({
      status: "ok",
      windows: [usageWindow(55)],
    });

    await service.refreshUsage({ force: true });

    const snap = service.snapshot();
    const activeAccount = snap.accounts.find(
      (account) => account.id === "managed-active"
    );
    expect(activeAccount?.usage?.windows[0]?.usedPercent).toBe(55);
    expect(snap.activeUsage?.windows[0]?.usedPercent).toBe(55);
    service.dispose();
  });

  it("refreshes a non-active account through its managed CODEX_HOME", async () => {
    const stateFile = join(dir, "accounts.json");
    const managedBaseDir = join(dir, "managed");
    await mkdir(dir, { recursive: true });
    await writeFile(
      stateFile,
      JSON.stringify({
        activeAccountId: "account-1",
        accounts: [
          {
            createdAt: 1,
            email: "active@example.com",
            id: "account-1",
            provider: "codex",
            providerAccountId: "current-provider",
            updatedAt: 1,
          },
          {
            createdAt: 1,
            email: "other@example.com",
            id: "account-2",
            planType: "pro",
            provider: "codex",
            providerAccountId: "other-provider",
            updatedAt: 1,
          },
        ],
        revision: 1,
        schemaVersion: 1,
      }),
      "utf8"
    );
    const provider = createProvider({
      fetchUsage: vi.fn(async () => ({
        status: "ok" as const,
        windows: [usageWindow(42)],
      })),
    });
    const service = createCodexAccountsService({
      managedBaseDir,
      onChanged: vi.fn(),
      provider,
      stateStore: createCodexAccountsStateStore(stateFile),
    });
    await service.init();

    await service.refreshUsage({ accountId: "account-2", force: true });

    expect(provider.fetchUsage).toHaveBeenCalledWith(
      join(managedBaseDir, "codex", "account-2"),
      expect.any(AbortSignal)
    );
    const snapshot = service.snapshot();
    expect(snapshot.activeAccountId).toBe("account-1");
    expect(
      snapshot.accounts.find((account) => account.id === "account-2")?.usage
        ?.windows[0]?.usedPercent
    ).toBe(42);
    expect(
      snapshot.accounts.find((account) => account.id === "account-2")?.planType
    ).toBe("pro");
    service.dispose();
  });

  it("refreshes every managed account with bounded concurrency", async () => {
    const stateFile = join(dir, "accounts.json");
    const managedBaseDir = join(dir, "managed");
    const accounts = Array.from({ length: 5 }, (_, index) => ({
      createdAt: 1,
      email: `account-${index}@example.com`,
      id: `account-${index}`,
      provider: "codex",
      providerAccountId: `provider-${index}`,
      updatedAt: 1,
    }));
    await writeFile(
      stateFile,
      JSON.stringify({
        accounts,
        activeAccountId: "account-0",
        revision: 1,
        schemaVersion: 1,
      }),
      "utf8"
    );
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchUsage = vi.fn(
      async (_accountHomeDir?: string): Promise<AccountUsageResult> => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return { status: "ok", windows: [usageWindow(10)] };
      }
    );
    const service = createCodexAccountsService({
      managedBaseDir,
      onChanged: vi.fn(),
      provider: createProvider({
        fetchUsage,
        readCurrentIdentity: vi.fn(async () => null),
      }),
      stateStore: createCodexAccountsStateStore(stateFile),
    });
    await service.init();
    await service.refreshAllUsage();
    fetchUsage.mockClear();
    await service.refreshAllUsage({ force: true });

    const refreshedHomes = new Set(fetchUsage.mock.calls.map(([home]) => home));
    expect(refreshedHomes).toEqual(
      new Set(
        accounts.map((account) => join(managedBaseDir, "codex", account.id))
      )
    );
    expect(maxInFlight).toBeLessThanOrEqual(USAGE_REFRESH_CONCURRENCY);
    for (const account of service.snapshot().accounts) {
      expect(account.usage?.windows[0]?.usedPercent).toBe(10);
    }
    service.dispose();
  });

  it("does not start quota polling without a visible consumer", async () => {
    const stateFile = join(dir, "accounts.json");
    await writeFile(
      stateFile,
      JSON.stringify({
        accounts: [
          {
            createdAt: 1,
            email: "account@example.com",
            id: "account-1",
            provider: "codex",
            providerAccountId: "provider-1",
            updatedAt: 1,
          },
        ],
        activeAccountId: "account-1",
        revision: 1,
        schemaVersion: 1,
      }),
      "utf8"
    );
    const provider = createProvider({
      readCurrentIdentity: vi.fn(async () => null),
    });
    const service = createCodexAccountsService({
      hasVisibleTarget: () => false,
      managedBaseDir: join(dir, "managed"),
      onChanged: vi.fn(),
      provider,
      stateStore: createCodexAccountsStateStore(stateFile),
    });

    await service.init();

    expect(provider.fetchUsage).not.toHaveBeenCalled();
    service.dispose();
  });

  it("retains the last successful quota when a refresh fails", async () => {
    const { provider, service } = await seedManagedActiveAccount(dir);
    await service.refreshAllUsage();
    vi.mocked(provider.fetchUsage).mockReset();
    vi.mocked(provider.fetchUsage)
      .mockResolvedValueOnce({
        status: "ok",
        windows: [usageWindow(25)],
      })
      .mockResolvedValueOnce({
        error: "token expired",
        status: "error",
        windows: [],
      });

    await service.refreshUsage({ accountId: "managed-active", force: true });
    await service.refreshUsage({ accountId: "managed-active", force: true });

    const usage = service.snapshot().accounts[0]?.usage;
    expect(usage).toMatchObject({
      error: "token expired",
      status: "error",
      windows: [{ usedPercent: 25 }],
    });
    service.dispose();
  });

  it("syncs peer tools from the active account without selecting", async () => {
    const { provider, service, stateFile } =
      await seedManagedActiveAccount(dir);
    const syncCrossToolCredentials = vi.mocked(
      crossToolSync.syncCrossToolCredentials
    );
    syncCrossToolCredentials.mockResolvedValue([
      { ok: true, target: "omp" },
      { ok: true, target: "pi" },
    ]);

    await service.syncToPeers({ syncTargets: ["omp", "pi"] });

    expect(provider.materialize).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(stateFile, "utf8"))).toMatchObject({
      activeAccountId: "managed-active",
    });
    expect(syncCrossToolCredentials).toHaveBeenCalledWith(
      ["omp", "pi"],
      expect.objectContaining({
        accessToken: "x",
        accountId: "z",
        email: "managed@example.com",
        refreshToken: "y",
      }),
      expect.anything()
    );
    service.dispose();
  });

  it("rejects peer sync without an active managed account", async () => {
    const stateFile = join(dir, "accounts.json");
    await writeFile(
      stateFile,
      JSON.stringify({
        activeAccountId: null,
        accounts: [],
        revision: 1,
        schemaVersion: 1,
      }),
      "utf8"
    );
    const service = createCodexAccountsService({
      managedBaseDir: join(dir, "managed"),
      onChanged: vi.fn(),
      provider: createProvider({
        readCurrentIdentity: vi.fn(async () => null),
      }),
      stateStore: createCodexAccountsStateStore(stateFile),
    });
    await service.init();

    await expect(service.syncToPeers({ syncTargets: ["omp"] })).rejects.toThrow(
      /active managed account/i
    );
    service.dispose();
  });

  it("rejects peer sync when no tools are selected", async () => {
    const { service } = await seedManagedActiveAccount(dir);

    await expect(service.syncToPeers({ syncTargets: [] })).rejects.toThrow(
      /at least one/i
    );
    service.dispose();
  });

  it("surfaces peer sync failures to the caller", async () => {
    const { service } = await seedManagedActiveAccount(dir);
    vi.mocked(crossToolSync.syncCrossToolCredentials).mockResolvedValue([
      { error: "db locked", ok: false, target: "omp" },
      { ok: true, target: "pi" },
    ]);

    await expect(
      service.syncToPeers({ syncTargets: ["omp", "pi"] })
    ).rejects.toThrow(/omp: db locked/i);
    service.dispose();
  });

  it("exports SYSTEM_USAGE_CACHE_KEY for system-default usage cache", () => {
    expect(SYSTEM_USAGE_CACHE_KEY).toBe("__system__");
  });
});
