/**
 * Workspace 布局持久化 — 存 dockview 的 toJSON() 序列化结果到 userData.
 * reload / 重启窗口后从这里恢复 panel 布局.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app } from "electron";
import lockfile from "proper-lockfile";
import writeFileAtomic from "write-file-atomic";

function resolveFilePath(): string {
  return join(app.getPath("userData"), "workspace-layout.json");
}

async function ensureDir(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const { stat: statFn } = await import("node:fs/promises");
    await statFn(path);
    return true;
  } catch {
    return false;
  }
}

export async function readLayout(): Promise<unknown | null> {
  const path = resolveFilePath();
  if (!existsSync(path)) {
    return null;
  }
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function saveLayout(layout: unknown): Promise<void> {
  const path = resolveFilePath();
  await ensureDir(path);
  let release: (() => Promise<void>) | undefined;
  try {
    if (await fileExists(path)) {
      release = await lockfile.lock(path);
    }
    await writeFileAtomic(path, `${JSON.stringify(layout, null, 2)}\n`);
  } finally {
    await release?.();
  }
}
