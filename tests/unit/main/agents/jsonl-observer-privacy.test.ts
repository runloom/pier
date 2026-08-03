import { appendFileSync, writeFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type LogRecord,
  resetDefaultLogSinkForTests,
  setDefaultLogSink,
} from "@shared/logger.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJsonlObserver } from "../../../../src/main/services/foreground-activity/jsonl-observer.ts";

function expectNoSensitiveValues(values: unknown[], secrets: string[]): void {
  const observed: unknown[] = [];
  const seen = new Set<object>();
  const visit = (value: unknown): void => {
    observed.push(value);
    if (!(value && typeof value === "object") || seen.has(value)) {
      return;
    }
    seen.add(value);
    for (const key of Reflect.ownKeys(value)) {
      try {
        visit(Reflect.get(value, key));
      } catch {
        // getter 不是诊断契约的一部分；只检查可安全读取的自有值。
      }
    }
  };
  for (const value of values) {
    visit(value);
  }
  expect(observed.some((value) => value instanceof Error)).toBe(false);
  const rendered = observed
    .filter((value) =>
      ["bigint", "boolean", "number", "string"].includes(typeof value)
    )
    .map(String)
    .join("\n");
  for (const secret of secrets) {
    expect(rendered).not.toContain(secret);
  }
}

describe("jsonl observer 隐私日志", () => {
  let baseDir: string;
  let jsonlPath: string;
  let records: LogRecord[];

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "pier-jsonl-privacy-"));
    jsonlPath = join(baseDir, "events.jsonl");
    writeFileSync(jsonlPath, "");
    records = [];
    setDefaultLogSink((record) => records.push(record));
  });

  afterEach(async () => {
    resetDefaultLogSinkForTests();
    await rm(baseDir, { force: true, recursive: true });
  });

  it("JSON 与 schema 失败只记录稳定代码和字节数，不泄漏原始值", async () => {
    const secrets = [
      "SENSITIVE_PROMPT",
      "/private/transcript.jsonl",
      "SENSITIVE_TOOL_ID",
      "rm --secret-argument",
    ];
    const errors: unknown[] = [];
    const observer = createJsonlObserver({
      filePath: jsonlPath,
      onAgentEvent() {},
      onCommandFinished() {},
      onCommandStart() {},
      onError: (error) => errors.push(error),
    });
    appendFileSync(
      jsonlPath,
      `{"prompt":"${secrets[0]}","path":"${secrets[1]}"\n`
    );
    appendFileSync(
      jsonlPath,
      `${JSON.stringify({
        agent: "claude",
        command: secrets[3],
        event: "ToolStart",
        kind: "agentEvent",
        nativeEvent: "PreToolUse",
        panelId: "panel-1",
        promptSnippet: secrets[0],
        toolUseId: secrets[2],
        transcriptPath: secrets[1],
        unexpected: true,
        v: 3,
        windowId: "window-1",
      })}\n`
    );

    await observer.pollNow();

    expect(records.map((record) => record.ctx)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "invalid-json" }),
        expect.objectContaining({ code: "schema-validation-failed" }),
      ])
    );
    const diagnostics = JSON.stringify({ errors, records });
    for (const secret of secrets) {
      expect(diagnostics).not.toContain(secret);
    }
    observer.dispose();
  });

  it("回调异常不记录或转发可能含敏感值的 Error.message", async () => {
    const secret = "SENSITIVE_CALLBACK_MESSAGE";
    const errors: unknown[] = [];
    const observer = createJsonlObserver({
      filePath: jsonlPath,
      onAgentEvent() {
        throw new Error(secret);
      },
      onCommandFinished() {},
      onCommandStart() {},
      onError: (error) => errors.push(error),
    });
    appendFileSync(
      jsonlPath,
      `${JSON.stringify({
        agent: "claude",
        event: "ToolStart",
        kind: "agentEvent",
        panelId: "panel-1",
        v: 1,
        windowId: "window-1",
      })}\n`
    );

    await observer.pollNow();

    expect(records.map((record) => record.ctx)).toContainEqual(
      expect.objectContaining({ code: "callback-failed" })
    );
    expect(JSON.stringify({ errors, records })).not.toContain(secret);
    observer.dispose();
  });

  it("异步派发与错误回调拒绝只留下固定结构诊断", async () => {
    const eventSecret = "SENSITIVE_ASYNC_EVENT_REJECTION";
    const errorCallbackSecret = "SENSITIVE_ASYNC_ERROR_REJECTION";
    const observer = createJsonlObserver({
      filePath: jsonlPath,
      async onAgentEvent() {
        throw new Error(eventSecret);
      },
      onCommandFinished() {},
      onCommandStart() {},
      async onError() {
        throw new Error(errorCallbackSecret);
      },
    });
    const line = JSON.stringify({
      agent: "claude",
      event: "ToolStart",
      kind: "agentEvent",
      panelId: "panel-1",
      v: 1,
      windowId: "window-1",
    });
    appendFileSync(jsonlPath, `${line}\n`);

    await observer.pollNow();
    await vi.waitFor(() => {
      expect(records.map(({ msg }) => msg)).toEqual(
        expect.arrayContaining([
          "observer-failure",
          "observer-error-callback-failed",
        ])
      );
    });

    expect(records.find(({ msg }) => msg === "observer-failure")?.ctx).toEqual({
      code: "callback-failed",
      lineByteLength: Buffer.byteLength(line),
    });
    expect(
      records.find(({ msg }) => msg === "observer-error-callback-failed")?.ctx
    ).toEqual({ code: "error-callback-failed" });
    expectNoSensitiveValues(records, [eventSecret, errorCallbackSecret]);
    observer.dispose();
  });

  it("读取失败只转发安全诊断，不泄漏文件路径", async () => {
    const secret = "SENSITIVE_PROJECT_PATH";
    const sensitiveDir = join(baseDir, secret);
    const sensitivePath = join(sensitiveDir, "session.jsonl");
    await mkdir(sensitiveDir);
    writeFileSync(sensitivePath, "");
    const errors: unknown[] = [];
    const observer = createJsonlObserver({
      filePath: sensitivePath,
      onAgentEvent() {},
      onCommandFinished() {},
      onCommandStart() {},
      onError: (error) => errors.push(error),
    });
    appendFileSync(
      sensitivePath,
      `${JSON.stringify({
        agent: "claude",
        event: "ToolStart",
        kind: "agentEvent",
        panelId: "panel-1",
        v: 1,
        windowId: "window-1",
      })}\n`
    );
    await chmod(sensitivePath, 0);

    try {
      await observer.pollNow();
    } finally {
      await chmod(sensitivePath, 0o600);
      observer.dispose();
    }

    expect(errors).toContainEqual(
      expect.objectContaining({
        code: "file-operation-failed",
        operation: "drain",
        systemCode: expect.stringMatching(/^[A-Z][A-Z0-9_]{0,63}$/),
      })
    );
    expect(JSON.stringify({ errors, records })).not.toContain(secret);
  });

  it("轮转失败只转发安全诊断，不泄漏文件路径", async () => {
    const secret = "SENSITIVE_ROTATION_PATH";
    const sensitiveDir = join(baseDir, secret);
    const sensitivePath = join(sensitiveDir, "session.jsonl");
    await mkdir(sensitiveDir);
    writeFileSync(sensitivePath, "x".repeat(10 * 1024 * 1024 + 1));
    const errors: unknown[] = [];
    const observer = createJsonlObserver({
      filePath: sensitivePath,
      onAgentEvent() {},
      onCommandFinished() {},
      onCommandStart() {},
      onError: (error) => errors.push(error),
    });
    await mkdir(`${sensitivePath}.rotating`);
    appendFileSync(
      sensitivePath,
      `${JSON.stringify({
        agent: "claude",
        event: "ToolStart",
        kind: "agentEvent",
        panelId: "panel-1",
        v: 1,
        windowId: "window-1",
      })}\n`
    );

    await observer.pollNow();
    observer.dispose();

    expect(errors).toContainEqual(
      expect.objectContaining({
        code: "file-operation-failed",
        operation: "rotate",
      })
    );
    expect(JSON.stringify({ errors, records })).not.toContain(secret);
  });
});
