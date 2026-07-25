import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CachedTokenUsage } from "./file-cache.ts";
import {
  coverageWindow,
  epochToDate,
  makeObservation,
  numeric,
  publishInputFromUsages,
} from "./observation-utils.ts";
import { withSqliteReader } from "./sqlite-reader.ts";
import type {
  AgentUsageCollector,
  AgentUsageCollectorFactory,
} from "./types.ts";

/**
 * Hermes Agent 用量：`~/.hermes/state.db` 的 `sessions` 表
 * （input_tokens / output_tokens / cache_* / reasoning_tokens / model）。
 */

export const HERMES_USAGE_SOURCE_ID = "hermes-local-sessions";

interface HermesSessionRow {
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  id: string;
  input_tokens: number | null;
  model: string | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  started_at: number | null;
}

export const createHermesUsageCollector: AgentUsageCollectorFactory = (
  context
): AgentUsageCollector => {
  const dbPath = join(context.env.HOME ?? homedir(), ".hermes", "state.db");
  return {
    agentId: "hermes",
    detect: () =>
      existsSync(dbPath) ||
      existsSync(join(context.env.HOME ?? homedir(), ".hermes")),
    sourceId: HERMES_USAGE_SOURCE_ID,
    async rescan() {
      if (!existsSync(dbPath)) return null;
      const { from, to } = coverageWindow();
      let rows: readonly HermesSessionRow[] = [];
      try {
        const scanned = withSqliteReader({ path: dbPath }, (reader) => {
          if (!reader.tableExists("sessions")) return null;
          return reader.query<HermesSessionRow>(
            `SELECT id, model, started_at, input_tokens, output_tokens,
                    cache_read_tokens, cache_write_tokens, reasoning_tokens
             FROM sessions
             WHERE COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)
                   + COALESCE(reasoning_tokens, 0) > 0`
          );
        });
        if (scanned === null) return null;
        rows = scanned;
      } catch (error: unknown) {
        context.logger.warn("hermes usage scan failed", {
          error: error instanceof Error ? error.message : error,
        });
        return null;
      }

      const observations: CachedTokenUsage[] = [];
      for (const row of rows) {
        const date = epochToDate(numeric(row.started_at));
        if (!date || date < from || date > to) continue;
        const cacheRead = numeric(row.cache_read_tokens);
        const cacheWrite = numeric(row.cache_write_tokens);
        const rawInput = numeric(row.input_tokens);
        const usage = makeObservation({
          cachedInputTokens: cacheRead,
          date,
          inputTokens: rawInput + cacheRead + cacheWrite,
          modelId: row.model,
          outputTokens: numeric(row.output_tokens),
          reasoningTokens: numeric(row.reasoning_tokens),
        });
        if (usage) observations.push(usage);
      }
      if (observations.length === 0) return null;
      return publishInputFromUsages({
        from,
        observations,
        sourceId: HERMES_USAGE_SOURCE_ID,
        to,
      });
    },
  };
};
