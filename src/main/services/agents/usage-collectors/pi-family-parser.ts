import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { CachedObservation, FileUsage } from "./file-cache.ts";

/**
 * 解析 pi / omp 家族会话 jsonl 文件（pi = `~/.pi/agent/sessions/`；
 * omp = `~/.omp/agent/sessions/`，omp 是 pi 的 fork，格式一致）。
 *
 * 格式（pi-mono session v3，参见 `packages/coding-agent/docs/session-format.md`）：
 * - 首行是 `{type: "session", id, cwd, ...}` header，跳过。
 * - 后续 `{type: "message", id, parentId, timestamp, message: {...}}` 条目。
 * - assistant 消息形如：
 *   ```
 *   { role: "assistant", provider, model,
 *     usage: { input, output, cacheRead, cacheWrite, totalTokens, cost: {...} } }
 *   ```
 * - `usage.input` 是"non-cached, non-cache-write"输入 tokens；`cacheRead` 是读缓存；
 *   `cacheWrite` 是写缓存。归并策略同 Claude Code parser：cacheWrite 并入
 *   `inputTokens`（约 25% 保守低估，pricing 未建 cache-write 桶）；cacheRead
 *   同时计入总 `inputTokens`，并作为其中的 `cachedInputTokens` 子集。
 * - Fingerprint 用 entry `id`（同文件内唯一 8-char hex）；session 层用 header id
 *   跨文件去重（同一 session 分裂到 fork 时重复上报）。
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

export async function scanPiFamilyUsageFile(
  path: string,
  from: string
): Promise<FileUsage> {
  const fileStat = await stat(path);
  let malformedLines = 0;
  let sessionId: string | null = null;
  let forkedFromId: string | null = null;
  let lineNumber = 0;
  const observations: CachedObservation[] = [];
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
      if (event.type === "session") {
        sessionId = stringField(event, "id");
        // parentSession 是 opaque lineage 字符串（session id 或路径都可能）；
        // 用于跨会话去重根。
        forkedFromId = stringField(event, "parentSession");
        continue;
      }
      if (event.type !== "message") continue;
      const message = usageRecord(event.message);
      if (message?.role !== "assistant") continue;
      const usage = usageRecord(message.usage);
      if (!usage) continue;
      const timestamp = stringField(event, "timestamp");
      const date = timestamp?.slice(0, 10);
      if (!date || date < from || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

      const rawInput = numeric(usage, "input");
      const cacheWrite = numeric(usage, "cacheWrite");
      const cacheRead = numeric(usage, "cacheRead");
      const output = numeric(usage, "output");
      const inputTokens = rawInput + cacheWrite + cacheRead;
      if (inputTokens + output === 0) continue;

      const modelId = stringField(message, "model", "modelId");
      // pi/omp 没有独立 serviceTier 字段在 usage 里（有独立
      // `service_tier_change` entry）；先留 null，模型级别定价已够。
      const fingerprint =
        stringField(event, "id") ?? `${timestamp ?? ""}:${lineNumber}`;

      observations.push({
        fingerprint,
        usage: {
          cachedInputTokens: cacheRead,
          date,
          inputTokens,
          modelId,
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
    forkedFromId,
    malformedLines,
    modifiedAt: fileStat.mtimeMs,
    observations,
    sessionId,
    size: fileStat.size,
  };
}
