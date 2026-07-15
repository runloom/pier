import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGrokProvider } from "../../../packages/plugin-grok/src/main/grok-provider.ts";

const AUTH = JSON.stringify({
  "https://auth.x.ai::test-client": {
    auth_mode: "oidc",
    create_time: "2026-01-01T00:00:00.000Z",
    email: "user@example.com",
    refresh_token: "refresh-token",
    team_id: "team-1",
    user_id: "user-1",
  },
});

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pier-grok-provider-"));
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

describe("pier.grok provider", () => {
  it("login stores managed auth and materializeOidc writes real home", async () => {
    const credentials = memoryCredentials();
    const managedHome = join(dir, "runtime-homes", "grok", "account-a");
    const realHome = join(dir, "real-grok");
    await mkdir(managedHome, { recursive: true });
    const provider = createGrokProvider({
      credentials,
      realGrokHome: realHome,
      spawnLogin: async (_cmd, args, opts) => {
        expect(args).toEqual(["login", "--oauth"]);
        expect(opts.env.GROK_HOME).toBe(managedHome);
        await writeFile(join(managedHome, "auth.json"), AUTH, { mode: 0o600 });
      },
    });

    await provider.login(managedHome, new AbortController().signal, "oauth");
    await expect(provider.readIdentity(managedHome)).resolves.toMatchObject({
      email: "user@example.com",
      providerAccountId: "user-1",
    });
    expect(existsSync(join(managedHome, "auth.json"))).toBe(false);
    expect(credentials.values.get("accounts/account-a/auth")).toBe(AUTH);

    await provider.materializeOidc(managedHome);
    await expect(readFile(join(realHome, "auth.json"), "utf8")).resolves.toBe(
      AUTH
    );
  });

  it("materializeEmptyAuth writes empty auth object", async () => {
    const credentials = memoryCredentials();
    const realHome = join(dir, "real-grok");
    const provider = createGrokProvider({
      credentials,
      realGrokHome: realHome,
    });
    await provider.materializeEmptyAuth();
    await expect(readFile(join(realHome, "auth.json"), "utf8")).resolves.toBe(
      "{}"
    );
  });

  it("stores and deletes API keys under accounts/<id>/api-key", async () => {
    const credentials = memoryCredentials();
    const provider = createGrokProvider({
      credentials,
      realGrokHome: join(dir, "real-grok"),
    });
    await provider.storeApiKey("acct-1", "xai-test-key");
    await expect(provider.readApiKey("acct-1")).resolves.toBe("xai-test-key");
    expect(credentials.values.get("accounts/acct-1/api-key")).toBe(
      "xai-test-key"
    );
    await provider.deleteApiKey("acct-1");
    await expect(provider.readApiKey("acct-1")).resolves.toBeNull();
  });

  it("login with device mode uses --device-auth", async () => {
    const credentials = memoryCredentials();
    const managedHome = join(dir, "runtime-homes", "grok", "account-b");
    await mkdir(managedHome, { recursive: true });
    const spawnLogin = vi.fn(async (_cmd, args) => {
      expect(args).toEqual(["login", "--device-auth"]);
      await writeFile(join(managedHome, "auth.json"), AUTH, { mode: 0o600 });
    });
    const provider = createGrokProvider({
      credentials,
      realGrokHome: join(dir, "real-grok"),
      spawnLogin,
    });
    await provider.login(managedHome, new AbortController().signal, "device");
    expect(spawnLogin).toHaveBeenCalledOnce();
  });
});
