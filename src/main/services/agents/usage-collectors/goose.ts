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
 * Goose 用量：`~/.local/share/goose/sessions/sessions.db` 的
 * `usage_ledger` 表（按次请求；含 model / input / output / cache）。
 */

export const GOOSE_USAGE_SOURCE_ID = "goose-local-sessions";

interface GooseLedgerRow {
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  created_timestamp: number | null;
  id: number;
  input_tokens: number | null;
  model: string | null;
  output_tokens: number | null;
  session_id: string | null;
}

function resolveGooseDb(env: NodeJS.ProcessEnv): string {
  if (env.GOOSE_PATH_ROOT && env.GOOSE_PATH_ROOT.length > 0) {
    return join(env.GOOSE_PATH_ROOT, "sessions", "sessions.db");
  }
  const xdg = env.XDG_DATA_HOME;
  if (xdg && xdg.length > 0) {
    return join(xdg, "goose", "sessions", "sessions.db");
  }
  return join(
    env.HOME ?? homedir(),
    ".local",
    "share",
    "goose",
    "sessions",
    "sessions.db"
  );
}

export const createGooseUsageCollector: AgentUsageCollectorFactory = (
  context
): AgentUsageCollector => {
  const dbPath = resolveGooseDb(context.env);
  return {
    agentId: "goose",
    detect: () => existsSync(dbPath),
    sourceId: GOOSE_USAGE_SOURCE_ID,
    async rescan() {
      if (!existsSync(dbPath)) return null;
      const { from, to } = coverageWindow();
      let rows: readonly GooseLedgerRow[] = [];
      try {
        const scanned = withSqliteReader({ path: dbPath }, (reader) => {
          if (!reader.tableExists("usage_ledger")) return null;
          return reader.query<GooseLedgerRow>(
            `SELECT id, session_id, created_timestamp, model,
                    input_tokens, output_tokens, cache_read_tokens, cache_write_tokens
             FROM usage_ledger
             WHERE COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0) > 0`
          );
        });
        if (scanned === null) return null;
        rows = scanned;
      } catch (error: unknown) {
        context.logger.warn("goose usage scan failed", {
          error: error instanceof Error ? error.message : error,
        });
        return null;
      }

      const observations: CachedTokenUsage[] = [];
      for (const row of rows) {
        const date = epochToDate(numeric(row.created_timestamp));
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
        });
        if (usage) observations.push(usage);
      }
      if (observations.length === 0) return null;
      return publishInputFromUsages({
        from,
        observations,
        sourceId: GOOSE_USAGE_SOURCE_ID,
        to,
      });
    },
  };
};
