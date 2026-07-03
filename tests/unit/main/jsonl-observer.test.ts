import { appendFileSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentHookEvent } from "@shared/contracts/agent-session.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJsonlObserver } from "../../../src/main/services/foreground-activity/jsonl-observer.ts";

/** 合法 JSONL 行（agentHookEventSchema 需要这些字段）。 */
function eventLine(n: number): string {
  return JSON.stringify({
    v: 1,
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

    const received: AgentHookEvent[] = [];
    const { promise: donePromise, resolve: done } =
      Promise.withResolvers<void>();

    const observer = createJsonlObserver({
      filePath: jsonlPath,
      onEvent(event) {
        received.push(event);
        if (received.length === 2) {
          done();
        }
      },
    });

    // 追加 2 行
    appendFileSync(jsonlPath, `${eventLine(3)}\n${eventLine(4)}\n`);

    // watchFile 250ms 轮询——等真实回调触发（集成测试文件系统行为）
    await withTimeout(donePromise, 5000);

    expect(received).toHaveLength(2);
    expect(received[0]?.event).toBe("evt-3");
    expect(received[1]?.event).toBe("evt-4");

    observer.dispose();
  });

  it("rotate：超 10MB 后截断保留 tail 1000 行", async () => {
    // 写 100000 行（每行约 90 字节 → ~9MB，不够。加大内容让它超 10MB）
    const lines: string[] = [];
    for (let i = 0; i < 100_000; i++) {
      // 每行约 120 字节 → 总约 12MB
      lines.push(
        JSON.stringify({
          v: 1,
          agent: "claude",
          event: `evt-${String(i).padStart(6, "0")}`,
          panelId: "panel-1",
          windowId: "w-1",
          _pad: "x".repeat(20),
        })
      );
    }
    writeFileSync(jsonlPath, `${lines.join("\n")}\n`);

    const { promise: rotateDone, resolve: onRotated } =
      Promise.withResolvers<void>();
    let rotateChecked = false;

    const observer = createJsonlObserver({
      filePath: jsonlPath,
      onEvent() {
        // rotate 后不该有历史事件回放
      },
      onError() {
        // 忽略（rotate 期间可能有瞬态错误）
      },
    });

    // 追加 1 行触发 watchFile + rotate 检查
    appendFileSync(jsonlPath, `${eventLine(999_999)}\n`);

    // 轮询等待 rotate 完成
    const interval = setInterval(async () => {
      try {
        const content = await readFile(jsonlPath, "utf8");
        const nonEmpty = content.split("\n").filter((l) => l.trim());
        if (nonEmpty.length === 1000 && !rotateChecked) {
          rotateChecked = true;
          clearInterval(interval);
          onRotated();
        }
      } catch {
        // 文件可能正在被重写
      }
    }, 200);

    await withTimeout(rotateDone, 15_000);

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
    clearInterval(interval);
  });

  it("offset 恢复：restart observer 从持久化 offset 继续", async () => {
    // 写 5 行
    const initial = `${[0, 1, 2, 3, 4].map((n) => eventLine(n)).join("\n")}\n`;
    writeFileSync(jsonlPath, initial);

    // 手写 offset 文件指向第 3 行末尾（前 3 行的字节数）
    const first3 = `${[0, 1, 2].map((n) => eventLine(n)).join("\n")}\n`;
    const offsetValue = Buffer.byteLength(first3);
    writeFileSync(offsetPath, String(offsetValue));

    const received: AgentHookEvent[] = [];
    const { promise: donePromise, resolve: done } =
      Promise.withResolvers<void>();

    // 先创建 observer（从 offset 文件恢复位置），再追加触发 watchFile
    const observer = createJsonlObserver({
      filePath: jsonlPath,
      onEvent(event) {
        received.push(event);
        // 期望收到 evt-3, evt-4, evt-5（从 offset 位置开始的所有内容）
        if (received.length === 3) {
          done();
        }
      },
    });

    // 追加 1 行触发 watchFile stat 变化
    appendFileSync(jsonlPath, `${eventLine(5)}\n`);

    await withTimeout(donePromise, 5000);

    expect(received).toHaveLength(3);
    expect(received[0]?.event).toBe("evt-3");
    expect(received[1]?.event).toBe("evt-4");
    expect(received[2]?.event).toBe("evt-5");

    observer.dispose();
  });
});

/** 带超时的 promise 等待（集成测试中等待 FS 事件需要）。 */
function withTimeout(p: Promise<void>, ms: number): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const timer = setTimeout(
    () => reject(new Error(`Timed out after ${ms}ms`)),
    ms
  );
  p.then(() => {
    clearTimeout(timer);
    resolve();
  }).catch((err) => {
    clearTimeout(timer);
    reject(err);
  });
  return promise;
}
