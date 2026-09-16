import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { connect, createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFxHerdrListener,
  fxHerdrSocketPath,
} from "../../../../src/main/services/foreground-activity/fx-herdr-listener.ts";

let root = "";
let listenerDispose: Array<() => void> = [];

afterEach(async () => {
  for (const dispose of listenerDispose) {
    dispose();
  }
  listenerDispose = [];
  if (root) {
    await rm(root, { force: true, recursive: true });
    root = "";
  }
  vi.unstubAllEnvs();
});

async function sendFrame(socketPath: string, line: string): Promise<void> {
  const socket = connect(socketPath);
  // 监听 dispose/对端 RST 与回包到达的竞态：回包已收到即算送达，
  // 后续的客户端错误不再让测试失败（回包本身仍由 once 保证）。
  socket.on("error", () => {});
  const replied = once(socket, "data");
  socket.setEncoding("utf8");
  socket.write(line.endsWith("\n") ? line : `${line}\n`);
  // 监听首帧落定后才回单行 ok（fx 语义：≤250ms 回包后关连接），
  // 收到回包即代表帧已处理，可直接断言事件。
  await replied;
  socket.end();
}

describe("fx Herdr 监听", () => {
  it("socket 路径按实例 userData 隔离", async () => {
    root = await mkdtemp(join(tmpdir(), "pier-fx-herdr-"));
    const userData = join(root, "userData");
    expect(fxHerdrSocketPath(userData)).toBe(join(userData, "fx-herdr.sock"));
  });

  it("HERDR_PANE_ID 随面板 env 注入（withPanelStatusEnv 与 PIER_PANEL_ID 同值）", async () => {
    const { withPanelStatusEnv } = await import(
      "../../../../src/main/ipc/terminal/create-launch.ts"
    );
    const out = withPanelStatusEnv(
      undefined,
      "terminal-9",
      "7",
      {},
      undefined,
      "fx"
    );
    expect(out.env?.HERDR_PANE_ID).toBe("terminal-9");
    expect(out.env?.PIER_PANEL_ID).toBe("terminal-9");
    const plain = withPanelStatusEnv(undefined, "terminal-9", "7", {});
    expect(plain.env?.HERDR_PANE_ID).toBeUndefined();
  });

  it("单行 report_agent → hook 事件（owner 路由 + 回包后关连接）", async () => {
    root = await mkdtemp(join(tmpdir(), "pier-fx-herdr-"));
    const events: AgentHookEventPayload[] = [];
    const userData = join(root, "userData");
    const listener = createFxHerdrListener({
      onAgentEvent: (event) => {
        events.push(event);
      },
      resolveOwner: (panelId) =>
        panelId === "terminal-3" ? { panelId, windowId: "11" } : null,
      userData,
    });
    listenerDispose.push(() => listener.dispose());
    const env = listener.env();
    expect(env.HERDR_SOCKET_PATH).toBe(listener.socketPath);
    await sendFrame(
      env.HERDR_SOCKET_PATH ?? "",
      '{"id":"1","method":"pane.report_agent","params":{"pane_id":"terminal-3","source":"custom:fx","agent":"fx","state":"working"}}'
    );
    // 未知面板的帧静默丢弃，不抛错。
    await sendFrame(
      env.HERDR_SOCKET_PATH ?? "",
      '{"id":"2","method":"pane.report_agent","params":{"pane_id":"terminal-9","source":"custom:fx","agent":"fx","state":"working"}}'
    );
    // 异源帧静默丢弃。
    await sendFrame(
      env.HERDR_SOCKET_PATH ?? "",
      '{"id":"3","method":"pane.report_agent","params":{"pane_id":"terminal-3","source":"other","agent":"fx","state":"working"}}'
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      agent: "fx",
      event: "processing",
      nativeEvent: "herdr.working",
      panelId: "terminal-3",
      windowId: "11",
    });
  });

  it("socket 残留文件不导致 EADDRINUSE（listen 前清、dispose 后删）", async () => {
    const { writeFileSync } = await import("node:fs");
    root = await mkdtemp(join(tmpdir(), "pier-fx-herdr-"));
    const userData = join(root, "userData");
    const stale = join(userData, "fx-herdr.sock");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(userData, { recursive: true });
    writeFileSync(stale, "stale");
    const events: AgentHookEventPayload[] = [];
    const listener = createFxHerdrListener({
      onAgentEvent: (event) => {
        events.push(event);
      },
      resolveOwner: (panelId) => ({ panelId, windowId: "11" }),
      userData,
    });
    listenerDispose.push(() => listener.dispose());
    const env = listener.env();
    await sendFrame(
      env.HERDR_SOCKET_PATH ?? "",
      '{"id":"1","method":"pane.report_agent","params":{"pane_id":"terminal-3","source":"custom:fx","agent":"fx","state":"working"}}'
    );
    expect(events).toHaveLength(1);
    const path = env.HERDR_SOCKET_PATH ?? "";
    listener.dispose();
    const { existsSync } = await import("node:fs");
    expect(existsSync(path)).toBe(false);
  });

  it("blocked 全种保持 processing（原因进 nativeEvent，不进 waiting）", async () => {
    root = await mkdtemp(join(tmpdir(), "pier-fx-herdr-"));
    const events: AgentHookEventPayload[] = [];
    const userData = join(root, "userData");
    const listener = createFxHerdrListener({
      onAgentEvent: (event) => {
        events.push(event);
      },
      resolveOwner: (panelId) => ({ panelId, windowId: "11" }),
      userData,
    });
    listenerDispose.push(() => listener.dispose());
    const env = listener.env();
    const socketPath = env.HERDR_SOCKET_PATH ?? "";
    await sendFrame(
      socketPath,
      '{"id":"1","method":"pane.report_agent","params":{"pane_id":"terminal-3","source":"custom:fx","agent":"fx","state":"blocked","custom_status":"permission"}}'
    );
    await sendFrame(
      socketPath,
      '{"id":"2","method":"pane.report_agent","params":{"pane_id":"terminal-3","source":"custom:fx","agent":"fx","state":"blocked","custom_status":"recovery"}}'
    );
    await sendFrame(
      socketPath,
      '{"id":"3","method":"pane.report_agent","params":{"pane_id":"terminal-3","source":"custom:fx","agent":"fx","state":"idle"}}'
    );
    expect(events.map((event) => event.event)).toEqual([
      "processing",
      "processing",
      "ActivityIdle",
    ]);
    expect(events[0]).toMatchObject({
      nativeEvent: "herdr.blocked.permission",
    });
  });

  it("上游回包语义：单连接单行，回包后可关", async () => {
    // fx 等 ≤250ms 单行回包；Pier 在首行后即回 ok，不等连接关闭。
    root = await mkdtemp(join(tmpdir(), "pier-fx-herdr-"));
    const seen: string[] = [];
    const server: Server = createServer((socket) => {
      socket.setEncoding("utf8");
      socket.once("data", (chunk: string) => {
        seen.push(chunk);
        socket.write('{"ok":true}\n');
        socket.end();
      });
    });
    await new Promise<void>((resolve) => {
      server.listen(join(root, "probe.sock"), resolve);
    });
    const reply = await new Promise<string>((resolve) => {
      const socket = connect(join(root, "probe.sock"));
      socket.setEncoding("utf8");
      socket.write('{"id":"1"}\n');
      socket.once("data", (chunk: string) => {
        resolve(chunk);
        socket.end();
      });
    });
    expect(reply).toContain('"ok"');
    expect(seen).toHaveLength(1);
    server.close();
  });
});
