import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PIER_HOOK_COMMAND_GENERATION } from "../../hooks-install.ts";
import {
  isPierHookCommand,
  pierHookCommandGeneration,
} from "./command-core.ts";

/** 扫描 settings.hooks（wrapped）与 flat 顶层事件键下全部 pier command 的最大世代。 */
export function maxPierHookGenerationInSettings(
  settings: Record<string, unknown>
): number {
  let max = 0;
  const visitCommand = (command: unknown): void => {
    if (typeof command !== "string" || !isPierHookCommand(command)) {
      return;
    }
    max = Math.max(max, pierHookCommandGeneration(command));
  };
  const visitEntries = (entries: unknown[]): void => {
    for (const entry of entries) {
      if (!(entry && typeof entry === "object")) {
        continue;
      }
      const record = entry as Record<string, unknown>;
      visitCommand(record.command);
      const nested = record.hooks;
      if (!Array.isArray(nested)) {
        continue;
      }
      for (const hook of nested) {
        if (hook && typeof hook === "object") {
          visitCommand((hook as { command?: unknown }).command);
        }
      }
    }
  };
  const hooks = settings.hooks;
  if (hooks && typeof hooks === "object" && !Array.isArray(hooks)) {
    for (const entries of Object.values(hooks as Record<string, unknown>)) {
      if (!Array.isArray(entries)) {
        continue;
      }
      visitEntries(entries);
    }
  }
  // flat 形态（droid 独立 hooks.json）：事件键数组直接在顶层；settings.hooks
  // 是对象不是数组，不会被下面的顶层扫描重复访问。
  for (const value of Object.values(settings)) {
    if (Array.isArray(value)) {
      visitEntries(value);
    }
  }
  return max;
}

/**
 * 若磁盘上已有更高世代的 pier hook，则保留原配置（防止旧 worktree 降级覆盖）。
 * 否则执行 rewrite。
 */
export function transformPierHooksUnlessNewer(
  settings: Record<string, unknown>,
  rewrite: (s: Record<string, unknown>) => Record<string, unknown>
): Record<string, unknown> {
  if (
    maxPierHookGenerationInSettings(settings) > PIER_HOOK_COMMAND_GENERATION
  ) {
    return settings;
  }
  return rewrite(settings);
}

/**
 * 读 JSON 配置：文件不存在 → {}（从空开始）；解析失败/非对象 → null
 * （已损坏, 调用方必须放弃写入, 不得破坏用户文件）。
 */
export async function readJsonConfig(
  path: string
): Promise<Record<string, unknown> | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export async function atomicWriteFile(
  path: string,
  data: string
): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  const tmp = `${path}.pier-tmp`;
  await writeFile(tmp, data, "utf8");
  await rename(tmp, path);
}

/**
 * JSON 配置变换落盘：损坏跳过并告警；语义无变化不落盘（保护用户文件既有
 * 格式, 幂等重装/空卸载零副作用）。
 */
export async function transformJsonConfig(
  path: string,
  transform: (s: Record<string, unknown>) => Record<string, unknown>,
  label: string
): Promise<void> {
  const settings = await readJsonConfig(path);
  if (settings === null) {
    console.warn(`[agent-hooks:${label}] config unparsable, skip:`, path);
    return;
  }
  const next = transform(settings);
  if (next === settings || JSON.stringify(next) === JSON.stringify(settings)) {
    return;
  }
  await atomicWriteFile(path, `${JSON.stringify(next, null, 2)}\n`);
}
