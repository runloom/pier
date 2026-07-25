import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { CachedObservation, FileUsage } from "./file-cache.ts";

/**
 * 解析 Kimi CLI / Kimi Code CLI 会话 `wire.jsonl`。
 *
 * 布局：
 * - legacy kimi-cli：`~/.kimi/sessions/<group>/<sessionId>/wire.jsonl`
 *   （subagent：`.../subagents/<id>/wire.jsonl`）
 * - kimi-code：`~/.kimi-code/sessions/<ws>/<sessionId>/agents/<agentId>/wire.jsonl`
 *
 * 用量事件：`message.type === "StatusUpdate"` 且 payload 含 `token_usage`：
 *   { input_other, output, input_cache_read, input_cache_creation }
 *
 * StatusUpdate 不带 model；由 scanner 注入 defaultModelId。
 * fingerprint 优先 `message_id`。
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
  return new Date(ms).toISOString().slice(0, 10);
}

function sessionIdFromPath(path: string): string | null {
  // .../<sessionId>/wire.jsonl
  // .../<sessionId>/subagents/<id>/wire.jsonl
  // .../<sessionId>/agents/<agentId>/wire.jsonl
  const parts = path.split(/[/\\]/);
  const wireIdx = parts.lastIndexOf("wire.jsonl");
  if (wireIdx < 1) return null;
  const parent = parts[wireIdx - 1];
  const grand = parts[wireIdx - 2];
  if (parent === "subagents" || parent === "agents") {
    return parts[wireIdx - 3] ?? null;
  }
  if (grand === "agents" || grand === "subagents") {
    return parts[wireIdx - 3] ?? null;
  }
  return parent ?? null;
}

export async function scanKimiUsageFile(
  path: string,
  from: string,
  defaultModelId: string | null
): Promise<FileUsage> {
  const fileStat = await stat(path);
  let malformedLines = 0;
  let lineNumber = 0;
  const observations: CachedObservation[] = [];
  const sessionId = sessionIdFromPath(path);

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

      const message = asRecord(event.message);
      if (!message) continue;
      if (stringField(message, "type") !== "StatusUpdate") continue;
      const payload = asRecord(message.payload);
      if (!payload) continue;
      const tokenUsage = asRecord(payload.token_usage);
      if (!tokenUsage) continue;

      const timestamp = event.timestamp;
      let date: string | null = null;
      if (typeof timestamp === "number") {
        date = epochToDate(timestamp);
      } else if (typeof timestamp === "string" && timestamp.length >= 10) {
        date = timestamp.slice(0, 10);
      }
      if (!date || date < from || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

      const inputOther = numeric(tokenUsage, "input_other", "inputOther");
      const cacheRead = numeric(
        tokenUsage,
        "input_cache_read",
        "inputCacheRead",
        "cache_read"
      );
      const cacheWrite = numeric(
        tokenUsage,
        "input_cache_creation",
        "inputCacheCreation",
        "cache_write"
      );
      const output = numeric(tokenUsage, "output", "output_tokens");
      const inputTokens = inputOther + cacheRead + cacheWrite;
      if (inputTokens + output === 0) continue;

      const fingerprint =
        stringField(payload, "message_id", "messageId") ??
        `${date}:${lineNumber}`;

      observations.push({
        fingerprint,
        usage: {
          cachedInputTokens: cacheRead,
          date,
          inputTokens,
          modelId: defaultModelId,
          outputTokens: output,
          reasoningTokens: 0,
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
