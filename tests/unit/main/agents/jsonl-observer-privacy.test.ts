import { appendFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type LogRecord,
  resetDefaultLogSinkForTests,
  setDefaultLogSink,
} from "@shared/logger.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJsonlObserver } from "../../../../src/main/services/foreground-activity/jsonl-observer.ts";

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
});
