import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FilePathTransactionLock } from "../file-path-transaction-lock.ts";
import type { StableProjectIdentity } from "./identity.ts";

export class ProjectSkillsLockBusy extends Error {
  readonly code = "operation-busy" as const;

  constructor(message = "project-skills exclusive lock timed out") {
    super(message);
    this.name = "ProjectSkillsLockBusy";
  }
}

export interface ProjectSkillsLock {
  runExclusive<T>(
    identity: StableProjectIdentity,
    paths: string[],
    fn: () => Promise<T>
  ): Promise<T>;
}

export interface CreateProjectSkillsLockArgs {
  /** Interactive wait budget before operation-busy (default 5000ms). */
  acquireTimeoutMs?: number;
  /** Test seam: delay helper (defaults to setTimeout). */
  delay?: (ms: number) => Promise<void>;
  /** Heartbeat refresh interval while holding the lock (default 1000ms). */
  heartbeatIntervalMs?: number;
  /** Test seam: process liveness check. */
  isProcessAlive?: (pid: number) => boolean;
  now?: () => number;
  pollIntervalMs?: number;
  /** Per-user shared lock root (not per-profile userData). */
  sharedLockRoot: string;
  /**
   * A lock file is stale when its owner process is gone OR heartbeat is older
   * than this age (default 15s).
   */
  staleMs?: number;
  /** REQUIRED injected app-core singleton shared with files service. */
  transactionLock: FilePathTransactionLock;
}

interface LockPayload {
  acquiredAt: number;
  heartbeatAt: number;
  pid: number;
  processInstanceId: string;
  processStartIdentity: string;
  schemaVersion: 1;
}

function lockKeyFor(identity: StableProjectIdentity): string {
  return createHash("sha256")
    .update("project-skills-lock-v1\0", "utf8")
    .update(identity.volumeId, "utf8")
    .update("\0", "utf8")
    .update(identity.directoryIdentity, "utf8")
    .digest("hex");
}

function defaultIsProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "EPERM"
    ) {
      // Exists but not signalable by us — treat as alive.
      return true;
    }
    return false;
  }
}

function defaultDelay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

function processStartIdentity(): string {
  // Best-effort stable-ish start marker for this process instance.
  // Not a kernel start time; combined with random processInstanceId.
  return `${process.pid}:${process.ppid}:${Math.floor(performance.timeOrigin)}`;
}

function parseLockPayload(raw: string): LockPayload | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return null;
    }
    if (!("schemaVersion" in value) || value.schemaVersion !== 1) return null;
    if (
      !("processInstanceId" in value) ||
      typeof value.processInstanceId !== "string"
    ) {
      return null;
    }
    if (!("pid" in value) || typeof value.pid !== "number") return null;
    if (
      !("processStartIdentity" in value) ||
      typeof value.processStartIdentity !== "string"
    ) {
      return null;
    }
    if (!("heartbeatAt" in value) || typeof value.heartbeatAt !== "number") {
      return null;
    }
    if (!("acquiredAt" in value) || typeof value.acquiredAt !== "number") {
      return null;
    }
    return value as LockPayload;
  } catch {
    return null;
  }
}

/**
 * Cross-profile project lock + injected FilePathTransactionLock.
 * Shared lock root serializes disk ops by stable project identity; it does not
 * share ownership state across profiles.
 */
export function createProjectSkillsLock(
  args: CreateProjectSkillsLockArgs
): ProjectSkillsLock {
  if (!args.transactionLock) {
    throw new Error(
      "transactionLock is required (inject FilePathTransactionLock singleton)"
    );
  }
  if (!args.sharedLockRoot) {
    throw new Error("sharedLockRoot is required");
  }

  const transactionLock = args.transactionLock;
  const sharedLockRoot = args.sharedLockRoot;
  const acquireTimeoutMs = args.acquireTimeoutMs ?? 5000;
  const pollIntervalMs = args.pollIntervalMs ?? 25;
  const heartbeatIntervalMs = args.heartbeatIntervalMs ?? 1000;
  const staleMs = args.staleMs ?? 15_000;
  const now = args.now ?? Date.now;
  const isProcessAlive = args.isProcessAlive ?? defaultIsProcessAlive;
  const delay = args.delay ?? defaultDelay;
  const processInstanceId = randomUUID();
  const startIdentity = processStartIdentity();

  async function ensureRoot(): Promise<void> {
    await mkdir(sharedLockRoot, { recursive: true });
  }

  function lockPathFor(identity: StableProjectIdentity): string {
    return join(sharedLockRoot, `${lockKeyFor(identity)}.lock`);
  }

  async function readOwner(lockPath: string): Promise<LockPayload | null> {
    try {
      return parseLockPayload(await readFile(lockPath, "utf8"));
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: unknown }).code === "ENOENT"
      ) {
        return null;
      }
      return null;
    }
  }

  function isStale(owner: LockPayload, at: number): boolean {
    if (!isProcessAlive(owner.pid)) return true;
    if (at - owner.heartbeatAt > staleMs) return true;
    return false;
  }

  async function tryReapStale(lockPath: string): Promise<void> {
    const owner = await readOwner(lockPath);
    if (!owner) {
      // Unreadable/corrupt lock: only remove if still unreadable after race.
      try {
        await rm(lockPath, { force: true });
      } catch {
        // ignore
      }
      return;
    }
    if (!isStale(owner, now())) return;
    const still = await readOwner(lockPath);
    if (
      still &&
      still.processInstanceId === owner.processInstanceId &&
      still.heartbeatAt === owner.heartbeatAt
    ) {
      await rm(lockPath, { force: true });
    }
  }

  async function acquireProjectLock(
    identity: StableProjectIdentity
  ): Promise<() => Promise<void>> {
    await ensureRoot();
    const lockPath = lockPathFor(identity);
    const token = `${process.pid}.${processInstanceId}.${randomUUID()}`;
    const candidatePath = `${lockPath}.${token}`;
    const payload: LockPayload = {
      acquiredAt: now(),
      heartbeatAt: now(),
      pid: process.pid,
      processInstanceId,
      processStartIdentity: startIdentity,
      schemaVersion: 1,
    };

    await writeFile(candidatePath, `${JSON.stringify(payload)}\n`, {
      flag: "wx",
      mode: 0o600,
    });

    const deadline = now() + acquireTimeoutMs;
    try {
      while (now() <= deadline) {
        try {
          await link(candidatePath, lockPath);
          await rm(candidatePath, { force: true });

          let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
          const refreshHeartbeat = async (): Promise<void> => {
            const current = await readOwner(lockPath);
            if (!current || current.processInstanceId !== processInstanceId) {
              return;
            }
            const next: LockPayload = {
              ...current,
              heartbeatAt: now(),
            };
            try {
              await writeFile(lockPath, `${JSON.stringify(next)}\n`, {
                mode: 0o600,
              });
              await utimes(lockPath, new Date(), new Date());
            } catch {
              // Best-effort heartbeat; holder still owns via process liveness.
            }
          };

          heartbeatTimer = setInterval(() => {
            refreshHeartbeat().catch(() => undefined);
          }, heartbeatIntervalMs);
          // Don't keep the event loop alive solely for heartbeat in tests.
          heartbeatTimer.unref?.();

          return async () => {
            clearInterval(heartbeatTimer);
            const current = await readOwner(lockPath);
            if (current?.processInstanceId === processInstanceId) {
              await rm(lockPath, { force: true });
            }
          };
        } catch (error) {
          const code =
            typeof error === "object" && error !== null && "code" in error
              ? String((error as { code?: unknown }).code)
              : "";
          // EEXIST: lock held. ENOENT: candidate raced with cleanup — retry once rewritten.
          if (code === "ENOENT") {
            try {
              await writeFile(
                candidatePath,
                `${JSON.stringify({
                  ...payload,
                  acquiredAt: now(),
                  heartbeatAt: now(),
                })}\n`,
                {
                  flag: "wx",
                  mode: 0o600,
                }
              );
            } catch {
              // candidate may already exist
            }
          } else if (code !== "EEXIST") {
            throw error;
          }
          await tryReapStale(lockPath);
          const remaining = deadline - now();
          if (remaining <= 0) break;
          await delay(Math.min(pollIntervalMs, remaining));
        }
      }
      throw new ProjectSkillsLockBusy();
    } finally {
      await rm(candidatePath, { force: true });
    }
  }

  return {
    async runExclusive<T>(
      identity: StableProjectIdentity,
      paths: string[],
      fn: () => Promise<T>
    ): Promise<T> {
      const releaseProject = await acquireProjectLock(identity);
      try {
        // Hold process-local path lock over caller paths + this project's lock file.
        // Do not lock the entire sharedLockRoot — that would serialize unrelated projects.
        const lockFile = lockPathFor(identity);
        return await transactionLock.run([...paths, lockFile], fn);
      } finally {
        await releaseProject();
      }
    },
  };
}
