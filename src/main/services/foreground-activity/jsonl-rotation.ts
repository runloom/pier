import { randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { link, readFile, rm, writeFile } from "node:fs/promises";

export const OFFSET_SUFFIX = ".offset";
export const ROTATING_SUFFIX = ".rotating";
export const LOCK_SUFFIX = ".lock";

export interface RotationRecovery {
  offset: number;
  offsetPath: string;
  path: string;
}

export function prepareInterruptedRotation(
  filePath: string,
  offsetPath: string
): RotationRecovery | null {
  const rotatedPath = `${filePath}${ROTATING_SUFFIX}`;
  const rotatedOffsetPath = `${rotatedPath}${OFFSET_SUFFIX}`;
  try {
    statSync(rotatedPath);
  } catch {
    return null;
  }
  return {
    offset:
      loadPersistedOffset(rotatedOffsetPath) ??
      loadOffset(filePath, offsetPath),
    offsetPath: rotatedOffsetPath,
    path: rotatedPath,
  };
}

export function loadOffset(filePath: string, offsetPath: string): number {
  const persisted = loadPersistedOffset(offsetPath);
  if (persisted !== null) return persisted;
  try {
    return statSync(filePath).size;
  } catch {
    return 0;
  }
}

function loadPersistedOffset(offsetPath: string): number | null {
  try {
    const value = Number(readFileSync(offsetPath, "utf8").trim());
    return Number.isFinite(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

export async function persistOffset(
  offsetPath: string,
  value: number
): Promise<void> {
  await writeFile(offsetPath, String(value)).catch(() => undefined);
}

/** 单一 observer 所有的死亡锁回收；外部 writer 禁止调用。 */
export async function reapStaleRotationLock(path: string): Promise<void> {
  const current = await readFile(path, "utf8").catch(() => "");
  const owner = Number(current.split(".", 1)[0]);
  if (!(current && Number.isInteger(owner) && owner > 0)) return;
  try {
    process.kill(owner, 0);
  } catch {
    if ((await readFile(path, "utf8").catch(() => "")) === current) {
      await rm(path, { force: true });
    }
  }
}

export async function acquireRotationLock(
  path: string,
  isDisposed: () => boolean
): Promise<(() => Promise<void>) | null> {
  // 死亡锁只由单实例、串行 drain 的 observer 回收。所有外部 writer 只等待，
  // 不参与删除，因此不存在两个 stale waiter 交错误删新 owner 活锁的 ABA。
  const token = `${process.pid}.${randomUUID()}`;
  const candidatePath = `${path}.${token}`;
  await writeFile(candidatePath, token, { flag: "wx" });
  const deadline = Date.now() + 5000;
  try {
    while (!isDisposed() && Date.now() < deadline) {
      try {
        await link(candidatePath, path);
        await rm(candidatePath, { force: true });
        return async () => {
          const current = await readFile(path, "utf8").catch(() => "");
          if (current === token) await rm(path, { force: true });
        };
      } catch (error) {
        const code =
          error && typeof error === "object" && "code" in error
            ? String(error.code)
            : "";
        if (code !== "EEXIST") throw error;
        await reapStaleRotationLock(path);
        await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 10));
      }
    }
    return null;
  } finally {
    await rm(candidatePath, { force: true });
  }
}
