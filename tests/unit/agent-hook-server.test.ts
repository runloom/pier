import { connect } from "node:net";
import type { AgentHookEvent } from "@shared/contracts/agent-session.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type AgentHookServer,
  startAgentHookServer,
} from "../../src/main/services/agents/agent-hook-server.ts";

describe("agent-hook-server", () => {
  let server: AgentHookServer | null = null;

  afterEach(async () => {
    await server?.close();
    server = null;
  });

  async function post(
    s: AgentHookServer,
    body: unknown,
    opts: { path?: string; token?: string } = {}
  ): Promise<number> {
    const res = await fetch(
      `http://127.0.0.1:${s.port}${opts.path ?? "/agent-event"}`,
      {
        body: JSON.stringify(body),
        headers: {
          Authorization: `Bearer ${opts.token ?? s.token}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      }
    );
    return res.status;
  }

  const valid: AgentHookEvent = {
    v: 1,
    agent: "claude",
    event: "PromptSubmit",
    panelId: "p1",
    windowId: "1",
  };

  it("合法事件 → 204 并回调", async () => {
    const onEvent = vi.fn();
    server = await startAgentHookServer(onEvent);
    expect(server.port).toBeGreaterThan(0);
    const status = await post(server, valid);
    expect(status).toBe(204);
    expect(onEvent).toHaveBeenCalledWith(valid);
  });

  it("错误 token → 401 且不回调", async () => {
    const onEvent = vi.fn();
    server = await startAgentHookServer(onEvent);
    expect(await post(server, valid, { token: "wrong" })).toBe(401);
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("schema 不合法 → 400", async () => {
    const onEvent = vi.fn();
    server = await startAgentHookServer(onEvent);
    expect(await post(server, { v: 1, agent: "nope" })).toBe(400);
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("非 /agent-event 路径 → 404", async () => {
    server = await startAgentHookServer(vi.fn());
    expect(await post(server, valid, { path: "/other" })).toBe(404);
  });

  async function postCommand(
    s: AgentHookServer,
    commandLine: string,
    headers: Record<string, string>,
    token = s.token
  ): Promise<number> {
    const res = await fetch(`http://127.0.0.1:${s.port}/command-event`, {
      body: commandLine,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "text/plain",
        ...headers,
      },
      method: "POST",
    });
    return res.status;
  }

  it("/command-event: headers 路由 + raw body 命令行 → 204 并回调", async () => {
    const onCommand = vi.fn();
    server = await startAgentHookServer(vi.fn(), onCommand);
    const status = await postCommand(server, 'codex --model "gpt 5.5"', {
      "X-Pier-Panel-Id": "p1",
      "X-Pier-Window-Id": "3",
    });
    expect(status).toBe(204);
    expect(onCommand).toHaveBeenCalledWith({
      v: 1,
      commandLine: 'codex --model "gpt 5.5"',
      panelId: "p1",
      windowId: "3",
    });
  });

  it("/command-event: 缺路由 header → 400", async () => {
    const onCommand = vi.fn();
    server = await startAgentHookServer(vi.fn(), onCommand);
    expect(await postCommand(server, "codex", {})).toBe(400);
    expect(
      await postCommand(server, "codex", { "X-Pier-Panel-Id": "p1" })
    ).toBe(400);
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("/command-event: 错误 token → 401", async () => {
    const onCommand = vi.fn();
    server = await startAgentHookServer(vi.fn(), onCommand);
    expect(
      await postCommand(
        server,
        "codex",
        { "X-Pier-Panel-Id": "p1", "X-Pier-Window-Id": "3" },
        "wrong"
      )
    ).toBe(401);
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("/command-event: 超长命令行截断到 4096 而非拒绝", async () => {
    const onCommand = vi.fn();
    server = await startAgentHookServer(vi.fn(), onCommand);
    const status = await postCommand(server, `codex ${"x".repeat(6000)}`, {
      "X-Pier-Panel-Id": "p1",
      "X-Pier-Window-Id": "3",
    });
    expect(status).toBe(204);
    expect(onCommand.mock.calls[0]?.[0].commandLine).toHaveLength(4096);
  });

  it("客户端中途断开不致崩溃", async () => {
    const onEvent = vi.fn();
    server = await startAgentHookServer(onEvent);
    const s = server;

    await new Promise<void>((resolve, reject) => {
      const socket = connect(s.port, "127.0.0.1", () => {
        socket.write(
          "POST /agent-event HTTP/1.1\r\n" +
            `Host: 127.0.0.1:${s.port}\r\n` +
            `Authorization: Bearer ${s.token}\r\n` +
            "Content-Type: application/json\r\n" +
            "Content-Length: 1000\r\n" +
            "\r\n" +
            `{"partial":`
        );
      });
      socket.once("error", () => {
        // 主动 destroy 触发的本地 ECONNRESET 属预期, 忽略。
      });
      socket.once("connect", () => {
        setTimeout(() => {
          socket.destroy();
          resolve();
        }, 10);
      });
      socket.once("timeout", () => reject(new Error("socket timeout")));
    });

    await new Promise((r) => setTimeout(r, 50));

    // 服务器仍存活：随后一个合法请求应正常处理。
    const status = await post(server, valid);
    expect(status).toBe(204);
    expect(onEvent).toHaveBeenCalledWith(valid);
  });
});
