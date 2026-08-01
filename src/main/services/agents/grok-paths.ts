import { homedir } from "node:os";
import { join } from "node:path";

/** Grok 官方配置根目录：优先 GROK_HOME，空白值按未设置处理。 */
export function resolveGrokHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.GROK_HOME?.trim();
  if (override) {
    return override;
  }
  return join(env.HOME?.trim() || homedir(), ".grok");
}

export function resolveGrokSessionsRoot(
  env: NodeJS.ProcessEnv = process.env
): string {
  return join(resolveGrokHome(env), "sessions");
}
