import { createLogger, resetDefaultLogSinkForTests } from "@shared/logger.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetMainDiagnosticsLoggingForTests,
  getAppDiagnosticsWriter,
  getDiagnosticsDir,
  installMainDiagnosticsLogging,
} from "../../../src/main/diagnostics/app-diagnostics.ts";

interface CapturedWriterOptions {
  onWriteError?: (err: unknown) => void;
}

const writerMock = vi.hoisted(() => {
  const state: { capturedOptions: CapturedWriterOptions | undefined } = {
    capturedOptions: undefined,
  };
  const writer = {
    append: vi.fn(),
    pruneExpiredLogs: vi.fn(),
  };
  const createDailyDiagnosticsLogWriter = vi.fn((options) => {
    state.capturedOptions = options as CapturedWriterOptions;
    return writer;
  });
  return { createDailyDiagnosticsLogWriter, state, writer };
});

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn((key: string) =>
      key === "userData" ? "/mock/userData/Pier" : `/mock/${key}`
    ),
  },
}));

vi.mock(
  "../../../src/main/diagnostics/daily-diagnostics-log-writer.ts",
  () => ({
    createDailyDiagnosticsLogWriter: writerMock.createDailyDiagnosticsLogWriter,
  })
);

describe("app diagnostics logging", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T10:20:30.000Z"));
    delete process.env.PIER_DIAGNOSTICS_LOG_LEVEL;
    delete process.env.PIER_LOG_LEVEL;
    writerMock.state.capturedOptions = undefined;
    writerMock.writer.append.mockReset();
    writerMock.writer.pruneExpiredLogs.mockReset();
    writerMock.writer.pruneExpiredLogs.mockResolvedValue(undefined);
    writerMock.createDailyDiagnosticsLogWriter.mockClear();
  });

  afterEach(() => {
    delete process.env.PIER_DIAGNOSTICS_LOG_LEVEL;
    delete process.env.PIER_LOG_LEVEL;
    __resetMainDiagnosticsLoggingForTests();
    resetDefaultLogSinkForTests();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("uses userData diagnostics directory and creates the writer lazily once", () => {
    expect(getDiagnosticsDir()).toBe("/mock/userData/Pier/diagnostics");

    expect(getAppDiagnosticsWriter()).toBe(writerMock.writer);
    expect(getAppDiagnosticsWriter()).toBe(writerMock.writer);

    expect(writerMock.createDailyDiagnosticsLogWriter).toHaveBeenCalledTimes(1);
    expect(writerMock.createDailyDiagnosticsLogWriter).toHaveBeenCalledWith(
      expect.objectContaining({
        diagnosticsDir: "/mock/userData/Pier/diagnostics",
        processName: "main",
      })
    );
  });

  it("is idempotent across repeated installs", () => {
    installMainDiagnosticsLogging();
    installMainDiagnosticsLogging();

    expect(writerMock.createDailyDiagnosticsLogWriter).toHaveBeenCalledTimes(1);
    expect(writerMock.writer.pruneExpiredLogs).toHaveBeenCalledTimes(1);
  });

  it("reports writer failures through throttled console fallback", () => {
    const consoleWarn = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    getAppDiagnosticsWriter();
    writerMock.state.capturedOptions?.onWriteError?.(new Error("disk full"));
    writerMock.state.capturedOptions?.onWriteError?.(new Error("still full"));
    vi.setSystemTime(new Date("2026-07-06T10:21:31.000Z"));
    writerMock.state.capturedOptions?.onWriteError?.(new Error("still full"));

    expect(consoleWarn).toHaveBeenCalledTimes(2);
    expect(consoleWarn.mock.calls[0]?.[0]).toBe(
      "[pier] diagnostics log write failed:"
    );
  });

  it("prunes on install and reports prune failures without using logger", async () => {
    const consoleWarn = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    writerMock.writer.pruneExpiredLogs.mockRejectedValue(
      new Error("cannot prune")
    );

    installMainDiagnosticsLogging();
    await Promise.resolve();

    expect(writerMock.writer.pruneExpiredLogs).toHaveBeenCalledTimes(1);
    expect(consoleWarn).toHaveBeenCalledWith(
      "[pier] diagnostics log prune failed:",
      expect.any(Error)
    );
  });

  it("writes info+ records to disk by default while console follows PIER_LOG_LEVEL", () => {
    const debug = vi
      .spyOn(console, "debug")
      .mockImplementation(() => undefined);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    process.env.PIER_LOG_LEVEL = "warn";

    installMainDiagnosticsLogging();
    const log = createLogger("test.level");
    log.debug("debug msg");
    log.info("info msg");
    log.warn("warn msg");
    log.error("error msg");

    expect(debug).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
    expect(writerMock.writer.append).toHaveBeenCalledTimes(3);
    expect(writerMock.writer.append.mock.calls.map((call) => call[0])).toEqual([
      expect.objectContaining({ level: "info", msg: "info msg" }),
      expect.objectContaining({ level: "warn", msg: "warn msg" }),
      expect.objectContaining({ level: "error", msg: "error msg" }),
    ]);
  });

  it("honors PIER_DIAGNOSTICS_LOG_LEVEL=debug for disk writes", () => {
    vi.spyOn(console, "debug").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    process.env.PIER_DIAGNOSTICS_LOG_LEVEL = "debug";

    installMainDiagnosticsLogging();
    createLogger("test.level").debug("debug msg");

    expect(writerMock.writer.append).toHaveBeenCalledTimes(1);
    expect(writerMock.writer.append.mock.calls[0]?.[0]).toMatchObject({
      level: "debug",
      msg: "debug msg",
    });
  });

  it("falls back to info for invalid PIER_DIAGNOSTICS_LOG_LEVEL", () => {
    vi.spyOn(console, "debug").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    process.env.PIER_DIAGNOSTICS_LOG_LEVEL = "verbose";

    installMainDiagnosticsLogging();
    const log = createLogger("test.level");
    log.debug("debug msg");
    log.info("info msg");

    expect(writerMock.writer.append).toHaveBeenCalledTimes(1);
    expect(writerMock.writer.append.mock.calls[0]?.[0]).toMatchObject({
      level: "info",
      msg: "info msg",
    });
  });

  it("honors PIER_DIAGNOSTICS_LOG_LEVEL=error to suppress lower disk levels", () => {
    vi.spyOn(console, "debug").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    process.env.PIER_DIAGNOSTICS_LOG_LEVEL = "error";

    installMainDiagnosticsLogging();
    const log = createLogger("test.level");
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");

    expect(writerMock.writer.append).toHaveBeenCalledTimes(1);
    expect(writerMock.writer.append.mock.calls[0]?.[0]).toMatchObject({
      level: "error",
      msg: "e",
    });
  });
});
