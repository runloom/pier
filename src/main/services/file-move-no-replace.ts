import { randomUUID } from "node:crypto";
import {
  cp,
  link,
  lstat,
  mkdir,
  open,
  readlink,
  rename,
  rm,
  symlink,
} from "node:fs/promises";

export interface FileMoveNoReplaceOptions {
  linkFile?: (source: string, target: string) => Promise<void>;
}

function isCrossDeviceError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "EXDEV"
  );
}

async function copyThenRemove(
  source: string,
  target: string,
  kind: "directory" | "file"
): Promise<void> {
  const staging = `${target}.pier-move-${randomUUID()}`;
  let targetReserved = false;
  let published = false;
  try {
    await cp(source, staging, {
      errorOnExist: true,
      force: false,
      preserveTimestamps: true,
      recursive: kind === "directory",
    });
    if (kind === "directory") {
      await mkdir(target);
    } else {
      const reservation = await open(target, "wx");
      await reservation.close();
    }
    targetReserved = true;
    await rename(staging, target);
    published = true;
    await rm(source, { recursive: kind === "directory" });
  } finally {
    await rm(staging, { force: true, recursive: true }).catch(() => undefined);
    if (targetReserved && !published) {
      await rm(target, { force: true, recursive: true }).catch(() => undefined);
    }
  }
}

/**
 * 移动时不覆盖并发出现的目标。普通文件优先用 hard-link + unlink，目标占位
 * 是原子的；目录、符号链接和跨设备路径走 no-clobber copy + remove。
 */
export async function movePathNoReplace(
  source: string,
  target: string,
  options: FileMoveNoReplaceOptions = {}
): Promise<void> {
  const sourceInfo = await lstat(source);
  if (sourceInfo.isSymbolicLink()) {
    const rawTarget = await readlink(source);
    await symlink(rawTarget, target);
    await rm(source);
    return;
  }
  if (!sourceInfo.isFile()) {
    if (!sourceInfo.isDirectory()) {
      throw new Error("Only files, directories, and symbolic links can move");
    }
    await copyThenRemove(source, target, "directory");
    return;
  }
  try {
    await (options.linkFile ?? link)(source, target);
  } catch (error) {
    if (!isCrossDeviceError(error)) {
      throw error;
    }
    await copyThenRemove(source, target, "file");
    return;
  }
  await rm(source);
}
