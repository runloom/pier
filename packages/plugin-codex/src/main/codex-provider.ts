import { spawn } from "node:child_process";
import { existsSync, type FSWatcher, mkdirSync, watch } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import writeFileAtomic from "write-file-atomic";
import { fetchCodexUsage } from "./codex-usage.ts";
import type { AccountIdentity } from "./identity.ts";
import { readCodexIdentity } from "./identity.ts";
import type { AccountUsageResult, AgentAccountProvider } from "./types.ts";

export const PIER_MANAGED_HOME_MARKER = ".pier-managed-home";

export type SpawnLoginFn = (
  cmd: string,
  args: string[],
  opts: { env: Record<string, string | undefined>; signal: AbortSignal }
) => Promise<void>;

export interface CreateCodexProviderOpts {
  credentials: {
    delete(key: string): Promise<void>;
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
  };
  /** 可注入的用量读取实现（单测验证临时凭据写回）。 */
  fetchUsageImpl?: typeof fetchCodexUsage;
  /** 可选日志器（watchExternalAuth 失败时记录原因，便于诊断漂移检测失效）。 */
  logger?: { warn(message: string, ...args: unknown[]): void };
  /** ~/.codex 真实路径（默认 `$HOME/.codex`）。 */
  realCodexHome: string;
  /** 可注入的 login spawn 替身（单测用）。 */
  spawnLogin?: SpawnLoginFn;
}

function defaultRealCodexHome(): string {
  return process.env.CODEX_HOME ?? join(homedir(), ".codex");
}

/**
 * 默认 spawn login 实现——真 spawn `codex login`。
 * 生产环境使用；单测通过 opts.spawnLogin 替换。
 */
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

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`codex login exited with code ${code}`));
      }
    });
  });
}

export function createCodexProvider(
  opts?: Partial<CreateCodexProviderOpts>
): AgentAccountProvider {
  const realCodexHome = opts?.realCodexHome ?? defaultRealCodexHome();
  const spawnLogin = opts?.spawnLogin ?? defaultSpawnLogin;
  const fetchUsageImpl = opts?.fetchUsageImpl ?? fetchCodexUsage;
  const credentials = opts?.credentials;
  const logger = opts?.logger;
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

  async function readManagedAuth(accountHomeDir: string): Promise<string> {
    const authPath = join(accountHomeDir, "auth.json");
    if (!credentials) {
      return await readFile(authPath, "utf-8");
    }
    const stored = await credentials.get(credentialKey(accountHomeDir));
    if (stored !== null) {
      return stored;
    }
    const legacyContent = await readFile(authPath, "utf-8");
    await credentials.set(credentialKey(accountHomeDir), legacyContent);
    await rm(authPath, { force: true });
    return legacyContent;
  }

  async function withManagedAuthUnlocked<T>(
    accountHomeDir: string,
    fn: () => Promise<T>
  ): Promise<T> {
    if (!credentials) return await fn();
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
          "Codex operation and credential write-back failed"
        );
      }
      throw operation.error;
    }
    if (writeBackError) throw writeBackError;
    return operation.value;
  }

  async function withManagedAuth<T>(
    accountHomeDir: string,
    fn: () => Promise<T>
  ): Promise<T> {
    return await withCredentialLock(accountHomeDir, () =>
      withManagedAuthUnlocked(accountHomeDir, fn)
    );
  }

  return {
    id: "codex",

    async login(homeDir: string, signal: AbortSignal): Promise<void> {
      await spawnLogin("codex", ["login"], {
        env: { CODEX_HOME: homeDir },
        signal,
      });
    },

    async readIdentity(homeDir: string): Promise<AccountIdentity | null> {
      if (!credentials || homeDir === realCodexHome) {
        return readCodexIdentity(homeDir);
      }
      return await withCredentialLock(homeDir, async () => {
        const authPath = join(homeDir, "auth.json");
        if (existsSync(authPath)) {
          const content = await readFile(authPath, "utf-8");
          await credentials.set(credentialKey(homeDir), content);
          try {
            return await readCodexIdentity(homeDir);
          } finally {
            await rm(authPath, { force: true });
          }
        }
        return await withManagedAuthUnlocked(homeDir, () =>
          readCodexIdentity(homeDir)
        );
      });
    },

    readCurrentIdentity(): Promise<AccountIdentity | null> {
      return readCodexIdentity(realCodexHome);
    },

    async materialize(accountHomeDir: string): Promise<void> {
      await withCredentialLock(accountHomeDir, async () => {
        const dest = join(realCodexHome, "auth.json");
        const content = await readManagedAuth(accountHomeDir);
        // login 全程 CODEX_HOME 指向托管目录，真实 ~/.codex 可能从未被创建
        // （用户从未直接跑过 codex）——writeFileAtomic 不会自建父目录，故先 mkdir -p。
        await mkdir(realCodexHome, { recursive: true });
        await writeFileAtomic(dest, content, { mode: 0o600 });
      });
    },
    async readManagedAuthContent(accountHomeDir: string): Promise<string> {
      return await withCredentialLock(accountHomeDir, () =>
        readManagedAuth(accountHomeDir)
      );
    },

    async syncBack(
      accountHomeDir: string,
      expectedProviderAccountId: string | undefined
    ): Promise<"identity-mismatch" | "ok"> {
      return await withCredentialLock(accountHomeDir, async () => {
        const src = join(realCodexHome, "auth.json");
        if (!existsSync(src)) return "ok";
        // 身份校验：expected 不为 undefined 时比对真实 auth 的 providerAccountId
        if (expectedProviderAccountId !== undefined) {
          const identity = await readCodexIdentity(realCodexHome);
          if (identity?.providerAccountId !== expectedProviderAccountId) {
            return "identity-mismatch";
          }
        }
        const content = await readFile(src, "utf-8");
        if (credentials) {
          await credentials.set(credentialKey(accountHomeDir), content);
          await rm(join(accountHomeDir, "auth.json"), { force: true });
        } else {
          await writeFileAtomic(join(accountHomeDir, "auth.json"), content, {
            mode: 0o600,
          });
        }
        return "ok";
      });
    },

    watchExternalAuth(cb: () => void): () => void {
      // watch ~/.codex 目录（不是 auth.json 文件本身）：
      // codex CLI 与本服务都用原子写（写临时文件 + rename），
      // macOS 上对单文件的 fs.watch 按 inode 追踪，rename 后会静默失效。
      let watcher: FSWatcher | null = null;
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;

      try {
        // 全新机器上 ~/.codex 可能尚不存在，watch 会抛 ENOENT 而静默失效，
        // 外部 `codex login` 的漂移将侦测不到直到重启。先建目录让 watcher 附着。
        if (!existsSync(realCodexHome)) {
          mkdirSync(realCodexHome, { recursive: true });
        }
        watcher = watch(realCodexHome, (_eventType, filename) => {
          if (filename !== "auth.json") {
            return;
          }
          if (debounceTimer) {
            clearTimeout(debounceTimer);
          }
          debounceTimer = setTimeout(cb, 500);
        });
      } catch (error) {
        // 目录不存在或无权限——漂移检测将失效直到重启，记录原因便于诊断。
        logger?.warn(
          "[pier.codex] watchExternalAuth failed, auth drift detection disabled until restart",
          error
        );
      }

      return () => {
        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }
        watcher?.close();
        watcher = null;
      };
    },

    async fetchUsage(
      accountHomeDir: string | undefined,
      signal: AbortSignal
    ): Promise<AccountUsageResult> {
      if (accountHomeDir && credentials) {
        return await withManagedAuth(accountHomeDir, () =>
          fetchUsageImpl(signal, { accountHomeDir })
        );
      }
      return await fetchUsageImpl(signal, {
        ...(accountHomeDir ? { accountHomeDir } : {}),
      });
    },

    async deleteCredential(accountHomeDir: string): Promise<void> {
      await withCredentialLock(accountHomeDir, async () => {
        await credentials?.delete(credentialKey(accountHomeDir));
        await rm(join(accountHomeDir, "auth.json"), { force: true });
      });
    },

    async moveCredential(
      fromHomeDir: string,
      toHomeDir: string
    ): Promise<void> {
      await withCredentialLocks([fromHomeDir, toHomeDir], async () => {
        if (!credentials) {
          const content = await readFile(
            join(fromHomeDir, "auth.json"),
            "utf-8"
          );
          await writeFileAtomic(join(toHomeDir, "auth.json"), content, {
            mode: 0o600,
          });
          return;
        }
        const content = await readManagedAuth(fromHomeDir);
        await credentials.set(credentialKey(toHomeDir), content);
        await credentials.delete(credentialKey(fromHomeDir));
        await rm(join(fromHomeDir, "auth.json"), { force: true });
        await rm(join(toHomeDir, "auth.json"), { force: true });
      });
    },
  };
}
