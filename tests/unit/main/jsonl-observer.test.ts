import { appendFileSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentHookEventPayload } from "@shared/contracts/agent-session.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJsonlObserver } from "../../../src/main/services/foreground-activity/jsonl-observer.ts";

/** 合法 JSONL 行（agentHookEventSchema agentEvent 分支要求这些字段）。 */
function eventLine(n: number): string {
  return JSON.stringify({
    v: 1,
    kind: "agentEvent",
    agent: "claude",
    event: `evt-${n}`,
    panelId: "panel-1",
    windowId: "w-1",
  });
}

describe("jsonl-observer", () => {
  let baseDir: string;
  let jsonlPath: string;
  let offsetPath: string;

  beforeEach(async () => {
    // 别的 test 文件用 vi.useFakeTimers() 可能泄漏；observer 依赖 fs.watchFile
    // 250ms 真实轮询触发，fake timers 下 poll 不推进 -> 5s 卡超时。显式恢复。
    vi.useRealTimers();
    baseDir = await mkdtemp(join(tmpdir(), "pier-jsonl-obs-"));
    jsonlPath = join(baseDir, "events.jsonl");
    offsetPath = `${jsonlPath}.offset`;
  });

  afterEach(async () => {
    await rm(baseDir, { force: true, recursive: true });
  });

  it("tail：预先写 3 行，init 后追加 2 行，只收到 2 行", async () => {
    // 预写 3 行
    const initial = `${[0, 1, 2].map((n) => eventLine(n)).join("\n")}\n`;
    writeFileSync(jsonlPath, initial);

    const received: AgentHookEventPayload[] = [];
    const observer = createJsonlObserver({
      filePath: jsonlPath,
      onAgentEvent(event) {
        received.push(event);
        // (无需 Promise signal, 手动 pollNow 已保证同步)
      },
      onCommandFinished() {
        // 未消费——本 case 只测 agentEvent 路径。
      },
      onCommandStart() {
        // 未消费——本 case 只测 agentEvent 路径。
      },
    });

    // 追加 2 行
    appendFileSync(jsonlPath, `${eventLine(3)}\n${eventLine(4)}\n`);
    await observer.pollNow();

    expect(received).toHaveLength(2);
    expect(received[0]?.event).toBe("evt-3");
    expect(received[1]?.event).toBe("evt-4");

    observer.dispose();
  }, 20_000);

  it("rotate：超 10MB 后截断保留 tail 1000 行", async () => {
    // 写 100000 行（每行约 90 字节 → ~9MB，不够。加大内容让它超 10MB）
    const lines: string[] = [];
    for (let i = 0; i < 100_000; i++) {
      // 每行约 120 字节 → 总约 12MB
      lines.push(
        JSON.stringify({
          v: 1,
          kind: "agentEvent",
          agent: "claude",
          event: `evt-${String(i).padStart(6, "0")}`,
          panelId: "panel-1",
          windowId: "w-1",
          _pad: "x".repeat(20),
        })
      );
    }
    writeFileSync(jsonlPath, `${lines.join("\n")}\n`);
    const observer = createJsonlObserver({
      filePath: jsonlPath,
      onAgentEvent() {
        // rotate 后不该有历史事件回放
      },
      onCommandFinished() {
        // 未消费——本 case 只测 agentEvent 路径。
      },
      onCommandStart() {
        // 未消费——本 case 只测 agentEvent 路径。
      },
      onError() {
        // 忽略（rotate 期间可能有瞬态错误）
      },
    });

    // 追加 1 行 -> 手动触发 rotate 检查
    appendFileSync(jsonlPath, `${eventLine(999_999)}\n`);
    await observer.pollNow();

    const finalContent = await readFile(jsonlPath, "utf8");
    const finalLines = finalContent.split("\n").filter((l) => l.trim());
    expect(finalLines).toHaveLength(1000);
    // 最后一行应是追加的那行
    const last = finalLines.at(-1);
    if (!last) {
      throw new Error("empty finalLines after rotate");
    }
    const lastParsed = JSON.parse(last);
    expect(lastParsed.event).toBe("evt-999999");

    observer.dispose();
  }, 20_000);

  it("offset 恢复：restart observer 从持久化 offset 继续", async () => {
    // 写 5 行
    const initial = `${[0, 1, 2, 3, 4].map((n) => eventLine(n)).join("\n")}\n`;
    writeFileSync(jsonlPath, initial);

    // 手写 offset 文件指向第 3 行末尾（前 3 行的字节数）
    const first3 = `${[0, 1, 2].map((n) => eventLine(n)).join("\n")}\n`;
    const offsetValue = Buffer.byteLength(first3);
    writeFileSync(offsetPath, String(offsetValue));

    const received: AgentHookEventPayload[] = [];
    const observer = createJsonlObserver({
      filePath: jsonlPath,
      onAgentEvent(event) {
        received.push(event);
      },
      onCommandFinished() {
        // 未消费——本 case 只测 agentEvent 路径。
      },
      onCommandStart() {
        // 未消费——本 case 只测 agentEvent 路径。
      },
    });

    // 追加 1 行，显式调用 pollNow 触发一次尾读——避免依赖 watchFile 的
    // 250ms poll 在 vitest 并行环境下的抖动（曾偶发 15s+ 超时）。
    appendFileSync(jsonlPath, `${eventLine(5)}\n`);
    await observer.pollNow();

    expect(received).toHaveLength(3);
    expect(received[0]?.event).toBe("evt-3");
    expect(received[1]?.event).toBe("evt-4");
    expect(received[2]?.event).toBe("evt-5");

    observer.dispose();
  }, 20_000);
});
