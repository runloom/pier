import { existsSync, type FSWatcher, mkdirSync, watch } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import writeFileAtomic from "write-file-atomic";
import { type FetchImpl, fetchGrokUsage } from "./grok-usage.ts";
import type { AccountIdentity } from "./identity.ts";
import { parseGrokAuthJson, readGrokIdentity } from "./identity.ts";
import { defaultSpawnLogin, type SpawnLoginFn } from "./login-spawn.ts";
import type { AccountUsageResult } from "./types.ts";

export { type SpawnLoginFn, stripAnsi } from "./login-spawn.ts";

export interface CreateGrokProviderOpts {
  credentials: {
    delete(key: string): Promise<void>;
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
  };
  fetchImpl?: FetchImpl;
  logger?: { warn(message: string, ...args: unknown[]): void };
  processEnv?: Readonly<Record<string, string | undefined>>;
  realGrokHome?: string;
  spawnLogin?: SpawnLoginFn;
}

export interface GrokAccountProvider {
  deleteApiKey(accountId: string): Promise<void>;
  deleteCredential(accountHomeDir: string): Promise<void>;
  fetchUsage(options: {
    accountHomeDir?: string | undefined;
    kind: "api_key" | "oidc";
    /**
     * Fires after a refreshed OIDC session has been persisted to the managed
     * credential store, with the new auth.json content. Lets the service
     * mirror rotated tokens into the real Grok home for the active account.
     */
    onSessionRefreshed?: ((authJson: string) => Promise<void>) | undefined;
    signal: AbortSignal;
  }): Promise<AccountUsageResult>;
  readonly id: "grok";
  login(
    homeDir: string,
    signal: AbortSignal,
    mode: "oauth" | "device",
    onOutput?: (chunk: string) => void
  ): Promise<void>;
  materializeApiKey(accountId: string): Promise<void>;
  materializeEmptyAuth(): Promise<void>;
  materializeOidc(accountHomeDir: string): Promise<void>;
  moveCredential(fromHomeDir: string, toHomeDir: string): Promise<void>;
  readApiKey(accountId: string): Promise<string | null>;
  readCurrentAuthContent(): Promise<string | null>;
  readCurrentIdentity(): Promise<AccountIdentity | null>;
  readIdentity(homeDir: string): Promise<AccountIdentity | null>;
  readManagedAuthContent(accountHomeDir: string): Promise<string>;
  restoreCurrentAuthContent(options: {
    expectedCurrent: string;
    previousContent: string | null;
  }): Promise<void>;
  storeApiKey(accountId: string, apiKey: string): Promise<void>;
  syncBack(
    accountHomeDir: string,
    expectedProviderAccountId: string | undefined
  ): Promise<"identity-mismatch" | "ok">;
  watchExternalAuth(cb: () => void): () => void;
  writeCurrentAuthContent(content: string | null): Promise<void>;
  writeManagedAuthContent(
    accountHomeDir: string,
    content: string
  ): Promise<void>;
}

function defaultRealGrokHome(
  processEnv?: Readonly<Record<string, string | undefined>>
): string {
  return (
    processEnv?.GROK_HOME ?? process.env.GROK_HOME ?? join(homedir(), ".grok")
  );
}

export function createGrokProvider(
  opts: CreateGrokProviderOpts
): GrokAccountProvider {
  const processEnv = opts.processEnv;
  const realGrokHome = opts.realGrokHome ?? defaultRealGrokHome(processEnv);
  const spawnLogin = opts.spawnLogin ?? defaultSpawnLogin;
  const fetchImpl = opts.fetchImpl;
  const credentials = opts.credentials;
  const logger = opts.logger;
  const credentialTails = new Map<string, Promise<void>>();

  async function withCredentialLock<T>(
    accountHomeDir: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const previous = credentialTails.get(accountHomeDir) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    credentialTails.set(accountHomeDir, current);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (credentialTails.get(accountHomeDir) === current) {
        credentialTails.delete(accountHomeDir);
      }
    }
  }

  async function withCredentialLocks<T>(
    accountHomeDirs: readonly string[],
    operation: () => Promise<T>
  ): Promise<T> {
    const paths = [...new Set(accountHomeDirs)].sort();
    const acquire = (index: number): Promise<T> => {
      const path = paths[index];
      return path
        ? withCredentialLock(path, () => acquire(index + 1))
        : operation();
    };
    return await acquire(0);
  }

  function credentialKey(accountHomeDir: string): string {
    return `accounts/${accountHomeDir.split(/[\\/]/).at(-1)}/auth`;
  }

  function apiKeyCredentialKey(accountId: string): string {
    return `accounts/${accountId}/api-key`;
  }

  async function readManagedAuth(accountHomeDir: string): Promise<string> {
    const authPath = join(accountHomeDir, "auth.json");
    const stored = await credentials.get(credentialKey(accountHomeDir));
    if (stored !== null) {
      return stored;
    }
    const legacyContent = await readFile(authPath, "utf-8");
    await credentials.set(credentialKey(accountHomeDir), legacyContent);
    await rm(authPath, { force: true });
    return legacyContent;
  }

  async function readCurrentAuthUnlocked(): Promise<string | null> {
    try {
      return await readFile(join(realGrokHome, "auth.json"), "utf-8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async function writeCurrentAuthUnlocked(
    content: string | null
  ): Promise<void> {
    const authPath = join(realGrokHome, "auth.json");
    if (content === null) {
      await rm(authPath, { force: true });
      return;
    }
    await mkdir(realGrokHome, { recursive: true });
    await writeFileAtomic(authPath, content, { mode: 0o600 });
  }

  async function withManagedAuthUnlocked<T>(
    accountHomeDir: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const authPath = join(accountHomeDir, "auth.json");
    const content = await readManagedAuth(accountHomeDir);
    await mkdir(accountHomeDir, { recursive: true });
    await writeFileAtomic(authPath, content, { mode: 0o600 });

    let operation: { error: unknown; ok: false } | { ok: true; value: T };
    try {
      operation = { ok: true, value: await fn() };
    } catch (error) {
      operation = { error, ok: false };
    }

    let writeBackError: unknown = null;
    try {
      const updated = await readFile(authPath, "utf-8").catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return null;
          throw error;
        }
      );
      if (updated !== null && updated !== content) {
        await credentials.set(credentialKey(accountHomeDir), updated);
      }
    } catch (error) {
      writeBackError = error;
    } finally {
      await rm(authPath, { force: true });
    }

    if (!operation.ok) {
      if (writeBackError) {
        throw new AggregateError(
          [operation.error, writeBackError],
          "Grok operation and credential write-back failed"
        );
      }
      throw operation.error;
    }
    if (writeBackError) throw writeBackError;
    return operation.value;
  }

  async function materializeEmptyAuth(): Promise<void> {
    await withCredentialLock(realGrokHome, () =>
      writeCurrentAuthUnlocked("{}")
    );
  }

  return {
    id: "grok",

    async login(
      homeDir: string,
      signal: AbortSignal,
      mode: "oauth" | "device",
      onOutput?: (chunk: string) => void
    ): Promise<void> {
      const args =
        mode === "device" ? ["login", "--device-auth"] : ["login", "--oauth"];
      await spawnLogin("grok", args, {
        env: {
          ...process.env,
          ...processEnv,
          // Keep login-shell PATH hydration (GUI Electron starts thin).
          // processEnv may freeze activate-time PATH without ~/.grok/bin.
          ...(process.env.PATH === undefined ? {} : { PATH: process.env.PATH }),
          GROK_HOME: homeDir,
        },
        ...(onOutput ? { onOutput } : {}),
        signal,
      });
    },

    async readIdentity(homeDir: string): Promise<AccountIdentity | null> {
      if (homeDir === realGrokHome) {
        return await withCredentialLock(realGrokHome, () =>
          readGrokIdentity(realGrokHome)
        );
      }
      return await withCredentialLock(homeDir, async () => {
        const authPath = join(homeDir, "auth.json");
        if (existsSync(authPath)) {
          const content = await readFile(authPath, "utf-8");
          // Validate before persisting: a corrupt stray file must not
          // overwrite a previously stored good credential.
          const identity = parseGrokAuthJson(content);
          if (identity) {
            await credentials.set(credentialKey(homeDir), content);
            await rm(authPath, { force: true });
            return identity;
          }
        }
        try {
          return await withManagedAuthUnlocked(homeDir, () =>
            readGrokIdentity(homeDir)
          );
        } catch (error) {
          // No stored credential and no legacy file: treat as "no identity"
          // instead of bubbling a raw ENOENT that would brick activation.
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return null;
          }
          throw error;
        }
      });
    },

    async readCurrentIdentity(): Promise<AccountIdentity | null> {
      return await withCredentialLock(realGrokHome, () =>
        readGrokIdentity(realGrokHome)
      );
    },

    async readCurrentAuthContent(): Promise<string | null> {
      return await withCredentialLock(realGrokHome, readCurrentAuthUnlocked);
    },

    async writeCurrentAuthContent(content: string | null): Promise<void> {
      await withCredentialLock(realGrokHome, () =>
        writeCurrentAuthUnlocked(content)
      );
    },

    async restoreCurrentAuthContent(options: {
      expectedCurrent: string;
      previousContent: string | null;
    }): Promise<void> {
      await withCredentialLock(realGrokHome, async () => {
        const current = await readCurrentAuthUnlocked();
        if (current === options.expectedCurrent) {
          await writeCurrentAuthUnlocked(options.previousContent);
          return;
        }
        if (current === options.previousContent) {
          return;
        }
        throw new Error("Current Grok auth changed during rollback");
      });
    },

    async materializeOidc(accountHomeDir: string): Promise<void> {
      await withCredentialLocks([accountHomeDir, realGrokHome], async () => {
        const content = await readManagedAuth(accountHomeDir);
        await writeCurrentAuthUnlocked(content);
      });
    },

    async materializeApiKey(_accountId: string): Promise<void> {
      // Session token in auth.json beats XAI_API_KEY. Clear session so the key
      // can win in agent/terminal launches that supply XAI_API_KEY themselves.
      await materializeEmptyAuth();
    },

    materializeEmptyAuth,

    async fetchUsage(options: {
      accountHomeDir?: string | undefined;
      kind: "api_key" | "oidc";
      onSessionRefreshed?: ((authJson: string) => Promise<void>) | undefined;
      signal: AbortSignal;
    }): Promise<AccountUsageResult> {
      if (options.kind === "api_key") {
        return await fetchGrokUsage({
          authJson: null,
          kind: "api_key",
          signal: options.signal,
          ...(fetchImpl ? { fetchImpl } : {}),
        });
      }
      if (!options.accountHomeDir) {
        return {
          status: "error",
          error:
            "Grok session expired — re-login required (session token missing)",
          windows: [],
        };
      }
      const accountHomeDir = options.accountHomeDir;
      const authJson = await withCredentialLock(accountHomeDir, () =>
        readManagedAuth(accountHomeDir)
      ).catch(() => null);
      return await fetchGrokUsage({
        authJson,
        kind: "oidc",
        signal: options.signal,
        onAuthJsonUpdated: async (nextAuthJson) => {
          await withCredentialLock(accountHomeDir, async () => {
            await credentials.set(credentialKey(accountHomeDir), nextAuthJson);
            await rm(join(accountHomeDir, "auth.json"), { force: true });
          });
          // Mirror rotated tokens into the real Grok home when the caller
          // owns the active account; a single-use rotated refresh token that
          // only lives in the plugin store would strand the CLI's own copy.
          await options.onSessionRefreshed?.(nextAuthJson);
        },
        ...(fetchImpl ? { fetchImpl } : {}),
      });
    },

    async readManagedAuthContent(accountHomeDir: string): Promise<string> {
      return await withCredentialLock(accountHomeDir, () =>
        readManagedAuth(accountHomeDir)
      );
    },

    async writeManagedAuthContent(
      accountHomeDir: string,
      content: string
    ): Promise<void> {
      await withCredentialLock(accountHomeDir, async () => {
        await credentials.set(credentialKey(accountHomeDir), content);
        await rm(join(accountHomeDir, "auth.json"), { force: true });
      });
    },

    async syncBack(
      accountHomeDir: string,
      expectedProviderAccountId: string | undefined
    ): Promise<"identity-mismatch" | "ok"> {
      return await withCredentialLocks(
        [accountHomeDir, realGrokHome],
        async () => {
          const src = join(realGrokHome, "auth.json");
          if (!existsSync(src)) return "ok";
          // Read once and validate the identity from that same content —
          // a second read would let an external writer swap the file between
          // the check and the capture (TOCTOU).
          const content = await readFile(src, "utf-8");
          if (expectedProviderAccountId !== undefined) {
            const identity = parseGrokAuthJson(content);
            if (identity?.providerAccountId !== expectedProviderAccountId) {
              return "identity-mismatch";
            }
          }
          await credentials.set(credentialKey(accountHomeDir), content);
          await rm(join(accountHomeDir, "auth.json"), { force: true });
          return "ok";
        }
      );
    },

    watchExternalAuth(cb: () => void): () => void {
      let watcher: FSWatcher | null = null;
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;

      try {
        if (!existsSync(realGrokHome)) {
          mkdirSync(realGrokHome, { recursive: true });
        }
        watcher = watch(realGrokHome, (_eventType, filename) => {
          if (filename !== "auth.json") {
            return;
          }
          if (debounceTimer !== null) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(cb, 500);
        });
      } catch (error) {
        logger?.warn(
          "[pier.grok] watchExternalAuth failed, auth drift detection disabled until restart",
          error
        );
      }

      return () => {
        if (debounceTimer !== null) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }
        watcher?.close();
        watcher = null;
      };
    },

    async deleteCredential(accountHomeDir: string): Promise<void> {
      await withCredentialLock(accountHomeDir, async () => {
        await credentials.delete(credentialKey(accountHomeDir));
        await rm(join(accountHomeDir, "auth.json"), { force: true });
      });
    },

    async moveCredential(
      fromHomeDir: string,
      toHomeDir: string
    ): Promise<void> {
      await withCredentialLocks([fromHomeDir, toHomeDir], async () => {
        const content = await readManagedAuth(fromHomeDir);
        await credentials.set(credentialKey(toHomeDir), content);
        await credentials.delete(credentialKey(fromHomeDir));
        await rm(join(fromHomeDir, "auth.json"), { force: true });
        await rm(join(toHomeDir, "auth.json"), { force: true });
      });
    },

    async storeApiKey(accountId: string, apiKey: string): Promise<void> {
      await credentials.set(apiKeyCredentialKey(accountId), apiKey);
    },

    async readApiKey(accountId: string): Promise<string | null> {
      return await credentials.get(apiKeyCredentialKey(accountId));
    },

    async deleteApiKey(accountId: string): Promise<void> {
      await credentials.delete(apiKeyCredentialKey(accountId));
    },
  };
}
