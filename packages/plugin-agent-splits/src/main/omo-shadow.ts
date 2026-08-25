import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * OpenCode 可视化 shadow 配置（金标准 §7.5）：
 * 不改 ~/.config/opencode，在插件 workDir 下建 shadow 目录，
 * OPENCODE_CONFIG_DIR 指向它。上游键名集中在此一处，便于适配。
 * 失败不阻断启动：调用方降级为仅适配器（T2）。
 */

export const OMO_PLUGIN_NAME = "oh-my-openagent";
/** 上游 tmux 可视化键名（集中一处，适配上游更名）。 */
export const OMO_TMUX_VISUALIZATION_KEY = "tmux_visualization";
export const OMO_PORT = 4096;

export interface OmoShadowResult {
  dir: string;
  error?: string;
  ok: boolean;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function ensureOmoShadow(workDir: string): OmoShadowResult {
  const dir = join(workDir, "omo-config");
  const configPath = join(dir, "config.json");
  try {
    mkdirSync(dir, { recursive: true });
    const existing = asRecord(
      JSON.parse(
        existsSync(configPath) ? readFileSync(configPath, "utf8") : "{}"
      )
    );
    const plugins = Array.isArray(existing.plugin)
      ? [...existing.plugin.map(String)]
      : [];
    if (!plugins.includes(OMO_PLUGIN_NAME)) {
      plugins.push(OMO_PLUGIN_NAME);
    }
    const merged = {
      ...existing,
      plugin: plugins,
      [OMO_TMUX_VISUALIZATION_KEY]: true,
    };
    writeFileSync(configPath, `${JSON.stringify(merged, null, 2)}\n`);
    return { ok: true, dir };
  } catch (err) {
    return {
      ok: false,
      dir,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
