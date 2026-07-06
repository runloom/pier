import {
  createLevelFilteredConsoleSink,
  createLogger,
  defaultConsoleSink,
  type LogRecord,
  type LogSink,
  resetDefaultLogSinkForTests,
  resolveMinLevel,
  setDefaultLogSink,
} from "@shared/logger.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  resetDefaultLogSinkForTests();
});

describe("createLogger", () => {
  it("supports debug / info / warn / error levels", () => {
    const records: LogRecord[] = [];
    const sink: LogSink = (r) => records.push(r);
    const log = createLogger("test", sink);
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    expect(records.map((r) => r.level)).toEqual([
      "debug",
      "info",
      "warn",
      "error",
    ]);
  });

  it("child logger composes scope with dot separator", () => {
    const records: LogRecord[] = [];
    const sink: LogSink = (r) => records.push(r);
    const log = createLogger("parent", sink).child("child");
    log.info("hello");
    expect(records[0]?.scope).toBe("parent.child");
  });

  it("passes ctx through as plain object", () => {
    const records: LogRecord[] = [];
    const sink: LogSink = (r) => records.push(r);
    const log = createLogger("ctx-test", sink);
    log.info("msg", { a: 1, b: "two" });
    expect(records[0]?.ctx).toEqual({ a: 1, b: "two" });
  });

  it("omits ctx field when not provided (not undefined)", () => {
    const records: LogRecord[] = [];
    const sink: LogSink = (r) => records.push(r);
    const log = createLogger("no-ctx", sink);
    log.info("plain");
    expect(records[0]?.ctx).toBeUndefined();
    expect("ctx" in (records[0] ?? {})).toBe(false);
  });

  it("module-level loggers read the latest default sink at emit time", () => {
    const records: LogRecord[] = [];
    const sink: LogSink = (r) => records.push(r);
    // createLogger without explicit sink uses defaultLogSink at emit time
    const log = createLogger("dynamic-default");
    setDefaultLogSink(sink);
    log.info("after-set");
    expect(records).toHaveLength(1);
    expect(records[0]?.msg).toBe("after-set");
  });

  it("explicit sink overrides default sink", () => {
    const defaultRecords: LogRecord[] = [];
    setDefaultLogSink((r) => defaultRecords.push(r));
    const explicitRecords: LogRecord[] = [];
    const log = createLogger("explicit", (r) => explicitRecords.push(r));
    log.info("routed");
    expect(defaultRecords).toHaveLength(0);
    expect(explicitRecords).toHaveLength(1);
  });

  it("swallows sink errors silently (never throws to caller)", () => {
    const throwingSink: LogSink = () => {
      throw new Error("sink boom");
    };
    const log = createLogger("throw", throwingSink);
    expect(() => log.info("safe")).not.toThrow();
  });
});

describe("defaultConsoleSink", () => {
  it("routes by level to console.{debug,info,warn,error}", () => {
    const spies = {
      debug: vi.spyOn(console, "debug").mockImplementation(() => undefined),
      info: vi.spyOn(console, "info").mockImplementation(() => undefined),
      warn: vi.spyOn(console, "warn").mockImplementation(() => undefined),
      error: vi.spyOn(console, "error").mockImplementation(() => undefined),
    };
    try {
      const record = (level: LogRecord["level"]): LogRecord => ({
        level,
        ts: 0,
        msg: "m",
        scope: "s",
      });
      defaultConsoleSink(record("debug"));
      defaultConsoleSink(record("info"));
      defaultConsoleSink(record("warn"));
      defaultConsoleSink(record("error"));
      expect(spies.debug).toHaveBeenCalledTimes(1);
      expect(spies.info).toHaveBeenCalledTimes(1);
      expect(spies.warn).toHaveBeenCalledTimes(1);
      expect(spies.error).toHaveBeenCalledTimes(1);
    } finally {
      for (const s of Object.values(spies)) {
        s.mockRestore();
      }
    }
  });

  it("uses [pier] prefix when scope is undefined", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      defaultConsoleSink({ level: "info", ts: 0, msg: "m" });
      expect(info.mock.calls[0]?.[0]).toBe("[pier]");
    } finally {
      info.mockRestore();
    }
  });

  it("uses [scope] prefix when scope is set", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      defaultConsoleSink({ level: "info", ts: 0, msg: "m", scope: "fg" });
      expect(info.mock.calls[0]?.[0]).toBe("[fg]");
    } finally {
      info.mockRestore();
    }
  });
});

describe("createLevelFilteredConsoleSink", () => {
  it("filters records below min level", () => {
    const debug = vi
      .spyOn(console, "debug")
      .mockImplementation(() => undefined);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      const sink = createLevelFilteredConsoleSink("info");
      sink({ level: "debug", ts: 0, msg: "d" }); // filtered
      sink({ level: "info", ts: 0, msg: "i" }); // through
      sink({ level: "warn", ts: 0, msg: "w" }); // through
      sink({ level: "error", ts: 0, msg: "e" }); // through
      expect(debug).not.toHaveBeenCalled();
      expect(info).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledTimes(1);
    } finally {
      debug.mockRestore();
      info.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it("debug min level lets all levels through", () => {
    const debug = vi
      .spyOn(console, "debug")
      .mockImplementation(() => undefined);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      const sink = createLevelFilteredConsoleSink("debug");
      sink({ level: "debug", ts: 0, msg: "d" });
      sink({ level: "info", ts: 0, msg: "i" });
      sink({ level: "warn", ts: 0, msg: "w" });
      sink({ level: "error", ts: 0, msg: "e" });
      expect(debug).toHaveBeenCalledTimes(1);
      expect(info).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledTimes(1);
    } finally {
      debug.mockRestore();
      info.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it("error min level filters everything except error", () => {
    const debug = vi
      .spyOn(console, "debug")
      .mockImplementation(() => undefined);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      const sink = createLevelFilteredConsoleSink("error");
      sink({ level: "debug", ts: 0, msg: "d" });
      sink({ level: "info", ts: 0, msg: "i" });
      sink({ level: "warn", ts: 0, msg: "w" });
      sink({ level: "error", ts: 0, msg: "e" });
      expect(debug).not.toHaveBeenCalled();
      expect(info).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledTimes(1);
    } finally {
      debug.mockRestore();
      info.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });
});

describe("resolveMinLevel", () => {
  const original = process.env.PIER_LOG_LEVEL;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.PIER_LOG_LEVEL;
    } else {
      process.env.PIER_LOG_LEVEL = original;
    }
  });

  it("accepts supported levels case-insensitively", () => {
    process.env.PIER_LOG_LEVEL = "DEBUG";
    expect(resolveMinLevel()).toBe("debug");
    process.env.PIER_LOG_LEVEL = "warn";
    expect(resolveMinLevel()).toBe("warn");
  });

  it("falls back to info for unset or invalid values", () => {
    delete process.env.PIER_LOG_LEVEL;
    expect(resolveMinLevel()).toBe("info");
    process.env.PIER_LOG_LEVEL = "verbose";
    expect(resolveMinLevel()).toBe("info");
  });
});
