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
 * Cline CLI 用量：`~/.cline/data/sessions/<id>/<id>.json` 的
 * `metadata.usage` / `metadata.aggregateUsage`。
 */

export const CLINE_USAGE_SOURCE_ID = "cline-local-sessions";

async function safeReadDir(path: string): Promise<Dirent[]> {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

export const createClineUsageCollector: AgentUsageCollectorFactory = (
  context
): AgentUsageCollector => {
  const sessionsRoot = join(
    context.env.HOME ?? homedir(),
    ".cline",
    "data",
    "sessions"
  );
  return {
    agentId: "cline",
    detect: () =>
      existsSync(sessionsRoot) ||
      existsSync(join(context.env.HOME ?? homedir(), ".cline")),
    sourceId: CLINE_USAGE_SOURCE_ID,
    async rescan() {
      const { from, to } = coverageWindow();
      const observations: CachedTokenUsage[] = [];
      for (const entry of await safeReadDir(sessionsRoot)) {
        if (!entry.isDirectory()) continue;
        const path = join(sessionsRoot, entry.name, `${entry.name}.json`);
        try {
          const info = await stat(path);
          if (info.mtimeMs < Date.parse(`${from}T00:00:00Z`)) continue;
          const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
          const session = asRecord(raw);
          if (!session) continue;
          const metadata = asRecord(session.metadata);
          const usage =
            asRecord(metadata?.aggregateUsage) ?? asRecord(metadata?.usage);
          if (!usage) continue;
          const date =
            isoToDate(stringField(session, "started_at", "ended_at")) ??
            isoToDate(stringField(metadata ?? {}, "updated_at"));
          if (!date || date < from || date > to) continue;
          const cacheRead = numeric(
            usage.cacheReadTokens ?? usage.cachedInputTokens
          );
          const cacheWrite = numeric(usage.cacheWriteTokens);
          const rawInput = numeric(usage.inputTokens);
          const obs = makeObservation({
            cachedInputTokens: cacheRead,
            date,
            inputTokens: rawInput + cacheRead + cacheWrite,
            modelId: stringField(session, "model"),
            outputTokens: numeric(usage.outputTokens),
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
        sourceId: CLINE_USAGE_SOURCE_ID,
        to,
      });
    },
  };
};
