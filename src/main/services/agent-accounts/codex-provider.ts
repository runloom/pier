import { spawn } from "node:child_process";
import { existsSync, type FSWatcher, watch } from "node:fs";
import { readFile } from "node:fs/promises";
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

  return {
    id: "codex",

    async login(homeDir: string, signal: AbortSignal): Promise<void> {
      await spawnLogin("codex", ["login"], {
        env: { CODEX_HOME: homeDir },
        signal,
      });
    },

    readIdentity(homeDir: string): Promise<AccountIdentity | null> {
      return readCodexIdentity(homeDir);
    },

    async materialize(accountHomeDir: string): Promise<void> {
      const src = join(accountHomeDir, "auth.json");
      const dest = join(realCodexHome, "auth.json");
      const content = await readFile(src, "utf-8");
      await writeFileAtomic(dest, content, { mode: 0o600 });
    },

    async syncBack(
      accountHomeDir: string,
      expectedProviderAccountId: string | undefined
    ): Promise<"identity-mismatch" | "ok"> {
      const src = join(realCodexHome, "auth.json");
      if (!existsSync(src)) {
        return "ok";
      }
      // 身份校验：expected 不为 undefined 时比对真实 auth 的 providerAccountId
      if (expectedProviderAccountId !== undefined) {
        const identity = await readCodexIdentity(realCodexHome);
        if (identity?.providerAccountId !== expectedProviderAccountId) {
          return "identity-mismatch";
        }
      }
      const dest = join(accountHomeDir, "auth.json");
      // 与 materialize 同等保证：原子写 + 0600（copyFile 非原子且继承源权限）。
      const content = await readFile(src, "utf-8");
      await writeFileAtomic(dest, content, { mode: 0o600 });
      return "ok";
    },

    watchExternalAuth(cb: () => void): () => void {
      // watch ~/.codex 目录（不是 auth.json 文件本身）：
      // codex CLI 与本服务都用原子写（写临时文件 + rename），
      // macOS 上对单文件的 fs.watch 按 inode 追踪，rename 后会静默失效。
      let watcher: FSWatcher | null = null;
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;

      try {
        watcher = watch(realCodexHome, (_eventType, filename) => {
          if (filename !== "auth.json") {
            return;
          }
          if (debounceTimer) {
            clearTimeout(debounceTimer);
          }
          debounceTimer = setTimeout(cb, 500);
        });
      } catch {
        // 目录不存在或无权限——静默，后续有变更时用户手动刷新
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

    fetchUsage(signal: AbortSignal): Promise<AccountUsageResult> {
      return fetchCodexUsage(signal);
    },
  };
}
