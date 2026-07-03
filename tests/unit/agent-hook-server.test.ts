import { connect } from "node:net";
import type { AgentHookEventPayload } from "@shared/contracts/agent-session.ts";
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

  /** HTTP client body 不含 kind（老 body 结构，Commit B 里整个删）。 */
  const httpBody = {
    v: 1,
    agent: "claude",
    event: "PromptSubmit",
    panelId: "p1",
    windowId: "1",
  };
  /** 服务端补 kind="agentEvent" 后 aggregator 收到的 payload。 */
  const expectedPayload: AgentHookEventPayload = {
    v: 1,
    kind: "agentEvent",
    agent: "claude",
    event: "PromptSubmit",
    panelId: "p1",
    windowId: "1",
  };

  it("合法事件 → 204 并回调", async () => {
    const onEvent = vi.fn();
    server = await startAgentHookServer(onEvent);
    expect(server.port).toBeGreaterThan(0);
    const status = await post(server, httpBody);
    expect(status).toBe(204);
    expect(onEvent).toHaveBeenCalledWith(expectedPayload);
  });

  it("错误 token → 401 且不回调", async () => {
    const onEvent = vi.fn();
    server = await startAgentHookServer(onEvent);
    expect(await post(server, httpBody, { token: "wrong" })).toBe(401);
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
    expect(await post(server, httpBody, { path: "/other" })).toBe(404);
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
    const status = await post(server, httpBody);
    expect(status).toBe(204);
    expect(onEvent).toHaveBeenCalledWith(expectedPayload);
  });
});
