import fs from "node:fs/promises";
import { join } from "node:path";
import type { LogLevel, LogRecord } from "@shared/logger.ts";

const DEFAULT_RETENTION_DAYS = 14;
const DEFAULT_MAX_BYTES_PER_FILE = 100 * 1024 * 1024;
const DEFAULT_MAX_DIR_BYTES = 1024 * 1024 * 1024;
const MAX_STRING_LENGTH = 2000;
const MAX_STACK_LENGTH = 4000;
const MAX_DEPTH = 4;
const MAX_ARRAY_ITEMS = 100;
const MAX_OBJECT_KEYS = 100;
const MAX_JSONL_LINE_BYTES = 64 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;
const APP_LOG_FILE_RE = /^app-(\d{4}-\d{2}-\d{2})(?:\.\d+)?\.jsonl$/;
const SENSITIVE_KEY_NAMES: Record<string, true> = {
  accesskey: true,
  accesstoken: true,
  apikey: true,
  authtoken: true,
  authorization: true,
  cookie: true,
  csrf: true,
  password: true,
  privatekey: true,
  refreshtoken: true,
  secret: true,
  session: true,
  token: true,
};
const SENSITIVE_VALUE_PATTERNS: [RegExp, string][] = [
  [/\b(Authorization|Cookie|Set-Cookie)\s*:\s*[^\r\n]+/gi, "$1: [redacted]"],
  [/\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]"],
  [
    /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|authorization|password|secret|session|cookie)\s*[:=]\s*([^&\s]+)/gi,
    "$1=[redacted]",
  ],
  [/sk-[A-Za-z0-9]{20,}/g, "sk-[redacted]"],
  [/\bgh[pousr]_[A-Za-z0-9_]{20,}/g, "gh[token-redacted]"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, "github_pat_[redacted]"],
  [/\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, "$1[redacted]"],
  [/\bxox[baprs]-[A-Za-z0-9-]{20,}/g, "xox[token-redacted]"],
  [/\bnpm_[A-Za-z0-9]{20,}/g, "npm_[redacted]"],
  [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    "[redacted-private-key]",
  ],
];

type DiagnosticsProcessName = "main" | "renderer";

export interface DiagnosticsLogLine {
  createdAt: string;
  ctx?: unknown;
  level: LogLevel;
  msg: string;
  pid: number;
  process: DiagnosticsProcessName;
  scope?: string;
  ts: number;
  v: 1;
  [key: string]: unknown;
}

export interface DiagnosticsLogInput {
  createdAt?: string;
  ctx?: unknown;
  level: LogLevel;
  msg: string;
  pid?: number;
  process?: DiagnosticsProcessName;
  scope?: string;
  ts: number;
  [key: string]: unknown;
}

export interface DailyDiagnosticsLogWriter {
  append(record: DiagnosticsLogInput | LogRecord): Promise<void>;
  pruneExpiredLogs(): Promise<void>;
}

export interface DailyDiagnosticsLogWriterOptions {
  diagnosticsDir: string;
  maxBytesPerFile?: number;
  maxDirBytes?: number;
  now?: () => Date;
  onWriteError?: (err: unknown) => void;
  pid?: number;
  processName?: DiagnosticsProcessName;
  retentionDays?: number;
}

function truncateString(value: string, maxLength = MAX_STRING_LENGTH): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function redactString(value: string, maxLength = MAX_STRING_LENGTH): string {
  let redacted = value;
  for (const [pattern, replacement] of SENSITIVE_VALUE_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }
  return truncateString(redacted, maxLength);
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[-_\s]/g, "").toLowerCase();
  return SENSITIVE_KEY_NAMES[normalized] === true;
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfUtcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function sanitizeErrorValue(
  value: Error,
  depth: number,
  seen: WeakSet<object>
): unknown {
  return {
    name: value.name,
    message: redactString(value.message),
    ...(value.stack
      ? { stack: redactString(value.stack, MAX_STACK_LENGTH) }
      : {}),
    ...(value.cause === undefined
      ? {}
      : { cause: sanitizeValue(value.cause, depth + 1, seen) }),
  };
}

function sanitizeArrayValue(
  value: unknown[],
  depth: number,
  seen: WeakSet<object>
): unknown[] {
  const items = value
    .slice(0, MAX_ARRAY_ITEMS)
    .map((item) => sanitizeValue(item, depth + 1, seen));
  if (value.length > MAX_ARRAY_ITEMS) {
    items.push(`[truncated ${value.length - MAX_ARRAY_ITEMS} items]`);
  }
  return items;
}

function sanitizePlainObjectValue(
  value: Record<string, unknown>,
  depth: number,
  seen: WeakSet<object>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const entries = Object.entries(value);
  for (const [childKey, childValue] of entries.slice(0, MAX_OBJECT_KEYS)) {
    out[childKey] = sanitizeValue(childValue, depth + 1, seen, childKey);
  }
  if (entries.length > MAX_OBJECT_KEYS) {
    out.__truncatedKeys = entries.length - MAX_OBJECT_KEYS;
  }
  return out;
}

function sanitizeObjectValue(
  value: object,
  depth: number,
  seen: WeakSet<object>
): unknown {
  if (seen.has(value)) {
    return "[circular]";
  }
  if (depth >= MAX_DEPTH) {
    return "[max-depth]";
  }
  seen.add(value);
  if (value instanceof Error) {
    return sanitizeErrorValue(value, depth, seen);
  }
  if (Array.isArray(value)) {
    return sanitizeArrayValue(value, depth, seen);
  }
  if (!isPlainObject(value)) {
    return redactString(String(value));
  }
  return sanitizePlainObjectValue(value, depth, seen);
}

function sanitizeValue(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
  key?: string
): unknown {
  if (key && isSensitiveKey(key)) {
    return "[redacted]";
  }
  if (typeof value === "string") {
    return redactString(value);
  }
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "undefined"
  ) {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "symbol" || typeof value === "function") {
    return String(value);
  }
  if (typeof value === "object") {
    return sanitizeObjectValue(value, depth, seen);
  }
  return String(value);
}

export function sanitizeLogRecordForDisk(
  record: DiagnosticsLogInput | LogRecord
): DiagnosticsLogInput {
  const sanitized: DiagnosticsLogInput = {
    ...record,
    msg: redactString(record.msg),
  };
  if ("ctx" in record && record.ctx !== undefined) {
    sanitized.ctx = sanitizeValue(record.ctx, 0, new WeakSet<object>());
  }
  return sanitized;
}

function buildTruncatedLine(line: DiagnosticsLogLine): DiagnosticsLogLine {
  return {
    v: line.v,
    createdAt: line.createdAt,
    process: line.process,
    pid: line.pid,
    level: line.level,
    ts: line.ts,
    msg: redactString(line.msg, 512),
    ...(line.scope === undefined ? {} : { scope: line.scope }),
    ctx: {
      diagnosticsTruncated: true,
      originalScope: line.scope,
      originalMsg: redactString(line.msg, 512),
    },
  };
}

function serializeBoundedLine(line: DiagnosticsLogLine): string {
  let serialized = JSON.stringify(line);
  if (Buffer.byteLength(serialized, "utf8") <= MAX_JSONL_LINE_BYTES) {
    return serialized;
  }
  serialized = JSON.stringify(buildTruncatedLine(line));
  if (Buffer.byteLength(serialized, "utf8") <= MAX_JSONL_LINE_BYTES) {
    return serialized;
  }
  return JSON.stringify({
    v: line.v,
    createdAt: line.createdAt,
    process: line.process,
    pid: line.pid,
    level: line.level,
    ts: line.ts,
    msg: "diagnostics log line exceeded size limit",
    ...(line.scope === undefined ? {} : { scope: line.scope }),
    ctx: { diagnosticsTruncated: true },
  } satisfies DiagnosticsLogLine);
}

export function createDailyDiagnosticsLogWriter(
  options: DailyDiagnosticsLogWriterOptions
): DailyDiagnosticsLogWriter {
  const retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const maxBytesPerFile = options.maxBytesPerFile ?? DEFAULT_MAX_BYTES_PER_FILE;
  const maxDirBytes = options.maxDirBytes ?? DEFAULT_MAX_DIR_BYTES;
  const now = options.now ?? (() => new Date());
  const processName = options.processName ?? "main";
  const pid = options.pid ?? process.pid;
  let queue = Promise.resolve();
  let currentDayKey: string | null = null;
  let fileBytes = 0;

  const activeLogPath = (key: string): string =>
    join(options.diagnosticsDir, `app-${key}.jsonl`);

  const refreshFileBytesForDay = async (key: string): Promise<void> => {
    try {
      const stat = await fs.stat(activeLogPath(key));
      fileBytes = stat.size;
    } catch {
      fileBytes = 0;
    }
  };

  const rotateActiveFile = async (key: string): Promise<void> => {
    let entries: string[];
    try {
      entries = await fs.readdir(options.diagnosticsDir);
    } catch {
      entries = [];
    }
    const seqRe = new RegExp(`^app-${key}\\.(\\d+)\\.jsonl$`);
    let maxSeq = 0;
    for (const entry of entries) {
      const match = seqRe.exec(entry);
      const rawSeq = match?.[1];
      if (!rawSeq) {
        continue;
      }
      const seq = Number(rawSeq);
      if (Number.isFinite(seq) && seq > maxSeq) {
        maxSeq = seq;
      }
    }
    try {
      await fs.rename(
        activeLogPath(key),
        join(options.diagnosticsDir, `app-${key}.${maxSeq + 1}.jsonl`)
      );
      fileBytes = 0;
    } catch {
      // Best effort: fileBytes stays unchanged so the next append retries rotation.
    }
  };

  const appendInternal = async (
    record: DiagnosticsLogInput | LogRecord
  ): Promise<void> => {
    const createdAtDate = now();
    const sanitized = sanitizeLogRecordForDisk(record);
    // `scope` is a static producer namespace, not a user-input field; put dynamic
    // values in `ctx` or `msg` so sanitization can redact them.
    const line: DiagnosticsLogLine = {
      v: 1,
      createdAt: sanitized.createdAt ?? createdAtDate.toISOString(),
      process: sanitized.process ?? processName,
      pid: sanitized.pid ?? pid,
      level: sanitized.level,
      ts: sanitized.ts,
      msg: sanitized.msg,
      ...(sanitized.scope === undefined ? {} : { scope: sanitized.scope }),
      ...(sanitized.ctx === undefined ? {} : { ctx: sanitized.ctx }),
    };
    for (const [key, value] of Object.entries(sanitized)) {
      if (key in line || value === undefined) {
        continue;
      }
      line[key] = sanitizeValue(value, 0, new WeakSet<object>(), key);
    }

    const serialized = serializeBoundedLine(line);
    const lineBytes = Buffer.byteLength(serialized, "utf8") + 1;
    await fs.mkdir(options.diagnosticsDir, { mode: 0o700, recursive: true });
    const key = dayKey(createdAtDate);
    if (currentDayKey !== key) {
      currentDayKey = key;
      await refreshFileBytesForDay(key);
    }
    if (
      maxBytesPerFile > 0 &&
      fileBytes + lineBytes > maxBytesPerFile &&
      fileBytes > 0
    ) {
      await rotateActiveFile(key);
    }
    // Main diagnostics is installed after Pier wins the single-instance lock, so
    // this append path has one process owner for the active daily file.
    await fs.appendFile(activeLogPath(key), `${serialized}\n`, "utf8");
    fileBytes += lineBytes;
  };

  return {
    append(record) {
      queue = queue
        .then(() => appendInternal(record))
        .catch((err: unknown) => {
          try {
            options.onWriteError?.(err);
          } catch {
            // Diagnostics failures must not throw back into app code.
          }
        });
      return queue;
    },
    async pruneExpiredLogs() {
      await fs.mkdir(options.diagnosticsDir, { mode: 0o700, recursive: true });
      const cutoff = startOfUtcDay(now()) - retentionDays * DAY_MS;
      const entries = await fs.readdir(options.diagnosticsDir);
      const survivors: Array<{ dayMs: number; name: string }> = [];

      await Promise.all(
        entries.map(async (entry) => {
          const match = APP_LOG_FILE_RE.exec(entry);
          const matchedDay = match?.[1];
          if (!matchedDay) {
            return;
          }
          const entryTime = Date.parse(`${matchedDay}T00:00:00.000Z`);
          if (!Number.isFinite(entryTime)) {
            return;
          }
          if (entryTime < cutoff) {
            await fs.rm(join(options.diagnosticsDir, entry), { force: true });
            return;
          }
          survivors.push({ name: entry, dayMs: entryTime });
        })
      );

      if (maxDirBytes <= 0 || survivors.length === 0) {
        return;
      }
      const sized = await Promise.all(
        survivors.map(async ({ name, dayMs }) => {
          try {
            const stat = await fs.stat(join(options.diagnosticsDir, name));
            return { name, dayMs, size: stat.size };
          } catch {
            return { name, dayMs, size: 0 };
          }
        })
      );
      let totalBytes = 0;
      for (const file of sized) {
        totalBytes += file.size;
      }
      if (totalBytes <= maxDirBytes) {
        return;
      }
      sized.sort(
        (a, b) =>
          a.dayMs - b.dayMs ||
          a.name.localeCompare(b.name, undefined, { numeric: true })
      );
      const today = dayKey(now());
      for (const file of sized) {
        if (totalBytes <= maxDirBytes) {
          break;
        }
        if (file.name === `app-${today}.jsonl`) {
          continue;
        }
        try {
          await fs.rm(join(options.diagnosticsDir, file.name), { force: true });
          totalBytes -= file.size;
        } catch {
          // Best effort: another process may already have removed it.
        }
      }
    },
  };
}
