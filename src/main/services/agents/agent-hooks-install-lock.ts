import { randomUUID } from "node:crypto";
import { link, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const AGENT_HOOKS_INSTALL_LOCK_FILE = ".install.lock";

interface AgentHooksInstallLockOwner {
  pid: number;
  token: string;
}

export interface AgentHooksInstallLockOptions {
  /** 等锁预算；超时后拒绝本轮安装，避免启动永久悬挂。 */
  acquireTimeoutMs?: number;
  /** 测试闸门；生产默认使用 setTimeout。 */
  delay?: (ms: number) => Promise<void>;
  /** 测试时可注入进程存活判定。 */
  isProcessAlive?: (pid: number) => boolean;
  /** 测试时可注入单调时钟。 */
  now?: () => number;
  pollIntervalMs?: number;
}

export class AgentHooksInstallLockBusy extends Error {
  constructor() {
    super("agent hook runtime install lock timed out");
    this.name = "AgentHooksInstallLockBusy";
  }
}

function errorCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : "";
}

function defaultDelay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

function defaultIsProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === "EPERM";
  }
}

function parseOwner(raw: string): AgentHooksInstallLockOwner | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !value ||
      typeof value !== "object" ||
      !("pid" in value) ||
      typeof value.pid !== "number" ||
      !("token" in value) ||
      typeof value.token !== "string"
    ) {
      return null;
    }
    return { pid: value.pid, token: value.token };
  } catch {
    return null;
  }
}

async function readOwner(
  lockPath: string
): Promise<AgentHooksInstallLockOwner | null> {
  try {
    return parseOwner(await readFile(lockPath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * 用同目录候选文件 + 原子 hard-link 获取跨进程锁。
 *
 * 锁的所有权由随机 token 标识；释放前重读 token，避免旧持有者删除后来者的锁。
 * 进程异常退出留下的锁仅在 owner pid 已不存在时回收，活进程即使安装较慢也不会
 * 被固定时长误判为 stale。
 */
export async function withAgentHooksInstallLock<T>(
  hooksHome: string,
  operation: () => Promise<T>,
  options: AgentHooksInstallLockOptions = {}
): Promise<T> {
  const acquireTimeoutMs = options.acquireTimeoutMs ?? 5000;
  const delay = options.delay ?? defaultDelay;
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
  const now = options.now ?? Date.now;
  const pollIntervalMs = options.pollIntervalMs ?? 25;
  const lockPath = join(hooksHome, AGENT_HOOKS_INSTALL_LOCK_FILE);
  const token = `${process.pid}.${randomUUID()}`;
  const candidatePath = `${lockPath}.${token}`;
  const owner: AgentHooksInstallLockOwner = { pid: process.pid, token };

  await mkdir(hooksHome, { recursive: true });
  await writeFile(candidatePath, `${JSON.stringify(owner)}\n`, {
    flag: "wx",
    mode: 0o600,
  });

  const deadline = now() + acquireTimeoutMs;
  let acquired = false;
  try {
    while (now() <= deadline) {
      try {
        await link(candidatePath, lockPath);
        acquired = true;
        break;
      } catch (error) {
        const code = errorCode(error);
        if (code !== "EEXIST") {
          throw error;
        }
        const current = await readOwner(lockPath);
        if (current && !isProcessAlive(current.pid)) {
          const unchanged = await readOwner(lockPath);
          if (unchanged?.token === current.token) {
            await rm(lockPath, { force: true });
            continue;
          }
        }
        const remaining = deadline - now();
        if (remaining <= 0) {
          break;
        }
        await delay(Math.min(pollIntervalMs, remaining));
      }
    }
    if (!acquired) {
      throw new AgentHooksInstallLockBusy();
    }
    await rm(candidatePath, { force: true });
    return await operation();
  } finally {
    await rm(candidatePath, { force: true });
    if (acquired && (await readOwner(lockPath))?.token === token) {
      await rm(lockPath, { force: true });
    }
  }
}
