import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCodexAccountsService } from "../../../packages/plugin-codex/src/main/accounts-service.ts";
import { createCodexProvider } from "../../../packages/plugin-codex/src/main/codex-provider.ts";
import { createCodexAccountsStateStore } from "../../../packages/plugin-codex/src/main/state.ts";

let dir = "";

function authJson(email = "managed@example.com"): string {
  const claims = Buffer.from(
    JSON.stringify({
      email,
      "https://api.openai.com/auth": { chatgpt_account_id: "acct-1" },
    })
  ).toString("base64url");
  return JSON.stringify({ tokens: { id_token: `header.${claims}.signature` } });
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pier-codex-credentials-"));
});

afterEach(async () => {
  await rm(dir, { force: true, recursive: true });
});

describe("pier.codex credential lifecycle", () => {
  it("moves managed auth into scoped secrets and materializes only on demand", async () => {
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
    const managedHome = join(dir, "runtime-homes", "codex", "account-a");
    const realHome = join(dir, "real-codex");
    await mkdir(managedHome, { recursive: true });
    await writeFile(join(managedHome, "auth.json"), authJson(), {
      mode: 0o600,
    });
    const provider = createCodexProvider({
      credentials,
      realCodexHome: realHome,
    });

    await expect(provider.readIdentity(managedHome)).resolves.toMatchObject({
      email: "managed@example.com",
      providerAccountId: "acct-1",
    });
    expect(existsSync(join(managedHome, "auth.json"))).toBe(false);
    expect([...values.values()]).toEqual([authJson()]);

    await provider.materialize(managedHome);
    await expect(readFile(join(realHome, "auth.json"), "utf8")).resolves.toBe(
      authJson()
    );
    expect(existsSync(join(managedHome, "auth.json"))).toBe(false);
  });

  it("serializes concurrent identity reads while migrating auth into secrets", async () => {
    const values = new Map<string, string>();
    const managedHome = join(dir, "runtime-homes", "codex", "account-a");
    await mkdir(managedHome, { recursive: true });
    await writeFile(join(managedHome, "auth.json"), authJson(), {
      mode: 0o600,
    });
    const provider = createCodexProvider({
      credentials: {
        delete: vi.fn(async (key: string) => {
          values.delete(key);
        }),
        get: vi.fn(async (key: string) => values.get(key) ?? null),
        set: vi.fn(async (key: string, value: string) => {
          values.set(key, value);
        }),
      },
      realCodexHome: join(dir, "real-codex"),
    });

    const identities = await Promise.all([
      provider.readIdentity(managedHome),
      provider.readIdentity(managedHome),
    ]);
    expect(identities).toEqual([
      expect.objectContaining({ providerAccountId: "acct-1" }),
      expect.objectContaining({ providerAccountId: "acct-1" }),
    ]);
    expect(existsSync(join(managedHome, "auth.json"))).toBe(false);
  });

  it("fails closed when secure storage rejects a login credential", async () => {
    const managedBaseDir = join(dir, "runtime-homes");
    const provider = createCodexProvider({
      credentials: {
        delete: vi.fn(async () => undefined),
        get: vi.fn(async () => null),
        set: vi.fn(async () => {
          throw new Error("secure storage is unavailable");
        }),
      },
      realCodexHome: join(dir, "real-codex"),
      spawnLogin: vi.fn(async (_cmd, _args, options) => {
        const home = options.env.CODEX_HOME;
        if (!home) {
          throw new Error("CODEX_HOME missing");
        }
        await mkdir(home, { recursive: true });
        await writeFile(join(home, "auth.json"), authJson(), { mode: 0o600 });
      }),
    });
    provider.fetchUsage = vi.fn(async () => ({ status: "ok" as const }));
    provider.watchExternalAuth = vi.fn(() => () => undefined);
    const stateStore = createCodexAccountsStateStore(
      join(dir, "accounts.json"),
      "1.0.3"
    );
    const service = createCodexAccountsService({
      managedBaseDir,
      onChanged: vi.fn(),
      provider,
      stateStore,
    });
    await service.init();

    await expect(service.add({})).rejects.toThrow(
      "secure storage is unavailable"
    );
    expect(stateStore.get().accounts).toEqual([]);
    const files = await readdir(dir, { recursive: true });
    expect(files.filter((path) => path.endsWith("auth.json"))).toEqual([]);
    const persistedState = await readFile(
      join(dir, "accounts.json"),
      "utf8"
    ).catch(() => "");
    expect(persistedState).not.toContain("tokens");
    service.dispose();
  });
});
