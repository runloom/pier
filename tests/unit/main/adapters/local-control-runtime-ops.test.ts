/**
 * W3 agents.start/turn/screen 经 v2 session 接线（fake RuntimeControl）。
 */

import {
  LOCAL_CONTROL_FEATURE_AGENTS_SCREEN,
  LOCAL_CONTROL_FEATURE_AGENTS_START,
  LOCAL_CONTROL_FEATURE_AGENTS_TURN,
} from "@main/adapters/cli/local-control/features.ts";
import { createLocalControlSessionFromHello } from "@main/adapters/cli/local-control/session.ts";
import { createFakeTerminalBackend } from "@main/services/runtime-control/fake-backend.ts";
import { createRuntimeControlService } from "@main/services/runtime-control/service.ts";
import { LOCAL_CONTROL_API_VERSION } from "@shared/contracts/local-control/errors.ts";
import { describe, expect, it } from "vitest";

function strongKey(seed: string): string {
  return `${seed}${"x".repeat(24)}`.slice(0, 32);
}

describe("local-control agents runtime ops", () => {
  it("cli-human can start → turn → screen with RuntimeRef", async () => {
    const frames: Record<string, unknown>[] = [];

    const backend = createFakeTerminalBackend();
    const runtimeControl = createRuntimeControlService({
      bootId: "boot_rt",
      backend,
      nowMs: () => 42,
    });

    const created = createLocalControlSessionFromHello(
      {
        apiVersion: LOCAL_CONTROL_API_VERSION,
        type: "client.hello",
        requestId: "h1",
        clientKind: "cli-human",
        auth: { method: "none" },
      },
      {
        bootId: "boot_rt",
        features: [],
        runtimeControl,
        emit: (f) => frames.push(f as Record<string, unknown>),
      }
    );
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    expect(created.helloFrame).toMatchObject({
      features: expect.arrayContaining([
        LOCAL_CONTROL_FEATURE_AGENTS_START,
        LOCAL_CONTROL_FEATURE_AGENTS_TURN,
        LOCAL_CONTROL_FEATURE_AGENTS_SCREEN,
      ]),
    });

    created.session.handleLine(
      JSON.stringify({
        apiVersion: LOCAL_CONTROL_API_VERSION,
        type: "request",
        requestId: "r-start",
        op: "agents.start",
        effectKey: strongKey("start"),
        params: { agentId: "codex", cwd: "/tmp/wt" },
      })
    );

    await new Promise((r) => setTimeout(r, 20));
    const startRes = frames.find((f) => f.type === "response") as {
      ok?: boolean;
      data?: {
        runtime?: { bootId: string; runtimeId: string; generation: number };
        agentId?: string;
      };
    };
    expect(startRes?.ok).toBe(true);
    const runtime = startRes?.data?.runtime;
    expect(runtime?.bootId).toBe("boot_rt");
    expect(runtime?.generation).toBe(1);
    expect(startRes?.data?.agentId).toBe("codex");
    if (!runtime) {
      return;
    }

    backend.setViewport(runtime.runtimeId, "hello viewport");

    frames.length = 0;
    created.session.handleLine(
      JSON.stringify({
        apiVersion: LOCAL_CONTROL_API_VERSION,
        type: "request",
        requestId: "r-turn",
        op: "agents.turn",
        effectKey: strongKey("turn"),
        params: {
          bootId: runtime.bootId,
          runtimeId: runtime.runtimeId,
          generation: runtime.generation,
          text: "ping\n",
        },
      })
    );
    await new Promise((r) => setTimeout(r, 20));
    const turnRes = frames.find((f) => f.type === "response") as {
      ok?: boolean;
      data?: { accepted?: boolean };
    };
    expect(turnRes?.ok).toBe(true);
    expect(turnRes?.data?.accepted).toBe(true);

    frames.length = 0;
    created.session.handleLine(
      JSON.stringify({
        apiVersion: LOCAL_CONTROL_API_VERSION,
        type: "request",
        requestId: "r-screen",
        op: "agents.screen",
        params: {
          bootId: runtime.bootId,
          runtimeId: runtime.runtimeId,
          generation: runtime.generation,
        },
      })
    );
    await new Promise((r) => setTimeout(r, 20));
    const screenRes = frames.find((f) => f.type === "response") as {
      ok?: boolean;
      data?: { screen?: { text?: string } };
    };
    expect(screenRes?.ok).toBe(true);
    expect(screenRes?.data?.screen?.text).toContain("viewport");
  });

  it("write ops without effectKey are rejected", async () => {
    const frames: Array<{
      type?: string;
      ok?: boolean;
      error?: { code?: string };
    }> = [];
    const runtimeControl = createRuntimeControlService({
      bootId: "boot_x",
      backend: createFakeTerminalBackend(),
    });
    const created = createLocalControlSessionFromHello(
      {
        apiVersion: LOCAL_CONTROL_API_VERSION,
        type: "client.hello",
        requestId: "h1",
        clientKind: "cli-human",
        auth: { method: "none" },
      },
      {
        bootId: "boot_x",
        features: [],
        runtimeControl,
        emit: (f) => frames.push(f),
      }
    );
    if (!created.ok) {
      return;
    }
    created.session.handleLine(
      JSON.stringify({
        apiVersion: LOCAL_CONTROL_API_VERSION,
        type: "request",
        requestId: "r1",
        op: "agents.start",
        params: { agentId: "codex" },
      })
    );
    await new Promise((r) => setTimeout(r, 10));
    const res = frames.find((f) => f.type === "response");
    expect(res?.ok).toBe(false);
    expect(res?.error?.code).toBe("invalid_command");
  });
});
