import type {
  UsageDataPublishInput,
  UsageTokenObservation,
} from "@pier/plugin-api/main";
import { dateDaysAgo, todayDate } from "./date-range.ts";
import { openSqliteReader, type SqliteReader } from "./sqlite-reader.ts";

/**
 * OpenCode v1.2.0+ SQLite storage scanner。
 *
 * 数据源：`<OPENCODE_DATA_DIR>/opencode.db`（默认 `~/.local/share/opencode/`）。
 * Schema（业界现有 CLI 工具已验证：gaboe/opencode-usage、opencode-token-monitor）：
 *   CREATE TABLE message (
 *     id TEXT PRIMARY KEY,
 *     session_id TEXT NOT NULL,
 *     time_created INTEGER NOT NULL,  -- unix ms
 *     data TEXT NOT NULL              -- JSON blob of AssistantMessage / UserMessage
 *   );
 *
 * `data` JSON 结构与 v1.2.0 之前的每 message-JSON 文件版本一致：
 *   { role, modelID, providerID, tokens: { input, output, reasoning,
 *     cache: { read, write } }, time: {...}, ... }
 *
 * schema-drift 容忍：所有列存在性都用 `PRAGMA table_info` 检测；缺失列或缺表
 * 直接返回 null，让上层 collector 走 JSON storage fallback。
 *
 * 只读打开 + busy timeout：与 OpenCode 主进程并发写入兼容（WAL 模式下多读一写
 * 是 SQLite 官方允许模式；只读连接不会锁写）。
 */

const OPENCODE_USAGE_PERIOD_DAYS = 31;
const REQUIRED_COLUMNS: readonly string[] = [
  "id",
  "session_id",
  "time_created",
  "data",
];

export const OPENCODE_SQLITE_USAGE_SOURCE_ID = "opencode-sqlite-sessions";

interface MessageRow {
  data: string;
  id: string;
  session_id: string;
  time_created: number;
}

export interface OpenCodeSqliteDiagnostics {
  malformedRows: number;
  rowsRead: number;
  schemaValid: boolean;
  uniqueEvents: number;
}

export interface OpenCodeSqliteScanResult {
  diagnostics: OpenCodeSqliteDiagnostics;
  input: UsageDataPublishInput;
}

function numericField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  return 0;
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

function objectField(
  record: Record<string, unknown>,
  key: string
): Record<string, unknown> | null {
  const value = record[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

interface AssistantExtract {
  cachedInputTokens: number;
  fingerprint: string;
  inputTokens: number;
  modelId: string | null;
  outputTokens: number;
  reasoningTokens: number;
}

function extractAssistantUsage(row: MessageRow): AssistantExtract | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.data);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const message = parsed as Record<string, unknown>;
  if (message.role !== "assistant") return null;
  const tokens = objectField(message, "tokens");
  if (!tokens) return null;
  const cache = objectField(tokens, "cache");
  const rawInput = numericField(tokens, "input");
  const cacheWrite = cache ? numericField(cache, "write") : 0;
  const cacheRead = cache ? numericField(cache, "read") : 0;
  const output = numericField(tokens, "output");
  const reasoning = numericField(tokens, "reasoning");
  const inputTokens = rawInput + cacheWrite + cacheRead;
  if (inputTokens + output === 0) return null;
  const modelId = stringField(message, "modelID", "modelId");
  return {
    cachedInputTokens: cacheRead,
    // `id` 是 message id，全库唯一——最理想的 dedup 指纹。
    fingerprint: row.id,
    inputTokens,
    modelId,
    outputTokens: output,
    reasoningTokens: reasoning,
  };
}

function validateSchema(reader: SqliteReader): boolean {
  if (!reader.tableExists("message")) return false;
  const columnNames = new Set(
    reader.describeColumns("message").map((col) => col.name)
  );
  return REQUIRED_COLUMNS.every((name) => columnNames.has(name));
}

interface ScanCoreArgs {
  from: string;
  fromEpochMs: number;
  reader: SqliteReader;
  to: string;
}

function scanCore({
  from,
  fromEpochMs,
  reader,
  to,
}: ScanCoreArgs): OpenCodeSqliteScanResult {
  const diagnostics: OpenCodeSqliteDiagnostics = {
    malformedRows: 0,
    rowsRead: 0,
    schemaValid: true,
    uniqueEvents: 0,
  };
  const rows = reader.query<MessageRow>(
    "SELECT id, session_id, time_created, data FROM message WHERE time_created >= ? ORDER BY time_created ASC",
    fromEpochMs
  );
  diagnostics.rowsRead = rows.length;
  // 按 message id 去重（同一 message 罕见分多行，但保底防护）。
  const observations = new Map<string, UsageTokenObservation>();
  for (const row of rows) {
    const extract = extractAssistantUsage(row);
    if (!extract) {
      // 只有当 JSON 完全 malformed 或非 assistant 才算"malformed"——非 assistant
      // 的 UserMessage 是正常业务；把两者分开会让统计噪杂。这里保守只
      // 累加 JSON.parse 完全失败的行。
      try {
        JSON.parse(row.data);
      } catch {
        diagnostics.malformedRows += 1;
      }
      continue;
    }
    const date = new Date(row.time_created).toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < from) continue;
    observations.set(extract.fingerprint, {
      cachedInputTokens: extract.cachedInputTokens,
      date,
      eventId: extract.fingerprint,
      inputTokens: extract.inputTokens,
      modelId: extract.modelId,
      outputTokens: extract.outputTokens,
      reasoningTokens: extract.reasoningTokens,
    });
  }
  diagnostics.uniqueEvents = observations.size;
  return {
    diagnostics,
    input: {
      coverage: {
        complete: diagnostics.malformedRows === 0,
        from,
        to,
      },
      observations: [...observations.values()],
      observedAt: Date.now(),
      scope: { kind: "machine" },
      sourceId: OPENCODE_SQLITE_USAGE_SOURCE_ID,
    },
  };
}

export interface OpenCodeSqliteScanner {
  scan(): Promise<OpenCodeSqliteScanResult | null>;
}

/**
 * 构造一个 OpenCode SQLite scanner。返回值为 null 表示：
 * - DB 文件不存在（用户未装 OpenCode 或用老 JSON storage 版）
 * - schema 校验失败（表 / 列缺失，可能是更新版本或损坏）
 *
 * 上层 collector 拿 null 时走 JSON storage fallback，保证向后兼容。
 */
export function createOpenCodeSqliteScanner(options: {
  busyTimeoutMs?: number;
  dbPath: string;
}): OpenCodeSqliteScanner {
  let inFlight: Promise<OpenCodeSqliteScanResult | null> | null = null;

  async function scanOnce(): Promise<OpenCodeSqliteScanResult | null> {
    const reader = openSqliteReader({
      ...(options.busyTimeoutMs === undefined
        ? {}
        : { busyTimeoutMs: options.busyTimeoutMs }),
      path: options.dbPath,
    });
    if (!reader) return null;
    try {
      if (!validateSchema(reader)) {
        return {
          diagnostics: {
            malformedRows: 0,
            rowsRead: 0,
            schemaValid: false,
            uniqueEvents: 0,
          },
          input: {
            coverage: {
              complete: false,
              from: dateDaysAgo(0),
              to: todayDate(),
            },
            observations: [],
            observedAt: Date.now(),
            scope: { kind: "machine" },
            sourceId: OPENCODE_SQLITE_USAGE_SOURCE_ID,
          },
        };
      }
      const from = dateDaysAgo(OPENCODE_USAGE_PERIOD_DAYS - 1);
      const to = todayDate();
      const fromEpochMs = new Date(`${from}T00:00:00Z`).getTime();
      return scanCore({ from, fromEpochMs, reader, to });
    } finally {
      reader.close();
    }
  }

  return {
    scan(): Promise<OpenCodeSqliteScanResult | null> {
      if (inFlight) return inFlight;
      inFlight = scanOnce().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };
}
