import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClaudeAccountsService } from "../../../packages/plugin-claude/src/main/accounts-service.ts";
import type { ClaudeAccountsService } from "../../../packages/plugin-claude/src/main/accounts-service-contract.ts";
import type { ClaudeAccountProvider } from "../../../packages/plugin-claude/src/main/claude-provider.ts";
import type { AccountIdentity } from "../../../packages/plugin-claude/src/main/identity.ts";
import type { FetchImpl } from "../../../packages/plugin-claude/src/main/oauth.ts";
import { createClaudeAccountsStateStore } from "../../../packages/plugin-claude/src/main/state.ts";

let dir = "";
const services: ClaudeAccountsService[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pier-claude-service-"));
});

afterEach(async () => {
  for (const service of services.splice(0)) {
    service.dispose();
  }
  await rm(dir, { force: true, recursive: true });
});

const IDENTITY_A: AccountIdentity = {
  email: "a@example.com",
  providerAccountId: "uuid-a",
  subscriptionType: "max",
};
const IDENTITY_B: AccountIdentity = {
  email: "b@example.com",
  providerAccountId: "uuid-b",
  subscriptionType: "pro",
};

/**
 * Fake provider backed by an in-memory "active store" identity so switch /
 * adopt / drift / oauth login can be exercised without a real Keychain, CLI,
 * or network.
 */
function createFakeProvider(initialCurrent: AccountIdentity | null = null) {
  const stored = new Map<string, AccountIdentity>();
  const envelopes = new Map<string, string>();
  let current: AccountIdentity | null = initialCurrent;
  let currentEnvelope: string | null = null;
  const provider: ClaudeAccountProvider = {
    deleteCredential: vi.fn(async (homeDir: string) => {
      stored.delete(homeDir);
      envelopes.delete(homeDir);
    }),
    detectApiKeyMode: vi.fn(async () => false),
    readCurrentCredentialRaw: vi.fn(async () => currentEnvelope),
    importAccount: vi.fn(
      async (
        homeDir: string,
        envelope: string,
        oauthAccount: Record<string, unknown>
      ) => {
        envelopes.set(homeDir, envelope);
        stored.set(homeDir, {
          email: String(oauthAccount.emailAddress),
          providerAccountId: String(oauthAccount.accountUuid),
        });
      }
    ),
    materialize: vi.fn(async (homeDir: string) => {
      const identity = stored.get(homeDir);
      if (!identity) throw new Error("No stored Claude credential");
      current = identity;
    }),
    readCurrentIdentity: vi.fn(async () => current),
    readIdentity: vi.fn(async (homeDir: string) => stored.get(homeDir) ?? null),
    readManagedCredentialRaw: vi.fn(
      async (homeDir: string) => envelopes.get(homeDir) ?? null
    ),
    syncBack: vi.fn(async (homeDir: string, expected: string | undefined) => {
      if (!current) return "no-login" as const;
      if (expected !== undefined && current.providerAccountId !== expected) {
        return "identity-mismatch" as const;
      }
      stored.set(homeDir, current);
      return "ok" as const;
    }),
    watchExternalAuth: vi.fn(() => () => undefined),
    writeCurrentCredentialRaw: vi.fn(async (envelope: string) => {
      currentEnvelope = envelope;
    }),
    writeManagedCredentialRaw: vi.fn(
      async (homeDir: string, envelope: string) => {
        envelopes.set(homeDir, envelope);
      }
    ),
  };
  return {
    envelopes,
    provider,
    setCurrent: (identity: AccountIdentity | null) => {
      current = identity;
    },
    getCurrent: () => current,
  };
}

function makeService(
  provider: ClaudeAccountProvider,
  fetchImpl?: FetchImpl
): ClaudeAccountsService {
  const service = createClaudeAccountsService({
    ...(fetchImpl ? { fetchImpl } : {}),
    // Keep tests off the network: polling never fires without a lease.
    hasVisibleTarget: () => false,
    managedBaseDir: join(dir, "managed"),
    onChanged: vi.fn(),
    provider,
    stateStore: createClaudeAccountsStateStore(join(dir, "accounts.json")),
  });
  services.push(service);
  return service;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

/** Fetch stub serving the OAuth token, profile, and usage endpoints. */
function oauthFetchStub(profile: { email: string; uuid: string }): FetchImpl {
  return vi.fn(async (url: string) => {
    if (url.includes("/v1/oauth/token")) {
      return jsonResponse({
        access_token: "at-1",
        expires_in: 3600,
        refresh_token: "rt-1",
        scope: "user:inference",
      });
    }
    if (url.includes("/api/oauth/profile")) {
      return jsonResponse({
        account: { email_address: profile.email, uuid: profile.uuid },
        subscriptionType: "max",
      });
    }
    return jsonResponse({ five_hour: { utilization: 5 } });
  });
}

describe("pier.claude accounts service", () => {
  it("imports the current login on init when state is empty", async () => {
    const { provider } = createFakeProvider(IDENTITY_A);
    const service = makeService(provider);
    await service.init();
    const snapshot = service.snapshot();
    expect(snapshot.accounts).toHaveLength(1);
    expect(snapshot.accounts[0]).toMatchObject({
      email: "a@example.com",
      status: "active",
      subscription: { planType: "max" },
    });
    expect(snapshot.activeAccountId).toBe(snapshot.accounts[0]?.id);
  });

  it("adds a second account by importing after an external login", async () => {
    const fake = createFakeProvider(IDENTITY_A);
    const service = makeService(fake.provider);
    await service.init();
    // User logs in as B with the Claude CLI, then imports.
    fake.setCurrent(IDENTITY_B);
    await service.add({ kind: "import" });
    const snapshot = service.snapshot();
    expect(snapshot.accounts).toHaveLength(2);
    const active = snapshot.accounts.find(
      (a) => a.id === snapshot.activeAccountId
    );
    expect(active?.email).toBe("b@example.com");
  });

  it("adds an account through the browser OAuth flow", async () => {
    const fake = createFakeProvider(IDENTITY_A);
    const fetchImpl = oauthFetchStub({
      email: "b@example.com",
      uuid: "uuid-b",
    });
    const service = makeService(fake.provider, fetchImpl);
    await service.init();

    await service.add({ kind: "oauth" });
    const pending = service.snapshot();
    expect(pending.login?.authorizeUrl).toContain(
      "https://claude.ai/oauth/authorize"
    );

    await service.completeLogin({ code: "auth-code#state" });
    const snapshot = service.snapshot();
    expect(snapshot.login).toBeNull();
    expect(snapshot.accounts).toHaveLength(2);
    const active = snapshot.accounts.find(
      (a) => a.id === snapshot.activeAccountId
    );
    expect(active?.email).toBe("b@example.com");
    expect(fake.getCurrent()?.providerAccountId).toBe("uuid-b");
  });

  it("re-logging in a known account updates it instead of duplicating", async () => {
    const fake = createFakeProvider(IDENTITY_A);
    const fetchImpl = oauthFetchStub({
      email: "a@example.com",
      uuid: "uuid-a",
    });
    const service = makeService(fake.provider, fetchImpl);
    await service.init();

    await service.add({ kind: "oauth" });
    await service.completeLogin({ code: "auth-code" });
    expect(service.snapshot().accounts).toHaveLength(1);
  });

  it("keeps the login session alive after a bad code so the user can retry", async () => {
    const fake = createFakeProvider(null);
    const fetchImpl: FetchImpl = vi.fn(async () =>
      jsonResponse({ error: "invalid_grant" }, 400)
    );
    const service = makeService(fake.provider, fetchImpl);
    await service.init();

    await service.add({ kind: "oauth" });
    await expect(service.completeLogin({ code: "bad-code" })).rejects.toThrow();
    const snapshot = service.snapshot();
    expect(snapshot.login).not.toBeNull();
    expect(snapshot.lastActionError?.message).toBeTruthy();
    expect(snapshot.accounts).toHaveLength(0);
  });

  it("cancelLogin clears the pending session", async () => {
    const fake = createFakeProvider(null);
    const service = makeService(fake.provider);
    await service.init();
    await service.add({ kind: "oauth" });
    expect(service.snapshot().login).not.toBeNull();
    await service.cancelLogin();
    expect(service.snapshot().login).toBeNull();
    await expect(service.completeLogin({ code: "late" })).rejects.toThrow(
      /No Claude login in progress/
    );
  });

  it("switches the active account by materializing the stored credential", async () => {
    const fake = createFakeProvider(IDENTITY_A);
    const service = makeService(fake.provider);
    await service.init();
    fake.setCurrent(IDENTITY_B);
    await service.add({ kind: "import" });

    const snap = service.snapshot();
    const accountA = snap.accounts.find((a) => a.email === "a@example.com");
    expect(accountA).toBeTruthy();
    await service.select({ accountId: accountA!.id });

    expect(fake.getCurrent()?.providerAccountId).toBe("uuid-a");
    expect(service.snapshot().activeAccountId).toBe(accountA!.id);
  });

  it("removes the active account and clears the selection", async () => {
    const fake = createFakeProvider(IDENTITY_A);
    const service = makeService(fake.provider);
    await service.init();
    const activeId = service.snapshot().activeAccountId;
    expect(activeId).toBeTruthy();

    await service.remove({ accountId: activeId! });
    const after = service.snapshot();
    expect(after.accounts).toHaveLength(0);
    expect(after.activeAccountId).toBeNull();
    // The CLI's live login is untouched — only the managed copy is deleted.
    expect(fake.provider.deleteCredential).toHaveBeenCalled();
    expect(fake.getCurrent()?.providerAccountId).toBe("uuid-a");
  });

  it("removes a non-active account", async () => {
    const fake = createFakeProvider(IDENTITY_A);
    const service = makeService(fake.provider);
    await service.init();
    fake.setCurrent(IDENTITY_B);
    await service.add({ kind: "import" });

    const snap = service.snapshot();
    const accountA = snap.accounts.find((a) => a.email === "a@example.com");
    await service.remove({ accountId: accountA!.id });
    const after = service.snapshot();
    expect(after.accounts).toHaveLength(1);
    expect(after.accounts[0]?.email).toBe("b@example.com");
  });

  it("surfaces a failed import via lastActionError without throwing activation", async () => {
    const { provider } = createFakeProvider(null);
    const service = makeService(provider);
    await service.init();
    // No current login → import fails.
    await expect(service.add({ kind: "import" })).rejects.toThrow(
      /No valid Claude login/
    );
    expect(service.snapshot().lastActionError?.message).toMatch(
      /No valid Claude login/
    );
  });

  it("rolls back a failed oauth add: no ghost row, secret deleted, active restored", async () => {
    const fake = createFakeProvider(IDENTITY_A);
    fake.provider.importAccount = vi.fn(async () => {
      throw new Error("secrets store unavailable");
    });
    const fetchImpl = oauthFetchStub({
      email: "b@example.com",
      uuid: "uuid-b",
    });
    const service = makeService(fake.provider, fetchImpl);
    await service.init();
    const previousActive = service.snapshot().activeAccountId;

    await service.add({ kind: "oauth" });
    await expect(service.completeLogin({ code: "auth-code" })).rejects.toThrow(
      /re-authorize in the browser/
    );

    const snapshot = service.snapshot();
    expect(snapshot.accounts).toHaveLength(1);
    expect(snapshot.activeAccountId).toBe(previousActive);
    expect(fake.provider.deleteCredential).toHaveBeenCalled();
    // Post-exchange failure consumed the code: session restarts with a
    // fresh authorize URL instead of inviting a doomed retry.
    expect(snapshot.login).not.toBeNull();
  });

  it("restarts the session with a new authorize URL after a post-exchange failure", async () => {
    const fake = createFakeProvider(null);
    let profileCalls = 0;
    const fetchImpl: FetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/v1/oauth/token")) {
        return jsonResponse({
          access_token: "at-1",
          expires_in: 3600,
          refresh_token: "rt-1",
        });
      }
      profileCalls += 1;
      return jsonResponse({ error: "boom" }, 500);
    });
    const service = makeService(fake.provider, fetchImpl);
    await service.init();

    await service.add({ kind: "oauth" });
    const firstUrl = service.snapshot().login?.authorizeUrl;
    await expect(service.completeLogin({ code: "auth-code" })).rejects.toThrow(
      /re-authorize/
    );
    const secondUrl = service.snapshot().login?.authorizeUrl;
    expect(profileCalls).toBe(1);
    expect(secondUrl).toBeTruthy();
    expect(secondUrl).not.toBe(firstUrl);
  });

  it("cancelLogin aborts an in-flight completeLogin without recording an error", async () => {
    const fake = createFakeProvider(null);
    const fetchImpl: FetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const abortError = () => {
            const error = new Error("The operation was aborted");
            error.name = "AbortError";
            reject(error);
          };
          // Real fetch rejects immediately on a pre-aborted signal.
          if (init?.signal?.aborted) {
            abortError();
            return;
          }
          init?.signal?.addEventListener("abort", abortError);
        })
    );
    const service = makeService(fake.provider, fetchImpl);
    await service.init();

    await service.add({ kind: "oauth" });
    const completing = service.completeLogin({ code: "auth-code" });
    const cancelling = service.cancelLogin();
    await expect(completing).rejects.toThrow();
    await cancelling;

    const snapshot = service.snapshot();
    expect(snapshot.login).toBeNull();
    expect(snapshot.lastActionError ?? null).toBeNull();
  });

  it("persists rotated tokens to the managed store during usage refresh", async () => {
    const fake = createFakeProvider(IDENTITY_A);
    let usageCalls = 0;
    const fetchImpl: FetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/v1/oauth/token")) {
        return jsonResponse({
          access_token: "at-2",
          expires_in: 3600,
          refresh_token: "rt-2",
        });
      }
      usageCalls += 1;
      if (usageCalls === 1) {
        return jsonResponse({}, 401);
      }
      return jsonResponse({ five_hour: { utilization: 9 } });
    });
    const service = makeService(fake.provider, fetchImpl);
    await service.init();
    const accountId = service.snapshot().activeAccountId ?? "";
    const homeDir = join(dir, "managed", "claude", accountId);
    fake.envelopes.set(
      homeDir,
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "at-1",
          expiresAt: Date.now() + 3_600_000,
          refreshToken: "rt-1",
        },
      })
    );

    await service.refreshUsage({ force: true });
    expect(service.snapshot().activeUsage?.status).toBe("ok");
    const rotated = JSON.parse(fake.envelopes.get(homeDir) ?? "{}");
    expect(rotated.claudeAiOauth).toMatchObject({
      accessToken: "at-2",
      refreshToken: "rt-2",
    });
    // Active account: rotated envelope is mirrored to the live store too.
    expect(fake.provider.writeCurrentCredentialRaw).toHaveBeenCalled();
  });

  it("keeps last-good usage windows when a later refresh fails", async () => {
    const fake = createFakeProvider(IDENTITY_A);
    let call = 0;
    const fetchImpl: FetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/v1/oauth/token")) {
        return jsonResponse({}, 400);
      }
      call += 1;
      if (call === 1) {
        return jsonResponse({ five_hour: { utilization: 42 } });
      }
      return jsonResponse({}, 429);
    });
    const service = makeService(fake.provider, fetchImpl);
    await service.init();
    const accountId = service.snapshot().activeAccountId ?? "";
    fake.envelopes.set(
      join(dir, "managed", "claude", accountId),
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "at-1",
          expiresAt: Date.now() + 3_600_000,
        },
      })
    );

    await service.refreshUsage({ force: true });
    expect(service.snapshot().activeUsage?.status).toBe("ok");
    await service.refreshUsage({ force: true });
    const usage = service.snapshot().activeUsage;
    expect(usage?.status).toBe("error");
    // Last-good meters retained instead of blanking the dashboard.
    expect(usage?.windows[0]).toMatchObject({ usedPercent: 42 });
  });

  it("re-detects API-key mode on drift and broadcasts only on change", async () => {
    let apiKeyMode = false;
    const driftCallbacks: Array<() => void> = [];
    const fake = createFakeProvider(IDENTITY_A);
    fake.provider.detectApiKeyMode = vi.fn(async () => apiKeyMode);
    fake.provider.watchExternalAuth = vi.fn((cb: () => void) => {
      driftCallbacks.push(cb);
      return () => undefined;
    });
    const onChanged = vi.fn();
    const service = createClaudeAccountsService({
      hasVisibleTarget: () => false,
      managedBaseDir: join(dir, "managed"),
      onChanged,
      provider: fake.provider,
      stateStore: createClaudeAccountsStateStore(join(dir, "accounts.json")),
    });
    services.push(service);
    await service.init();
    expect(service.snapshot().apiKeyModeDetected).toBe(false);

    apiKeyMode = true;
    for (const callback of driftCallbacks) {
      callback();
    }
    await vi.waitFor(() => {
      expect(
        onChanged.mock.calls.some(
          ([snapshot]) => snapshot.apiKeyModeDetected === true
        )
      ).toBe(true);
    });
    expect(service.snapshot().apiKeyModeDetected).toBe(true);
  });

  it("expires a stale login session by TTL", async () => {
    const fake = createFakeProvider(null);
    const service = makeService(fake.provider);
    await service.init();
    await service.add({ kind: "oauth" });
    expect(service.snapshot().login).not.toBeNull();

    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 31 * 60 * 1000);
      expect(service.snapshot().login).toBeNull();
      await expect(service.completeLogin({ code: "late" })).rejects.toThrow(
        /No Claude login in progress/
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("refreshUsage reads the managed envelope and caches the parsed windows", async () => {
    const fake = createFakeProvider(IDENTITY_A);
    const fetchImpl = oauthFetchStub({
      email: "a@example.com",
      uuid: "uuid-a",
    });
    const service = makeService(fake.provider, fetchImpl);
    await service.init();
    const accountId = service.snapshot().activeAccountId;
    fake.envelopes.set(
      join(dir, "managed", "claude", accountId ?? ""),
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "at-1",
          expiresAt: Date.now() + 3_600_000,
          refreshToken: "rt-1",
        },
      })
    );

    await service.refreshUsage({ force: true });
    const usage = service.snapshot().activeUsage;
    expect(usage?.status).toBe("ok");
    expect(usage?.windows[0]).toMatchObject({
      limitId: "session",
      usedPercent: 5,
    });
  });
});
