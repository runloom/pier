import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AddOidcAccountHost,
  addOidcAccount,
} from "../../../packages/plugin-grok/src/main/accounts-add-oidc.ts";
import type { GrokAccountProvider } from "../../../packages/plugin-grok/src/main/grok-provider.ts";
import type { AccountIdentity } from "../../../packages/plugin-grok/src/main/identity.ts";
import type {
  GrokAccountsFileState,
  GrokAccountsStateStore,
} from "../../../packages/plugin-grok/src/main/state.ts";

const IDENTITY: AccountIdentity = {
  authEntryKey: "https://auth.x.ai::test-client",
  email: "user@example.com",
  kind: "oidc",
  providerAccountId: "user-1",
  teamId: "team-1",
};

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pier-grok-add-oidc-"));
});

afterEach(async () => {
  await rm(root, { force: true, recursive: true });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createStateStore(
  initial: GrokAccountsFileState,
  flush: () => Promise<void> = async () => undefined
): GrokAccountsStateStore {
  let state = initial;
  return {
    ensureSchemaMarker: vi.fn(async () => undefined),
    flush: vi.fn(flush),
    get: () => state,
    init: vi.fn(async () => state),
    mutate: vi.fn((fn) => {
      state = fn(state);
      return state;
    }),
  };
}

function createProvider(
  overrides: Partial<GrokAccountProvider> = {}
): GrokAccountProvider {
  return {
    id: "grok",
    deleteApiKey: vi.fn(async () => undefined),
    deleteCredential: vi.fn(async () => undefined),
    fetchUsage: vi.fn(async () => ({ status: "ok" as const, windows: [] })),
    login: vi.fn(async () => undefined),
    materializeApiKey: vi.fn(async () => undefined),
    materializeEmptyAuth: vi.fn(async () => undefined),
    materializeOidc: vi.fn(async () => undefined),
    moveCredential: vi.fn(async () => undefined),
    readApiKey: vi.fn(async () => null),
    readCurrentAuthContent: vi.fn(async () => null),
    readCurrentIdentity: vi.fn(async () => null),
    readIdentity: vi.fn(async () => IDENTITY),
    readManagedAuthContent: vi.fn(async () => "new-managed-auth"),
    restoreCurrentAuthContent: vi.fn(async () => undefined),
    storeApiKey: vi.fn(async () => undefined),
    syncBack: vi.fn(async () => "ok" as const),
    watchExternalAuth: vi.fn(() => () => undefined),
    writeCurrentAuthContent: vi.fn(async () => undefined),
    writeManagedAuthContent: vi.fn(async () => undefined),
    ...overrides,
  };
}

function createHost(options: {
  ensureManagedDir?: (accountId: string) => Promise<string>;
  provider?: GrokAccountProvider;
  stateStore?: GrokAccountsStateStore;
}) {
  const ui = {
    abort: null as AbortController | null,
    lastLoginError: null as { at: number; message: string } | null,
    mode: null as "oauth" | "device" | null,
    pending: false,
  };
  const accountHomeDir = (accountId: string) => join(root, accountId);
  const host: AddOidcAccountHost = {
    accountHomeDir,
    doRefreshUsage: vi.fn(async () => undefined),
    emitSnapshot: vi.fn(),
    ensureManagedDir:
      options.ensureManagedDir ??
      (async (accountId) => {
        const dir = accountHomeDir(accountId);
        await mkdir(dir, { recursive: true });
        return dir;
      }),
    now: () => 100,
    provider: options.provider ?? createProvider(),
    setLastLoginError: (error) => {
      ui.lastLoginError = error;
    },
    setLoginAbort: (abort) => {
      ui.abort = abort;
    },
    setLoginMode: (mode) => {
      ui.mode = mode;
    },
    setLoginPending: (pending) => {
      ui.pending = pending;
    },
    setSuppressWatchUntil: vi.fn(),
    stateStore:
      options.stateStore ??
      createStateStore({
        accounts: [],
        activeAccountId: null,
        revision: 0,
        schemaVersion: 1,
      }),
  };
  return { accountHomeDir, host, ui };
}

async function captureRejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error(`Expected Error rejection, received ${String(error)}`);
  }
  throw new Error("Expected promise to reject");
}

describe("addOidcAccount", () => {
  it("publishes cancellation before the managed directory finishes", async () => {
    const directory = deferred<string>();
    const login = vi.fn(async () => undefined);
    const provider = createProvider({ login });
    let pendingAccountId = "";
    const { accountHomeDir, host, ui } = createHost({
      ensureManagedDir: vi.fn(async (accountId) => {
        pendingAccountId = accountId;
        return await directory.promise;
      }),
      provider,
    });

    const adding = addOidcAccount(host, "oauth");
    expect(ui.abort).toBeInstanceOf(AbortController);
    expect(ui.pending).toBe(true);
    await vi.waitFor(() => expect(pendingAccountId).not.toBe(""));
    ui.abort?.abort();
    const managedDir = accountHomeDir(pendingAccountId);
    await mkdir(managedDir, { recursive: true });
    directory.resolve(managedDir);

    const error = await captureRejection(adding);
    expect(error.name).toBe("AbortError");
    expect(error.message).toBe("Login cancelled");
    expect(login).not.toHaveBeenCalled();
    expect(ui.pending).toBe(false);
    expect(ui.mode).toBeNull();
    expect(ui.abort).toBeNull();
  });

  it("cancels after identity resolution without committing pending mutations", async () => {
    const identity = deferred<AccountIdentity>();
    let temporaryDir = "";
    const deleteCredential = vi.fn(async () => undefined);
    const readIdentity = vi.fn(async () => await identity.promise);
    const provider = createProvider({
      deleteCredential,
      login: vi.fn(async (home) => {
        temporaryDir = home;
      }),
      readIdentity,
    });
    const stateStore = createStateStore({
      accounts: [],
      activeAccountId: null,
      revision: 0,
      schemaVersion: 1,
    });
    const { host, ui } = createHost({ provider, stateStore });

    const adding = addOidcAccount(host, "oauth");
    await vi.waitFor(() => expect(readIdentity).toHaveBeenCalledOnce());
    ui.abort?.abort();
    identity.resolve(IDENTITY);

    const error = await captureRejection(adding);
    expect(error).toMatchObject({
      message: "Login cancelled",
      name: "AbortError",
    });
    expect(stateStore.mutate).not.toHaveBeenCalled();
    expect(stateStore.flush).not.toHaveBeenCalled();
    expect(provider.materializeOidc).not.toHaveBeenCalled();
    expect(provider.moveCredential).not.toHaveBeenCalled();
    expect(deleteCredential).toHaveBeenCalledWith(temporaryDir);
    expect(existsSync(temporaryDir)).toBe(false);
    expect(ui.pending).toBe(false);
    expect(ui.mode).toBeNull();
    expect(ui.abort).toBeNull();
  });

  it("cancels in the duplicate-account branch before moving credentials", async () => {
    const existingId = "existing-account";
    const previousState: GrokAccountsFileState = {
      accounts: [
        {
          createdAt: 1,
          email: "old@example.com",
          id: existingId,
          kind: "oidc",
          provider: "grok",
          providerAccountId: IDENTITY.providerAccountId,
          updatedAt: 1,
        },
      ],
      activeAccountId: existingId,
      revision: 1,
      schemaVersion: 1,
    };
    const managedAuth = deferred<string>();
    const moveCredential = vi.fn(async () => undefined);
    const readManagedAuthContent = vi.fn(async (home: string) =>
      home === join(root, existingId)
        ? await managedAuth.promise
        : "new-managed-auth"
    );
    const provider = createProvider({
      moveCredential,
      readManagedAuthContent,
    });
    const { host, ui } = createHost({
      provider,
      stateStore: createStateStore(previousState),
    });

    const adding = addOidcAccount(host, "oauth");
    await vi.waitFor(() =>
      expect(readManagedAuthContent).toHaveBeenCalledWith(
        join(root, existingId)
      )
    );
    ui.abort?.abort();
    managedAuth.resolve("old-managed-auth");

    await expect(adding).rejects.toMatchObject({
      message: "Login cancelled",
      name: "AbortError",
    });
    expect(moveCredential).not.toHaveBeenCalled();
  });

  it("aggregates cleanup errors and still removes the temporary directory", async () => {
    let managedDir = "";
    const provider = createProvider({
      deleteCredential: vi.fn(async () => {
        throw new Error("cleanup failed");
      }),
      login: vi.fn(async () => {
        throw new Error("login failed");
      }),
    });
    const { host, ui } = createHost({
      ensureManagedDir: async (accountId) => {
        managedDir = host.accountHomeDir(accountId);
        await mkdir(managedDir, { recursive: true });
        return managedDir;
      },
      provider,
    });

    const error = await captureRejection(addOidcAccount(host, "device"));

    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([
      expect.objectContaining({ message: "login failed" }),
      expect.objectContaining({ message: "cleanup failed" }),
    ]);
    expect(existsSync(managedDir)).toBe(false);
    expect(ui.lastLoginError).toEqual({ at: 100, message: "login failed" });
    expect(ui.pending).toBe(false);
    expect(ui.mode).toBeNull();
    expect(ui.abort).toBeNull();
  });

  it("restores exact current auth and metadata when a new-account flush fails", async () => {
    const previousState: GrokAccountsFileState = {
      accounts: [],
      activeAccountId: null,
      revision: 7,
      schemaVersion: 1,
    };
    let flushCount = 0;
    const stateStore = createStateStore(previousState, async () => {
      flushCount += 1;
      if (flushCount === 1) throw new Error("flush failed");
    });
    let currentAuth: string | null = "exact previous current auth";
    const managedAuth = new Map<string, string>();
    const deletedHomes: string[] = [];
    const provider = createProvider({
      deleteCredential: vi.fn(async (home) => {
        deletedHomes.push(home);
        managedAuth.delete(home);
      }),
      login: vi.fn(async (home) => {
        managedAuth.set(home, "new managed auth");
      }),
      materializeOidc: vi.fn(async (home) => {
        currentAuth = managedAuth.get(home) ?? null;
      }),
      readCurrentAuthContent: vi.fn(async () => currentAuth),
      readManagedAuthContent: vi.fn(
        async (home) => managedAuth.get(home) ?? ""
      ),
      restoreCurrentAuthContent: vi.fn(async (options) => {
        if (currentAuth === options.expectedCurrent) {
          currentAuth = options.previousContent;
          return;
        }
        if (currentAuth !== options.previousContent) {
          throw new Error("Current Grok auth changed during rollback");
        }
      }),
    });
    const { host } = createHost({ provider, stateStore });

    const error = await captureRejection(addOidcAccount(host, "oauth"));

    expect(error.message).toBe("flush failed");
    expect(stateStore.get()).toBe(previousState);
    expect(stateStore.flush).toHaveBeenCalledTimes(2);
    expect(currentAuth).toBe("exact previous current auth");
    expect(provider.restoreCurrentAuthContent).toHaveBeenCalledWith({
      expectedCurrent: "new managed auth",
      previousContent: "exact previous current auth",
    });
    expect(deletedHomes).toHaveLength(1);
    expect(managedAuth.size).toBe(0);
  });

  it("aggregates a current-auth restore conflict without exposing auth content", async () => {
    const previousState: GrokAccountsFileState = {
      accounts: [],
      activeAccountId: null,
      revision: 2,
      schemaVersion: 1,
    };
    let flushCount = 0;
    const stateStore = createStateStore(previousState, async () => {
      flushCount += 1;
      if (flushCount === 1) throw new Error("primary flush failed");
    });
    let currentAuth: string | null = "previous-auth-secret";
    const managedAuth = new Map<string, string>();
    const restoreConflict = new Error(
      "Current Grok auth changed during rollback"
    );
    const provider = createProvider({
      login: vi.fn(async (home) => {
        managedAuth.set(home, "new-auth-secret");
      }),
      materializeOidc: vi.fn(async () => {
        currentAuth = "concurrent-auth-secret";
      }),
      readCurrentAuthContent: vi.fn(async () => currentAuth),
      readManagedAuthContent: vi.fn(
        async (home) => managedAuth.get(home) ?? ""
      ),
      restoreCurrentAuthContent: vi.fn(async () => {
        throw restoreConflict;
      }),
    });
    const { host } = createHost({ provider, stateStore });

    const error = await captureRejection(addOidcAccount(host, "oauth"));

    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([
      expect.objectContaining({ message: "primary flush failed" }),
      restoreConflict,
    ]);
    expect(provider.restoreCurrentAuthContent).toHaveBeenCalledWith({
      expectedCurrent: "new-auth-secret",
      previousContent: "previous-auth-secret",
    });
    expect(currentAuth).toBe("concurrent-auth-secret");
    expect(String(error)).not.toContain("new-auth-secret");
    expect(String(error)).not.toContain("previous-auth-secret");
    expect(String(error)).not.toContain("concurrent-auth-secret");
  });

  it("restores old managed and current auth when duplicate metadata flush fails", async () => {
    const existingId = "existing-account";
    const existingDir = join(root, existingId);
    await mkdir(existingDir, { recursive: true });
    await writeFile(join(existingDir, "keep"), "existing directory");
    const previousState: GrokAccountsFileState = {
      accounts: [
        {
          createdAt: 1,
          email: "old@example.com",
          id: existingId,
          kind: "oidc",
          provider: "grok",
          providerAccountId: IDENTITY.providerAccountId,
          updatedAt: 1,
        },
      ],
      activeAccountId: existingId,
      revision: 4,
      schemaVersion: 1,
    };
    let flushCount = 0;
    const stateStore = createStateStore(previousState, async () => {
      flushCount += 1;
      if (flushCount === 1) throw new Error("duplicate flush failed");
    });
    let currentAuth: string | null = "old current auth";
    const managedAuth = new Map<string, string>([
      [existingDir, "old managed auth"],
    ]);
    const deletedHomes: string[] = [];
    const provider = createProvider({
      deleteCredential: vi.fn(async (home) => {
        deletedHomes.push(home);
        managedAuth.delete(home);
      }),
      login: vi.fn(async (home) => {
        managedAuth.set(home, "replacement managed auth");
      }),
      materializeOidc: vi.fn(async (home) => {
        currentAuth = managedAuth.get(home) ?? null;
      }),
      moveCredential: vi.fn(async (from, to) => {
        managedAuth.set(to, managedAuth.get(from) ?? "");
        managedAuth.delete(from);
      }),
      readCurrentAuthContent: vi.fn(async () => currentAuth),
      readManagedAuthContent: vi.fn(
        async (home) => managedAuth.get(home) ?? ""
      ),
      restoreCurrentAuthContent: vi.fn(async (options) => {
        if (currentAuth === options.expectedCurrent) {
          currentAuth = options.previousContent;
          return;
        }
        if (currentAuth !== options.previousContent) {
          throw new Error("Current Grok auth changed during rollback");
        }
      }),
      writeManagedAuthContent: vi.fn(async (home, content) => {
        managedAuth.set(home, content);
      }),
    });
    const { host } = createHost({ provider, stateStore });

    const error = await captureRejection(addOidcAccount(host, "oauth"));

    expect(error.message).toBe("duplicate flush failed");
    expect(stateStore.get()).toBe(previousState);
    expect(managedAuth.get(existingDir)).toBe("old managed auth");
    expect(provider.writeManagedAuthContent).toHaveBeenCalledWith(
      existingDir,
      "old managed auth"
    );
    expect(currentAuth).toBe("old current auth");
    expect(provider.restoreCurrentAuthContent).toHaveBeenCalledWith({
      expectedCurrent: "replacement managed auth",
      previousContent: "old current auth",
    });
    expect(deletedHomes).toHaveLength(1);
    expect(deletedHomes).not.toContain(existingDir);
    expect(existsSync(join(existingDir, "keep"))).toBe(true);
  });
});
