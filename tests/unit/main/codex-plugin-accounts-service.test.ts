import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCodexAccountsService } from "../../../packages/plugin-codex/src/main/accounts-service.ts";
import type { AccountIdentity } from "../../../packages/plugin-codex/src/main/identity.ts";
import { createCodexAccountsStateStore } from "../../../packages/plugin-codex/src/main/state.ts";
import type {
  AccountUsageResult,
  AgentAccountProvider,
} from "../../../packages/plugin-codex/src/main/types.ts";

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pier-codex-plugin-accounts-"));
});

afterEach(async () => {
  await rm(dir, { force: true, recursive: true });
});

function createProvider(): AgentAccountProvider {
  return {
    id: "codex",
    fetchUsage: vi.fn(
      async (): Promise<AccountUsageResult> => ({
        status: "ok",
      })
    ),
    login: vi.fn(async () => undefined),
    materialize: vi.fn(async () => undefined),
    readIdentity: vi.fn(
      async (): Promise<AccountIdentity | null> => ({
        email: "current@example.com",
        providerAccountId: "current-provider",
      })
    ),
    syncBack: vi.fn(async () => "ok" as const),
    watchExternalAuth: vi.fn(() => () => undefined),
  };
}

describe("pier.codex accounts service", () => {
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
        readLegacySecretsStoreEntry: async () => null,
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
    expect(provider.readIdentity).not.toHaveBeenCalled();
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
        readLegacySecretsStoreEntry: async () => null,
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
});
