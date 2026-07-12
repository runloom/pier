import { appendFileSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
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

  it("drain：处理期间追加最终事件并再次唤醒，不会永久漏读", async () => {
    writeFileSync(jsonlPath, "");
    const received: AgentHookEventPayload[] = [];
    let observer: ReturnType<typeof createJsonlObserver>;
    observer = createJsonlObserver({
      filePath: jsonlPath,
      onAgentEvent(event) {
        received.push(event);
        if (event.event === "evt-1") {
          appendFileSync(jsonlPath, `${eventLine(2)}\n`);
          observer.pollNow().catch(() => undefined);
        }
      },
      onCommandFinished() {},
      onCommandStart() {},
    });

    appendFileSync(jsonlPath, `${eventLine(1)}\n`);
    await observer.pollNow();

    expect(received.map((event) => event.event)).toEqual(["evt-1", "evt-2"]);
    observer.dispose();
  });

  it("rotate：超 10MB 时先派发未读事件，再原子切换到新日志", async () => {
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
      onError() {
        // 忽略（rotate 期间可能有瞬态错误）
      },
    });

    // 追加 1 行 -> 手动触发 rotate 检查
    appendFileSync(jsonlPath, `${eventLine(999_999)}\n`);
    await observer.pollNow();

    expect(received.map((event) => event.event)).toEqual(["evt-999999"]);
    expect(await readFile(jsonlPath, "utf8")).toBe("");

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

  it("启动时恢复中断的轮转文件，按旧 offset 继续且不漏新日志", async () => {
    const oldProcessed = `${eventLine(0)}\n`;
    writeFileSync(`${jsonlPath}.rotating`, `${oldProcessed}${eventLine(1)}\n`);
    writeFileSync(jsonlPath, `${eventLine(2)}\n`);
    writeFileSync(offsetPath, String(Buffer.byteLength(oldProcessed)));
    const received: AgentHookEventPayload[] = [];
    const observer = createJsonlObserver({
      filePath: jsonlPath,
      onAgentEvent: (event) => received.push(event),
      onCommandFinished() {},
      onCommandStart() {},
    });

    await observer.pollNow();

    expect(received.map((event) => event.event)).toEqual(["evt-1", "evt-2"]);
    observer.dispose();
  });

  it("轮转在创建新日志前崩溃：只有 rotating 文件也能恢复", async () => {
    const processed = `${eventLine(0)}\n`;
    writeFileSync(`${jsonlPath}.rotating`, `${processed}${eventLine(1)}\n`);
    writeFileSync(
      `${jsonlPath}.rotating.offset`,
      String(Buffer.byteLength(processed))
    );
    const received: AgentHookEventPayload[] = [];
    const observer = createJsonlObserver({
      filePath: jsonlPath,
      onAgentEvent: (event) => received.push(event),
      onCommandFinished() {},
      onCommandStart() {},
    });

    await observer.pollNow();

    expect(received.map((event) => event.event)).toEqual(["evt-1"]);
    expect(await readFile(jsonlPath, "utf8")).toBe(
      `${processed}${eventLine(1)}\n`
    );
    observer.dispose();
  });

  it("中断轮转恢复可重入：恢复完成后重启不会重复派发", async () => {
    const processed = `${eventLine(0)}\n`;
    writeFileSync(`${jsonlPath}.rotating`, `${processed}${eventLine(1)}\n`);
    writeFileSync(jsonlPath, `${eventLine(2)}\n`);
    writeFileSync(
      `${jsonlPath}.rotating.offset`,
      String(Buffer.byteLength(processed))
    );
    const received: AgentHookEventPayload[] = [];
    const createObserver = () =>
      createJsonlObserver({
        filePath: jsonlPath,
        onAgentEvent: (event) => received.push(event),
        onCommandFinished() {},
        onCommandStart() {},
      });

    const first = createObserver();
    await first.pollNow();
    first.dispose();
    const second = createObserver();
    await second.pollNow();

    expect(received.map((event) => event.event)).toEqual(["evt-1", "evt-2"]);
    second.dispose();
  });

  it("中断轮转旧文件以半行结尾时报告错误并继续消费新日志", async () => {
    const processed = `${eventLine(0)}\n`;
    writeFileSync(`${jsonlPath}.rotating`, `${processed}{half-json`);
    writeFileSync(jsonlPath, `${eventLine(2)}\n`);
    writeFileSync(
      `${jsonlPath}.rotating.offset`,
      String(Buffer.byteLength(processed))
    );
    const received: AgentHookEventPayload[] = [];
    const errors: unknown[] = [];
    const observer = createJsonlObserver({
      filePath: jsonlPath,
      onAgentEvent: (event) => received.push(event),
      onCommandFinished() {},
      onCommandStart() {},
      onError: (error) => errors.push(error),
    });

    await observer.pollNow();

    expect(received.map((event) => event.event)).toEqual(["evt-2"]);
    expect(errors).toHaveLength(1);
    observer.dispose();
  });

  it("半行不丢：无换行尾部半行不派发不报错, 补齐后完整派发", async () => {
    writeFileSync(jsonlPath, "");

    const received: AgentHookEventPayload[] = [];
    const errors: unknown[] = [];
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
      onError(err) {
        errors.push(err);
      },
    });

    // 完整行 A + 无换行的半行 B（写端不保证原子换行边界）
    const lineB = eventLine(1);
    const half = lineB.slice(0, Math.floor(lineB.length / 2));
    appendFileSync(jsonlPath, `${eventLine(0)}\n${half}`);
    await observer.pollNow();

    // 只收到 A；半行 B 既不派发也不触发 onError（offset 停在 A 行尾）
    expect(received.map((e) => e.event)).toEqual(["evt-0"]);
    expect(errors).toHaveLength(0);

    // 写端补齐 B 尾部 + 换行 → 下轮完整派发, 不拆坏不丢事件
    appendFileSync(jsonlPath, `${lineB.slice(half.length)}\n`);
    await observer.pollNow();

    expect(received.map((e) => e.event)).toEqual(["evt-0", "evt-1"]);
    expect(errors).toHaveLength(0);

    observer.dispose();
  }, 20_000);

  it("截断重建不丢：size < offset 时 offset 归 0 并继续读当前内容", async () => {
    writeFileSync(jsonlPath, "");

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

    // 写入长行 A（用 sessionId 撑大字节数——schema 严格且 event 上限 64 字符）
    // → offset 推进到 A 行尾
    const longLine = JSON.stringify({
      v: 1,
      kind: "agentEvent",
      agent: "claude",
      event: "evt-long",
      panelId: "panel-1",
      windowId: "w-1",
      sessionId: "s".repeat(120),
    });
    appendFileSync(jsonlPath, `${longLine}\n`);
    await observer.pollNow();
    expect(received.map((e) => e.event)).toEqual(["evt-long"]);

    // 文件被截断重建为更短的新合法行 C（size < offset）
    writeFileSync(jsonlPath, `${eventLine(7)}\n`);
    await observer.pollNow();

    // 重建后的合法事件不得丢（只重置 offset 不读会永久跳过 C）
    expect(received.map((e) => e.event)).toEqual(["evt-long", "evt-7"]);

    observer.dispose();
  }, 20_000);

  it("坏行容错：坏 JSON 行触发 onError 但不阻断同批合法行", async () => {
    writeFileSync(jsonlPath, "");

    const received: AgentHookEventPayload[] = [];
    const errors: unknown[] = [];
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
      onError(err) {
        errors.push(err);
      },
    });

    // 坏 JSON 行夹在两条合法行之间, 同批到达
    appendFileSync(jsonlPath, `${eventLine(0)}\n{not-json\n${eventLine(1)}\n`);
    await observer.pollNow();

    expect(received.map((e) => e.event)).toEqual(["evt-0", "evt-1"]);
    expect(errors).toHaveLength(1);

    observer.dispose();
  }, 20_000);

  it("超过 1 MiB 的单行不会造成大分配或阻塞后续事件", async () => {
    writeFileSync(jsonlPath, "");
    const received: AgentHookEventPayload[] = [];
    const errors: unknown[] = [];
    const observer = createJsonlObserver({
      filePath: jsonlPath,
      onAgentEvent: (event) => received.push(event),
      onCommandFinished() {},
      onCommandStart() {},
      onError: (error) => errors.push(error),
    });

    appendFileSync(
      jsonlPath,
      `${"x".repeat(1024 * 1024 + 100)}\n${eventLine(9)}\n`
    );
    await observer.pollNow();

    expect(received.map((event) => event.event)).toEqual(["evt-9"]);
    expect(errors.length).toBeGreaterThan(0);
    observer.dispose();
  });

  it("writer 在 append 前崩溃留下死亡锁时，周期回收无需主日志变化", async () => {
    writeFileSync(jsonlPath, "");
    const lockPath = `${jsonlPath}.lock`;
    writeFileSync(lockPath, "99999999.crashed-writer");
    const observer = createJsonlObserver({
      filePath: jsonlPath,
      onAgentEvent() {},
      onCommandFinished() {},
      onCommandStart() {},
    });

    await vi.waitFor(
      async () => {
        await expect(stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
      },
      { timeout: 2500 }
    );

    observer.dispose();
  });

  it("原始 hook payload 只读取顶层身份字段，不受 tool_input 同名字段污染", async () => {
    writeFileSync(jsonlPath, "");
    const received: AgentHookEventPayload[] = [];
    const observer = createJsonlObserver({
      filePath: jsonlPath,
      onAgentEvent: (event) => received.push(event),
      onCommandFinished() {},
      onCommandStart() {},
    });
    const rawPayload = {
      agent_id: "worker-top",
      session_id: "session-top",
      tool_input: {
        agent_id: "worker-nested",
        session_id: "session-nested",
      },
      tool_use_id: "tool-top",
      turn_id: "turn-top",
    };
    const line = JSON.stringify({
      agent: "codex",
      event: "ToolStart",
      kind: "agentEvent",
      panelId: "panel-1",
      metadataBase64: Buffer.from(JSON.stringify(rawPayload)).toString(
        "base64"
      ),
      sessionId: "session-nested",
      v: 1,
      windowId: "1",
    });
    appendFileSync(jsonlPath, `${line}\n`);
    await observer.pollNow();

    expect(received[0]).toMatchObject({
      agentInstanceId: "worker-top",
      sessionId: "session-top",
      toolUseId: "tool-top",
      turnId: "turn-top",
    });
    observer.dispose();
  });
});
