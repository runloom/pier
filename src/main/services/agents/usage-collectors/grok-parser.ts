import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { CachedObservation, FileUsage } from "./file-cache.ts";

/**
 * 解析 Grok Build CLI 会话 `updates.jsonl`
 * （`~/.grok/sessions/<cwd>/<sessionId>/updates.jsonl`）。
 *
 * 权威用量事件：`method === "_x.ai/session/update"` 且
 * `params.update.sessionUpdate === "turn_completed"`，带 `usage`：
 *   inputTokens / outputTokens / cachedReadTokens / reasoningTokens
 *   modelUsage: { "<model-id>": { ... } }
 *
 * fingerprint 优先 `prompt_id`，其次 `_meta.eventId`。
 */

function numeric(record: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = record[key];
    if (
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 0 &&
      Number.isSafeInteger(Math.trunc(value))
    ) {
      return Math.trunc(value);
    }
  }
  return 0;
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object"
    ? (raw as Record<string, unknown>)
    : null;
}

function stringField(
  record: Record<string, unknown>,
  ...keys: string[]
): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function epochToDate(epochSeconds: number): string | null {
  if (!Number.isFinite(epochSeconds) || epochSeconds <= 0) return null;
  const ms = epochSeconds > 1e12 ? epochSeconds : epochSeconds * 1000;
  const iso = new Date(ms).toISOString();
  return iso.slice(0, 10);
}

function resolveDate(
  params: Record<string, unknown>,
  update: Record<string, unknown>,
  topTimestamp: unknown
): string | null {
  const meta = asRecord(params._meta) ?? asRecord(update._meta);
  if (meta) {
    const agentMs = meta.agentTimestampMs;
    if (typeof agentMs === "number") {
      const date = epochToDate(agentMs);
      if (date) return date;
    }
  }
  if (typeof topTimestamp === "number") {
    return epochToDate(topTimestamp);
  }
  if (typeof topTimestamp === "string" && topTimestamp.length >= 10) {
    const sliced = topTimestamp.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(sliced)) return sliced;
  }
  return null;
}

function primaryModelId(usage: Record<string, unknown>): string | null {
  const modelUsage = asRecord(usage.modelUsage);
  if (modelUsage) {
    const keys = Object.keys(modelUsage);
    if (keys.length > 0 && keys[0]) return keys[0];
  }
  return stringField(usage, "modelId", "model", "primaryModelId");
}

export async function scanGrokUsageFile(
  path: string,
  from: string
): Promise<FileUsage> {
  const fileStat = await stat(path);
  let malformedLines = 0;
  let lineNumber = 0;
  const observations: CachedObservation[] = [];
  // path: .../sessions/<cwd>/<sessionId>/updates.jsonl
  const parts = path.split(/[/\\]/);
  const sessionId = parts.length >= 2 ? (parts.at(-2) ?? null) : null;

  const lines = createInterface({
    crlfDelay: Number.POSITIVE_INFINITY,
    input: createReadStream(path, { encoding: "utf8" }),
  });
  try {
    for await (const line of lines) {
      lineNumber += 1;
      let event: Record<string, unknown>;
      try {
        const parsed = JSON.parse(line) as unknown;
        if (!parsed || typeof parsed !== "object") continue;
        event = parsed as Record<string, unknown>;
      } catch {
        malformedLines += 1;
        continue;
      }

      const method = stringField(event, "method");
      if (method !== "_x.ai/session/update" && method !== "session/update") {
        // 仅关心 xAI 扩展 turn_completed；普通 ACP session/update 无 usage
        // 但仍可能带 totalTokens 元数据——跳过以避免双计
        continue;
      }
      const params = asRecord(event.params);
      if (!params) continue;
      const update = asRecord(params.update);
      if (!update) continue;
      if (stringField(update, "sessionUpdate") !== "turn_completed") continue;
      const usage = asRecord(update.usage);
      if (!usage) continue;

      const date = resolveDate(params, update, event.timestamp);
      if (!date || date < from || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

      const inputTokens = numeric(usage, "inputTokens", "input_tokens");
      const outputTokens = numeric(usage, "outputTokens", "output_tokens");
      const cachedInputTokens = numeric(
        usage,
        "cachedReadTokens",
        "cached_read_tokens",
        "cachedInputTokens"
      );
      const reasoningTokens = numeric(
        usage,
        "reasoningTokens",
        "reasoning_tokens"
      );
      if (inputTokens + outputTokens + reasoningTokens === 0) continue;

      const fingerprint =
        stringField(update, "prompt_id", "promptId") ??
        stringField(asRecord(params._meta) ?? {}, "eventId") ??
        `${date}:${lineNumber}`;

      observations.push({
        fingerprint,
        usage: {
          cachedInputTokens,
          date,
          inputTokens,
          modelId: primaryModelId(usage),
          outputTokens,
          reasoningTokens,
          serviceTier: null,
        },
      });
    }
  } catch {
    malformedLines += 1;
  }

  return {
    forkedFromId: null,
    malformedLines,
    modifiedAt: fileStat.mtimeMs,
    observations,
    sessionId,
    size: fileStat.size,
  };
}
