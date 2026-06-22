import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type ProjectPreferences,
  projectPreferencesSchema,
} from "@shared/contracts/preferences.ts";
import { app } from "electron";
import lockfile from "proper-lockfile";
import writeFileAtomic from "write-file-atomic";

export type { ProjectPreferences } from "@shared/contracts/preferences.ts";

function resolveFilePath(): string {
  return join(app.getPath("userData"), "preferences.json");
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

async function writeAtomic(
  path: string,
  data: ProjectPreferences
): Promise<void> {
  await writeFileAtomic(path, `${JSON.stringify(data, null, 2)}\n`);
}

async function readAndParse(path: string): Promise<ProjectPreferences> {
  const raw = await readFile(path, "utf-8");
  const parsed = JSON.parse(raw);
  return projectPreferencesSchema.parse(parsed);
}

const DEFAULTS: ProjectPreferences = {
  theme: "system",
  stylePresetId: "pierre",
  language: "zh-CN",
};

export async function readPreferences(): Promise<ProjectPreferences> {
  const path = resolveFilePath();
  if (!existsSync(path)) {
    return DEFAULTS;
  }
  try {
    return await readAndParse(path);
  } catch {
    return DEFAULTS;
  }
}

export async function updatePreferences(
  patch: Partial<ProjectPreferences>
): Promise<ProjectPreferences> {
  const path = resolveFilePath();
  await ensureDir(path);
  let release: (() => Promise<void>) | undefined;
  try {
    if (await fileExists(path)) {
      release = await lockfile.lock(path);
    }
    const current = existsSync(path) ? await readAndParse(path) : DEFAULTS;
    const merged = { ...current, ...patch };
    await writeAtomic(path, merged);
    return merged;
  } finally {
    await release?.();
  }
}
