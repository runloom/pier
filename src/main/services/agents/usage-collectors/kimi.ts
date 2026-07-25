import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  createKimiUsageScanner,
  KIMI_USAGE_SOURCE_ID,
} from "./kimi-scanner.ts";
import type {
  AgentUsageCollector,
  AgentUsageCollectorFactory,
} from "./types.ts";

/**
 * Kimi CLI / Kimi Code CLI 会话用量采集器。
 *
 * 数据源（多 root）：
 * - `$KIMI_SHARE_DIR` 或 `~/.kimi` → sessions/.../wire.jsonl
 * - `$KIMI_CODE_HOME` 或 `~/.kimi-code` → sessions/.../wire.jsonl
 * - `$KIMI_DATA_DIR` 逗号分隔额外根（对齐 ccusage 约定）
 */

function home(env: NodeJS.ProcessEnv): string {
  return env.HOME ?? homedir();
}

function resolveKimiSessionsRoots(env: NodeJS.ProcessEnv): string[] {
  const roots: string[] = [];
  const seen = new Set<string>();
  const push = (path: string): void => {
    if (path.length === 0 || seen.has(path)) return;
    seen.add(path);
    roots.push(path);
  };

  const shareDir = env.KIMI_SHARE_DIR;
  if (shareDir && shareDir.length > 0) {
    push(join(shareDir, "sessions"));
  } else {
    push(join(home(env), ".kimi", "sessions"));
  }

  const codeHome = env.KIMI_CODE_HOME;
  if (codeHome && codeHome.length > 0) {
    push(join(codeHome, "sessions"));
  } else {
    push(join(home(env), ".kimi-code", "sessions"));
  }

  const dataDir = env.KIMI_DATA_DIR;
  if (dataDir && dataDir.length > 0) {
    for (const part of dataDir.split(",")) {
      const trimmed = part.trim();
      if (trimmed.length > 0) push(join(trimmed, "sessions"));
    }
  }

  return roots;
}

function resolveKimiConfigPaths(env: NodeJS.ProcessEnv): string[] {
  const paths: string[] = [];
  const shareDir = env.KIMI_SHARE_DIR;
  if (shareDir && shareDir.length > 0) {
    paths.push(join(shareDir, "config.toml"));
  } else {
    paths.push(join(home(env), ".kimi", "config.toml"));
  }
  const codeHome = env.KIMI_CODE_HOME;
  if (codeHome && codeHome.length > 0) {
    paths.push(join(codeHome, "config.toml"));
  } else {
    paths.push(join(home(env), ".kimi-code", "config.toml"));
  }
  return paths;
}

export const createKimiUsageCollector: AgentUsageCollectorFactory = (
  context
): AgentUsageCollector => {
  const sessionsRoots = resolveKimiSessionsRoots(context.env);
  const configPaths = resolveKimiConfigPaths(context.env);
  const cachePath = join(
    context.userDataDir,
    "usage-collectors",
    "kimi-cache.json"
  );
  const scanner = createKimiUsageScanner({
    cachePath,
    configPaths,
    sessionsRoots,
  });
  return {
    agentId: "kimi",
    detect: () =>
      sessionsRoots.some((root) => existsSync(root)) ||
      configPaths.some((path) => existsSync(path)),
    async rescan() {
      const result = await scanner.scan();
      if (result.diagnostics.failedFiles > 0) {
        context.logger.warn("kimi usage scan had failed files", {
          failed: result.diagnostics.failedFiles,
          malformedLines: result.diagnostics.malformedLines,
          parsed: result.diagnostics.parsedFiles,
        });
      }
      if (result.input.observations.length === 0) return null;
      return result.input;
    },
    sourceId: KIMI_USAGE_SOURCE_ID,
  };
};
