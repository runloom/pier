import { spawn } from "node:child_process";
import { existsSync, type FSWatcher, mkdirSync, watch } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import writeFileAtomic from "write-file-atomic";
import { type FetchImpl, fetchGrokUsage } from "./grok-usage.ts";
import type { AccountIdentity } from "./identity.ts";
import { readGrokIdentity } from "./identity.ts";
import type { AccountUsageResult } from "./types.ts";

export type SpawnLoginFn = (
  cmd: string,
  args: string[],
  opts: { env: Record<string, string | undefined>; signal: AbortSignal }
) => Promise<void>;

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
    signal: AbortSignal;
  }): Promise<AccountUsageResult>;
  readonly id: "grok";
  login(
    homeDir: string,
    signal: AbortSignal,
    mode: "oauth" | "device"
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

function defaultSpawnLogin(
  cmd: string,
  args: string[],
  opts: { env: Record<string, string | undefined>; signal: AbortSignal }
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, {
      env: { ...process.env, ...opts.env } as NodeJS.ProcessEnv,
      stdio: "inherit",
    });

    opts.signal.addEventListener(
      "abort",
      () => {
        child.kill();
        reject(new Error("Login cancelled"));
      },
      { once: true }
    );

    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        reject(new Error("Grok CLI not found on PATH"));
        return;
      }
      reject(error);
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Grok login exited with code ${code}`));
      }
    });
  });
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
      mode: "oauth" | "device"
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
          await credentials.set(credentialKey(homeDir), content);
          try {
            return await readGrokIdentity(homeDir);
          } finally {
            await rm(authPath, { force: true });
          }
        }
        return await withManagedAuthUnlocked(homeDir, () =>
          readGrokIdentity(homeDir)
        );
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
          if (expectedProviderAccountId !== undefined) {
            const identity = await readGrokIdentity(realGrokHome);
            if (identity?.providerAccountId !== expectedProviderAccountId) {
              return "identity-mismatch";
            }
          }
          const content = await readFile(src, "utf-8");
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
        if (debounceTimer) {
          if (debounceTimer !== null) clearTimeout(debounceTimer);
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
