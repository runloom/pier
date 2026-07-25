import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
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
 * Crush 用量：各项目 `.crush/crush.db` 的 `sessions` 表
 * （prompt_tokens / completion_tokens）。项目索引在
 * `~/.local/share/crush/projects.json`。
 */

export const CRUSH_USAGE_SOURCE_ID = "crush-local-sessions";

interface CrushSessionRow {
  completion_tokens: number | null;
  created_at: number | null;
  id: string;
  prompt_tokens: number | null;
  updated_at: number | null;
}

function resolveProjectsIndex(env: NodeJS.ProcessEnv): string {
  const xdg = env.XDG_DATA_HOME;
  if (xdg && xdg.length > 0) {
    return join(xdg, "crush", "projects.json");
  }
  return join(
    env.HOME ?? homedir(),
    ".local",
    "share",
    "crush",
    "projects.json"
  );
}

async function listCrushDbPaths(env: NodeJS.ProcessEnv): Promise<string[]> {
  const indexPath = resolveProjectsIndex(env);
  const paths: string[] = [];
  const seen = new Set<string>();
  try {
    const raw = JSON.parse(await readFile(indexPath, "utf8")) as {
      projects?: Array<{ data_dir?: string }>;
    };
    for (const project of raw.projects ?? []) {
      if (!project.data_dir) continue;
      const db = join(project.data_dir, "crush.db");
      if (seen.has(db)) continue;
      seen.add(db);
      if (existsSync(db)) paths.push(db);
    }
  } catch {
    // no index
  }
  return paths;
}

export const createCrushUsageCollector: AgentUsageCollectorFactory = (
  context
): AgentUsageCollector => {
  const indexPath = resolveProjectsIndex(context.env);
  return {
    agentId: "crush",
    detect: () => existsSync(indexPath),
    sourceId: CRUSH_USAGE_SOURCE_ID,
    async rescan() {
      const { from, to } = coverageWindow();
      const observations: CachedTokenUsage[] = [];
      for (const dbPath of await listCrushDbPaths(context.env)) {
        try {
          withSqliteReader({ path: dbPath }, (reader) => {
            if (!reader.tableExists("sessions")) return;
            const rows = reader.query<CrushSessionRow>(
              `SELECT id, prompt_tokens, completion_tokens, created_at, updated_at
               FROM sessions
               WHERE COALESCE(prompt_tokens, 0) + COALESCE(completion_tokens, 0) > 0`
            );
            for (const row of rows) {
              const date =
                epochToDate(numeric(row.updated_at)) ??
                epochToDate(numeric(row.created_at));
              if (!date || date < from || date > to) continue;
              const usage = makeObservation({
                date,
                inputTokens: numeric(row.prompt_tokens),
                modelId: null,
                outputTokens: numeric(row.completion_tokens),
              });
              if (usage) observations.push(usage);
            }
          });
        } catch (error: unknown) {
          context.logger.warn("crush usage scan failed for db", {
            dbPath,
            error: error instanceof Error ? error.message : error,
          });
        }
      }
      if (observations.length === 0) return null;
      return publishInputFromUsages({
        from,
        observations,
        sourceId: CRUSH_USAGE_SOURCE_ID,
        to,
      });
    },
  };
};
