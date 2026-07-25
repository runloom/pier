import type { Dirent } from "node:fs";
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CachedTokenUsage } from "./file-cache.ts";
import {
  asRecord,
  coverageWindow,
  isoToDate,
  makeObservation,
  numeric,
  publishInputFromUsages,
  stringField,
} from "./observation-utils.ts";
import type {
  AgentUsageCollector,
  AgentUsageCollectorFactory,
} from "./types.ts";

/**
 * Droid (Factory AI) 用量：`~/.factory/sessions/<cwd>/<sessionId>.settings.json`
 * 的 `inclusiveTokenUsage` / `tokenUsage`。
 */

export const DROID_USAGE_SOURCE_ID = "droid-local-sessions";

async function safeReadDir(path: string): Promise<Dirent[]> {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function collectSettingsFiles(
  dir: string,
  fromEpochMs: number,
  out: string[]
): Promise<void> {
  for (const entry of await safeReadDir(dir)) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectSettingsFiles(path, fromEpochMs, out);
      continue;
    }
    if (!(entry.isFile() && entry.name.endsWith(".settings.json"))) continue;
    try {
      const info = await stat(path);
      if (info.mtimeMs >= fromEpochMs) out.push(path);
    } catch {
      // skip
    }
  }
}

export const createDroidUsageCollector: AgentUsageCollectorFactory = (
  context
): AgentUsageCollector => {
  const sessionsRoot = join(
    context.env.HOME ?? homedir(),
    ".factory",
    "sessions"
  );
  return {
    agentId: "droid",
    detect: () =>
      existsSync(sessionsRoot) ||
      existsSync(join(context.env.HOME ?? homedir(), ".factory")),
    sourceId: DROID_USAGE_SOURCE_ID,
    async rescan() {
      const { from, to } = coverageWindow();
      const fromEpochMs = Date.parse(`${from}T00:00:00Z`);
      const files: string[] = [];
      await collectSettingsFiles(sessionsRoot, fromEpochMs, files);
      const observations: CachedTokenUsage[] = [];
      for (const path of files) {
        try {
          const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
          const session = asRecord(raw);
          if (!session) continue;
          const usage =
            asRecord(session.inclusiveTokenUsage) ??
            asRecord(session.tokenUsage);
          if (!usage) continue;
          const info = await stat(path);
          const date =
            isoToDate(stringField(session, "providerLockTimestamp")) ??
            new Date(info.mtimeMs).toISOString().slice(0, 10);
          if (date < from || date > to) continue;
          const cacheRead = numeric(
            usage.cacheReadTokens ?? usage.cachedInputTokens
          );
          const cacheWrite = numeric(
            usage.cacheCreationTokens ?? usage.cacheWriteTokens
          );
          const rawInput = numeric(usage.inputTokens);
          const obs = makeObservation({
            cachedInputTokens: cacheRead,
            date,
            inputTokens: rawInput + cacheRead + cacheWrite,
            modelId: stringField(session, "model"),
            outputTokens: numeric(usage.outputTokens),
            reasoningTokens: numeric(
              usage.thinkingTokens ?? usage.reasoningTokens
            ),
          });
          if (obs) observations.push(obs);
        } catch {
          // skip
        }
      }
      if (observations.length === 0) return null;
      return publishInputFromUsages({
        from,
        observations,
        sourceId: DROID_USAGE_SOURCE_ID,
        to,
      });
    },
  };
};
