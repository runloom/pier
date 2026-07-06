import { join } from "node:path";
import {
  createLevelFilteredConsoleSink,
  LOG_LEVEL_RANK,
  type LogLevel,
  type LogRecord,
  resolveMinLevel,
  setDefaultLogSink,
} from "@shared/logger.ts";
import { app } from "electron";
import {
  createDailyDiagnosticsLogWriter,
  type DailyDiagnosticsLogWriter,
} from "./daily-diagnostics-log-writer.ts";

const DEFAULT_DISK_LOG_LEVEL: LogLevel = "info";
const FAILURE_WARNING_THROTTLE_MS = 60_000;

let writer: DailyDiagnosticsLogWriter | null = null;
let installed = false;
let lastFailureWarningAt = 0;

export function getDiagnosticsDir(): string {
  return join(app.getPath("userData"), "diagnostics");
}

function warnDiagnosticsFailure(message: string, err: unknown): void {
  const now = Date.now();
  if (now - lastFailureWarningAt < FAILURE_WARNING_THROTTLE_MS) {
    return;
  }
  lastFailureWarningAt = now;
  console.warn(`[pier] ${message}:`, err);
}

/**
 * `PIER_DIAGNOSTICS_LOG_LEVEL` controls disk JSONL writes only.
 * `PIER_LOG_LEVEL` controls console output through createLevelFilteredConsoleSink().
 */
function resolveDiagnosticsLogLevel(): LogLevel {
  const raw = process.env.PIER_DIAGNOSTICS_LOG_LEVEL?.toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }
  return DEFAULT_DISK_LOG_LEVEL;
}

export function getAppDiagnosticsWriter(): DailyDiagnosticsLogWriter {
  if (!writer) {
    writer = createDailyDiagnosticsLogWriter({
      diagnosticsDir: getDiagnosticsDir(),
      processName: "main",
      onWriteError: (err) =>
        warnDiagnosticsFailure("diagnostics log write failed", err),
    });
  }
  return writer;
}

export function installMainDiagnosticsLogging(): void {
  if (installed) {
    return;
  }
  installed = true;
  const diagnosticsWriter = getAppDiagnosticsWriter();
  diagnosticsWriter
    .pruneExpiredLogs()
    .catch((err: unknown) =>
      warnDiagnosticsFailure("diagnostics log prune failed", err)
    );
  const consoleSink = createLevelFilteredConsoleSink(resolveMinLevel());
  const minDiskRank = LOG_LEVEL_RANK[resolveDiagnosticsLogLevel()];
  setDefaultLogSink((record: LogRecord) => {
    consoleSink(record);
    if (LOG_LEVEL_RANK[record.level] < minDiskRank) {
      return;
    }
    diagnosticsWriter.append(record);
  });
}

export function __resetMainDiagnosticsLoggingForTests(): void {
  writer = null;
  installed = false;
  lastFailureWarningAt = 0;
}
