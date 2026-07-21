import { randomUUID } from "node:crypto";
import {
  access,
  chmod,
  lstat,
  mkdir,
  open,
  rename,
  rm,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function ensurePrivateDirectory(path: string): Promise<void> {
  const existed = await pathExists(path);
  await mkdir(path, { mode: 0o700, recursive: true });
  const metadata = await lstat(path);
  if (!(metadata.isDirectory() && !metadata.isSymbolicLink())) {
    throw new Error(`Draft storage path is not a private directory: ${path}`);
  }
  await chmod(path, 0o700);
  if (!existed) {
    await syncDirectory(dirname(path));
  }
}

export async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function writeDurableJson(
  path: string,
  value: unknown
): Promise<void> {
  const parentDir = dirname(path);
  await ensurePrivateDirectory(parentDir);
  const temporaryPath = join(
    parentDir,
    `.${basename(path)}.${randomUUID()}.tmp`
  );
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
  try {
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, path);
    await syncDirectory(parentDir);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
