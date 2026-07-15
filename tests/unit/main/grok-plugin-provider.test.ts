import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
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

  it("round-trips managed and current auth content", async () => {
    const credentials = memoryCredentials();
    const managedHome = join(dir, "runtime-homes", "grok", "account-a");
    const realHome = join(dir, "real-grok");
    const provider = createGrokProvider({
      credentials,
      realGrokHome: realHome,
    });

    await mkdir(managedHome, { recursive: true });
    credentials.values.set("accounts/account-a/auth", "original-managed-auth");
    await writeFile(join(managedHome, "auth.json"), "legacy-auth");
    await provider.writeManagedAuthContent(managedHome, AUTH);
    await expect(provider.readManagedAuthContent(managedHome)).resolves.toBe(
      AUTH
    );
    expect(credentials.values.get("accounts/account-a/auth")).toBe(AUTH);
    expect(existsSync(join(managedHome, "auth.json"))).toBe(false);

    await mkdir(realHome, { recursive: true });
    await writeFile(join(realHome, "auth.json"), "original-auth", {
      mode: 0o644,
    });
    await expect(provider.readCurrentAuthContent()).resolves.toBe(
      "original-auth"
    );
    await provider.writeCurrentAuthContent(AUTH);
    await expect(provider.readCurrentAuthContent()).resolves.toBe(AUTH);
    expect((await stat(join(realHome, "auth.json"))).mode % 0o1000).toBe(0o600);
  });

  it("returns null for missing current auth and null removes it", async () => {
    const credentials = memoryCredentials();
    const realHome = join(dir, "real-grok");
    const provider = createGrokProvider({
      credentials,
      realGrokHome: realHome,
    });

    await expect(provider.readCurrentAuthContent()).resolves.toBeNull();
    await provider.writeCurrentAuthContent(AUTH);
    expect(existsSync(join(realHome, "auth.json"))).toBe(true);
    await provider.writeCurrentAuthContent(null);
    await expect(provider.readCurrentAuthContent()).resolves.toBeNull();
    expect(existsSync(join(realHome, "auth.json"))).toBe(false);
  });

  it("restores current auth when it still matches the expected content", async () => {
    const realHome = join(dir, "real-grok");
    const provider = createGrokProvider({
      credentials: memoryCredentials(),
      realGrokHome: realHome,
    });
    await provider.writeCurrentAuthContent("new-auth-secret");

    await provider.restoreCurrentAuthContent({
      expectedCurrent: "new-auth-secret",
      previousContent: "previous-auth-secret",
    });

    await expect(provider.readCurrentAuthContent()).resolves.toBe(
      "previous-auth-secret"
    );
    expect((await stat(join(realHome, "auth.json"))).mode % 0o1000).toBe(0o600);
  });

  it("does not rewrite current auth when it already matches previous content", async () => {
    const realHome = join(dir, "real-grok");
    const provider = createGrokProvider({
      credentials: memoryCredentials(),
      realGrokHome: realHome,
    });
    await provider.writeCurrentAuthContent("previous-auth-secret");
    const before = await stat(join(realHome, "auth.json"));

    await provider.restoreCurrentAuthContent({
      expectedCurrent: "new-auth-secret",
      previousContent: "previous-auth-secret",
    });

    const after = await stat(join(realHome, "auth.json"));
    await expect(provider.readCurrentAuthContent()).resolves.toBe(
      "previous-auth-secret"
    );
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it("rejects conflicting current-auth restore without exposing or overwriting auth", async () => {
    const realHome = join(dir, "real-grok");
    const provider = createGrokProvider({
      credentials: memoryCredentials(),
      realGrokHome: realHome,
    });
    await provider.writeCurrentAuthContent("concurrent-auth-secret");

    const restore = provider.restoreCurrentAuthContent({
      expectedCurrent: "new-auth-secret",
      previousContent: "previous-auth-secret",
    });

    await expect(restore).rejects.toThrow("Current Grok auth changed");
    const error = await restore.catch((caught: unknown) => caught);
    expect(String(error)).not.toContain("concurrent-auth-secret");
    expect(String(error)).not.toContain("new-auth-secret");
    expect(String(error)).not.toContain("previous-auth-secret");
    await expect(provider.readCurrentAuthContent()).resolves.toBe(
      "concurrent-auth-secret"
    );
  });

  it("propagates non-ENOENT errors when reading current auth", async () => {
    const realHome = join(dir, "real-grok");
    await mkdir(join(realHome, "auth.json"), { recursive: true });
    const provider = createGrokProvider({
      credentials: memoryCredentials(),
      realGrokHome: realHome,
    });

    await expect(provider.readCurrentAuthContent()).rejects.toMatchObject({
      code: "EISDIR",
    });
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
