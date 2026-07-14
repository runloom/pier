import { readFile, stat } from "node:fs/promises";
import type { CachedObservation, FileUsage } from "./file-cache.ts";

/**
 * 解析 OpenCode（sst.opencode / anomalyco 生态）会话消息文件。
 *
 * 存储 layout（v1.2.0 之前的 JSON storage 版本）：
 *   `~/.local/share/opencode/storage/session/message/<sessionID>/<messageID>.json`
 * 每文件是**一个消息对象**（UserMessage / AssistantMessage）。用户消息不
 * 携带 token；本 parser 只取 assistant。
 *
 * AssistantMessage 结构（`@opencode-ai/sdk`）：
 *   {
 *     id, sessionID, role: "assistant",
 *     time: { created, completed },  // unix ms
 *     modelID, providerID,           // bare model id + provider id
 *     cost,                          // pre-calculated USD if provider supports
 *     tokens: {
 *       input, output, reasoning,
 *       cache: { read, write }
 *     }
 *   }
 *
 * 归并策略同 pi/omp/claude parser：`tokens.cache.write` 并入 `inputTokens`
 * （pricing 未建 cache-write 桶，保守低估约 25%）；`tokens.cache.read` 归入
 * `cachedInputTokens`；`tokens.reasoning` 单独进 `reasoningTokens`。
 *
 * ⚠️ OpenCode v1.2.0+ 已切换到 SQLite（`opencode.db`），JSON storage 不再
 * 被写入。此 parser 只覆盖历史 JSON 文件，新版数据需要 SQLite 支持（待）。
 */

function numeric(record: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = record[key];
    if (
      typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0
    ) {
      return value;
    }
  }
  return 0;
}

function usageRecord(raw: unknown): Record<string, unknown> | null {
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

function timestampField(record: Record<string, unknown>): number | null {
  const time = usageRecord(record.time);
  if (!time) return null;
  const created = time.created;
  if (typeof created === "number" && Number.isFinite(created) && created > 0) {
    return created;
  }
  return null;
}

export async function scanOpenCodeUsageFile(
  path: string,
  fromEpochMs: number
): Promise<FileUsage> {
  const fileStat = await stat(path);
  let malformedLines = 0;
  const observations: CachedObservation[] = [];
  let sessionId: string | null = null;
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const message = usageRecord(parsed);
    if (!message) {
      malformedLines = 1;
      return {
        forkedFromId: null,
        malformedLines,
        modifiedAt: fileStat.mtimeMs,
        observations,
        sessionId,
        size: fileStat.size,
      };
    }
    sessionId = stringField(message, "sessionID", "sessionId");
    if (message.role !== "assistant") {
      return {
        forkedFromId: null,
        malformedLines,
        modifiedAt: fileStat.mtimeMs,
        observations,
        sessionId,
        size: fileStat.size,
      };
    }
    const tokens = usageRecord(message.tokens);
    if (!tokens) {
      return {
        forkedFromId: null,
        malformedLines,
        modifiedAt: fileStat.mtimeMs,
        observations,
        sessionId,
        size: fileStat.size,
      };
    }
    const created = timestampField(message);
    if (!created || created < fromEpochMs) {
      return {
        forkedFromId: null,
        malformedLines,
        modifiedAt: fileStat.mtimeMs,
        observations,
        sessionId,
        size: fileStat.size,
      };
    }
    const cache = usageRecord(tokens.cache);
    const rawInput = numeric(tokens, "input");
    const cacheWrite = cache ? numeric(cache, "write") : 0;
    const cacheRead = cache ? numeric(cache, "read") : 0;
    const output = numeric(tokens, "output");
    const reasoning = numeric(tokens, "reasoning");
    const inputTokens = rawInput + cacheWrite + cacheRead;
    if (inputTokens + output === 0) {
      return {
        forkedFromId: null,
        malformedLines,
        modifiedAt: fileStat.mtimeMs,
        observations,
        sessionId,
        size: fileStat.size,
      };
    }
    const modelId = stringField(message, "modelID", "modelId");
    // OpenCode 消息层无 serviceTier；按模型定价即可。
    const fingerprint = stringField(message, "id") ?? path;

    observations.push({
      fingerprint,
      usage: {
        cachedInputTokens: cacheRead,
        date: new Date(created).toISOString().slice(0, 10),
        inputTokens,
        modelId,
        outputTokens: output,
        reasoningTokens: reasoning,
        serviceTier: null,
      },
    });
  } catch {
    malformedLines = 1;
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
