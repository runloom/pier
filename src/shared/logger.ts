/**
 * 结构化日志（跨进程共享）。
 *
 * 设计参考 loomdesk `src-electron/shared/logger.ts`：
 * - 平台无关：`typeof console` / `typeof performance` / `typeof Date` guard
 *   检测，不依赖 Browser / Electron / Node 任一具体环境
 * - 同步 sink（不 batch / 不 async）：调用频率低，复杂度收益不大
 * - 默认 sink 是 level-filtered console，按 level 路由 console.debug/info/
 *   warn/error；prefix 用 `[scope]` 让 grep 友好
 * - 测试期可注入自定义 sink 验证 record 结构
 * - level 控制走 `PIER_LOG_LEVEL` 环境变量（debug/info/warn/error），
 *   默认 info——debug 静默，dev 跑 `PIER_LOG_LEVEL=debug pnpm dev` 看 debug
 *
 * 不变式：
 * - record.ts 用 performance.now() 单调递增（vs Date.now() 不被系统时间漂移影响）
 * - record.scope 用 dot 分隔："a.b.c"，方便按子系统 grep
 * - record.ctx 透传任意 plain object，调用方负责不放循环引用
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogRecord {
  ctx?: Record<string, unknown>;
  level: LogLevel;
  msg: string;
  scope?: string;
  ts: number;
}

export interface Logger {
  child(scope: string): Logger;
  debug(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
}

export type LogSink = (record: LogRecord) => void;

export const LOG_LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const DEFAULT_MIN_LEVEL: LogLevel = "info";

/**
 * 默认 min level：info（debug 静默）。
 * `PIER_LOG_LEVEL` 只控制 console sink；main 进程落盘级别由
 * `PIER_DIAGNOSTICS_LOG_LEVEL` 控制。
 */
export function resolveMinLevel(): LogLevel {
  const raw = process.env.PIER_LOG_LEVEL?.toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }
  return DEFAULT_MIN_LEVEL;
}

function safeNow(): number {
  if (
    typeof performance !== "undefined" &&
    typeof performance.now === "function"
  ) {
    return performance.now();
  }
  if (typeof Date !== "undefined") {
    return Date.now();
  }
  return 0;
}

/* eslint-disable no-console -- this function is the logger's intentional console sink. */
export function defaultConsoleSink(record: LogRecord): void {
  if (typeof console === "undefined") {
    return;
  }
  const prefix = record.scope ? `[${record.scope}]` : "[pier]";
  const args: unknown[] = [prefix, record.msg];
  if (record.ctx !== undefined) {
    args.push(record.ctx);
  }
  switch (record.level) {
    case "debug":
      (console.debug ?? console.log).apply(console, args as []);
      return;
    case "info":
      (console.info ?? console.log).apply(console, args as []);
      return;
    case "warn":
      console.warn.apply(console, args as []);
      return;
    case "error":
      console.error.apply(console, args as []);
      return;
    default:
      return;
  }
}
/* eslint-enable no-console */

/**
 * 按 min level 过滤的 console sink：低于 min level 的 record 不输出。
 * 用于 main 进程入口 install——dev 设 `PIER_LOG_LEVEL=debug` 看 debug，
 * 默认 info 只看 info+，prod 排查时设 `PIER_LOG_LEVEL=debug`。
 */
export function createLevelFilteredConsoleSink(minLevel: LogLevel): LogSink {
  const minRank = LOG_LEVEL_RANK[minLevel];
  return (record: LogRecord) => {
    if (LOG_LEVEL_RANK[record.level] < minRank) {
      return;
    }
    defaultConsoleSink(record);
  };
}

let defaultLogSink: LogSink = defaultConsoleSink;

export function setDefaultLogSink(sink: LogSink): void {
  defaultLogSink = sink;
}

export function resetDefaultLogSinkForTests(): void {
  defaultLogSink = defaultConsoleSink;
}

export function createLogger(scope?: string, sink?: LogSink): Logger {
  const emit = (
    level: LogLevel,
    msg: string,
    ctx?: Record<string, unknown>
  ): void => {
    const record: LogRecord = {
      level,
      ts: safeNow(),
      msg,
      ...(ctx === undefined ? {} : { ctx }),
      ...(scope === undefined ? {} : { scope }),
    };
    try {
      (sink ?? defaultLogSink)(record);
    } catch {
      // sink 自己的错不能反过来阻塞调用方；静默吞掉是 deliberate。
    }
  };

  const logger: Logger = {
    debug: (msg, ctx) => emit("debug", msg, ctx),
    info: (msg, ctx) => emit("info", msg, ctx),
    warn: (msg, ctx) => emit("warn", msg, ctx),
    error: (msg, ctx) => emit("error", msg, ctx),
    child: (sub: string) => {
      const composed = scope ? `${scope}.${sub}` : sub;
      return createLogger(composed, sink);
    },
  };
  return logger;
}
