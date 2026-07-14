import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { CachedObservation, FileUsage } from "./file-cache.ts";

/**
 * 解析 Claude Code 单个会话 jsonl 文件（`~/.claude/projects/<slug>/<sessionId>.jsonl`
 * 或 `agent-<agentId>.jsonl`）。抽出规范化 token 观测：
 *
 * - 只关心 `type === "assistant"` 且 `message.usage` 存在的行。
 * - 每行的 `message.usage` 是**单次 API 调用**的 token 计数（非累积），直接取。
 * - `message.model` 是模型 id；`timestamp` 是 ISO 时间。
 * - 用 `message.id`（`msg_01...`）作去重指纹，兜底用 `uuid`。防 stream-json
 *   模式下同一 assistant message 分块产生的重复上报（anthropics/claude-code
 *   issue#6805）。
 * - `cache_creation_input_tokens` 归入 `inputTokens`（当前 pricing 未建模
 *   cache write 桶）。这是保守低估（cache write 单价约 1.25x input），
 *   总成本典型偏差 < 25%。精确桶可后续 PR 引入。
 *   `cache_read_input_tokens` 同时计入总 `inputTokens`，并作为其中的
 *   `cachedInputTokens` 子集供定价使用。
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

export async function scanClaudeCodeUsageFile(
  path: string,
  from: string
): Promise<FileUsage> {
  const fileStat = await stat(path);
  let malformedLines = 0;
  let sessionId: string | null = null;
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
      // 从任意消息类型抓 sessionId（summary/user/assistant 都带；缺失时留 null）。
      sessionId ??= stringField(event, "sessionId");
      if (event.type !== "assistant") continue;
      const message = usageRecord(event.message);
      if (!message) continue;
      const usage = usageRecord(message.usage);
      if (!usage) continue;
      const timestamp = stringField(event, "timestamp");
      const date = timestamp?.slice(0, 10);
      if (!date || date < from || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

      const cacheRead = numeric(
        usage,
        "cache_read_input_tokens",
        "cacheReadInputTokens"
      );
      const cacheCreation = numeric(
        usage,
        "cache_creation_input_tokens",
        "cacheCreationInputTokens"
      );
      // Claude Code 的 `input_tokens` 已是"non-cached, non-cache-write"输入；
      // cache_creation 单独一栏。归并策略见文件头注释。
      const rawInput = numeric(usage, "input_tokens", "inputTokens");
      const inputTokens = rawInput + cacheCreation + cacheRead;
      const outputTokens = numeric(usage, "output_tokens", "outputTokens");
      if (inputTokens + outputTokens === 0) continue;

      const modelId = stringField(message, "model");
      const serviceTier = stringField(usage, "service_tier", "serviceTier");
      const fingerprint =
        stringField(message, "id") ??
        stringField(event, "uuid", "requestId") ??
        `${timestamp ?? ""}:${lineNumber}`;

      observations.push({
        fingerprint,
        usage: {
          cachedInputTokens: cacheRead,
          date,
          inputTokens,
          modelId,
          outputTokens,
          // Claude 上游未暴露 reasoning tokens；即便未来引入也需要新契约字段。
          reasoningTokens: 0,
          serviceTier,
        },
      });
    }
  } catch {
    malformedLines += 1;
  }
  return {
    // Claude Code sessions 不做 fork；血统由 parentUuid 链在 message 层维护，
    // 但对 usage 去重无用（我们用 message.id 唯一）。
    forkedFromId: null,
    malformedLines,
    modifiedAt: fileStat.mtimeMs,
    observations,
    sessionId,
    size: fileStat.size,
  };
}
