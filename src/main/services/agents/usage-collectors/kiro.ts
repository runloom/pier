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
 * Kiro CLI 用量：`~/.kiro/sessions` 下会话 JSON 快照中的
 * `input_token_count` / `output_token_count`（递归提取非零字段）。
 *
 * 注意：本机样本里多数 turn 计数为 0（订阅路径可能不落明细）；有非零时才入库。
 */

export const KIRO_USAGE_SOURCE_ID = "kiro-local-sessions";

async function safeReadDir(path: string): Promise<Dirent[]> {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function collectSessionFiles(
  dir: string,
  fromEpochMs: number,
  out: string[]
): Promise<void> {
  for (const entry of await safeReadDir(dir)) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectSessionFiles(path, fromEpochMs, out);
      continue;
    }
    if (!(entry.isFile() && entry.name.endsWith(".json"))) continue;
    try {
      const info = await stat(path);
      if (info.mtimeMs >= fromEpochMs) out.push(path);
    } catch {
      // skip
    }
  }
}

function walkTokenFields(
  node: unknown,
  hits: Array<{ input: number; output: number; at?: string }>
): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walkTokenFields(item, hits);
    return;
  }
  const record = node as Record<string, unknown>;
  const input = numeric(
    record.input_token_count ?? record.inputTokenCount ?? record.input_tokens
  );
  const output = numeric(
    record.output_token_count ?? record.outputTokenCount ?? record.output_tokens
  );
  if (input + output > 0) {
    hits.push({
      at:
        stringField(record, "timestamp", "created_at", "updated_at") ??
        undefined,
      input,
      output,
    });
  }
  for (const value of Object.values(record)) {
    if (value && typeof value === "object") walkTokenFields(value, hits);
  }
}

export const createKiroUsageCollector: AgentUsageCollectorFactory = (
  context
): AgentUsageCollector => {
  const sessionsRoot = join(context.env.HOME ?? homedir(), ".kiro", "sessions");
  return {
    agentId: "kiro",
    detect: () =>
      existsSync(sessionsRoot) ||
      existsSync(join(context.env.HOME ?? homedir(), ".kiro")),
    sourceId: KIRO_USAGE_SOURCE_ID,
    async rescan() {
      const { from, to } = coverageWindow();
      const fromEpochMs = Date.parse(`${from}T00:00:00Z`);
      const files: string[] = [];
      await collectSessionFiles(sessionsRoot, fromEpochMs, files);
      const observations: CachedTokenUsage[] = [];
      for (const path of files) {
        try {
          const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
          const session = asRecord(raw);
          if (!session) continue;
          const sessionDate =
            isoToDate(stringField(session, "updated_at", "created_at")) ??
            new Date((await stat(path)).mtimeMs).toISOString().slice(0, 10);
          if (sessionDate < from || sessionDate > to) continue;
          const hits: Array<{ input: number; output: number; at?: string }> =
            [];
          walkTokenFields(session, hits);
          let inputSum = 0;
          let outputSum = 0;
          for (const hit of hits) {
            inputSum += hit.input;
            outputSum += hit.output;
          }
          const usage = makeObservation({
            date: sessionDate,
            inputTokens: inputSum,
            modelId: null,
            outputTokens: outputSum,
          });
          if (usage) observations.push(usage);
        } catch {
          // skip
        }
      }
      if (observations.length === 0) return null;
      return publishInputFromUsages({
        from,
        observations,
        sourceId: KIRO_USAGE_SOURCE_ID,
        to,
      });
    },
  };
};
