/**
 * W3 agents.start/turn/screen 经 v2 session 接线（fake RuntimeControl）。
 */

import type { ResolveOriginPanel } from "@main/adapters/cli/local-control/capability-hot-path.ts";
import {
  LOCAL_CONTROL_FEATURE_AGENTS_SCREEN,
  LOCAL_CONTROL_FEATURE_AGENTS_START,
  LOCAL_CONTROL_FEATURE_AGENTS_TURN,
} from "@main/adapters/cli/local-control/features.ts";
import {
  type CreateSessionFromHelloResult,
  createLocalControlSessionFromHello,
} from "@main/adapters/cli/local-control/session.ts";
import { createCapabilityAuthority } from "@main/services/capability/authority.ts";
import {
  createFakeTerminalBackend,
  type FakeTerminalBackend,
} from "@main/services/runtime-control/fake-backend.ts";
import { createRuntimeControlService } from "@main/services/runtime-control/service.ts";
import { agentsStartRetryDetailsSchema } from "@shared/contracts/local-control/agents-runtime.ts";
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
        params: {
          agentId: "codex",
          cwd: "/tmp/wt",
          origin: { panelId: "panel_parent", windowId: "win_parent" },
        },
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

  function makeSession(overrides: {
    resolveOriginPanel?: ResolveOriginPanel;
    backend?: FakeTerminalBackend;
  }) {
    const frames: Array<{
      type?: string;
      ok?: boolean;
      error?: { code?: string; details?: unknown };
      data?: unknown;
    }> = [];
    const backend = overrides.backend ?? createFakeTerminalBackend();
    const runtimeControl = createRuntimeControlService({
      bootId: "boot_rt",
      backend,
    });
    const capabilityAuthority = createCapabilityAuthority();
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
        capabilityAuthority,
        resolveOriginPanel: overrides.resolveOriginPanel,
        emit: (f) => frames.push(f),
      }
    );
    return { created, frames, backend };
  }

  async function startOnce(
    created: CreateSessionFromHelloResult,
    frames: Array<{
      type?: string;
      ok?: boolean;
      error?: { code?: string; details?: unknown };
      data?: unknown;
    }>,
    requestId: string,
    effectKeySeed: string,
    params: Record<string, unknown>
  ) {
    const seen = frames.length;
    if (!created.ok) {
      throw new Error("session not created");
    }
    created.session.handleLine(
      JSON.stringify({
        apiVersion: LOCAL_CONTROL_API_VERSION,
        type: "request",
        requestId,
        op: "agents.start",
        effectKey: strongKey(effectKeySeed),
        params,
      })
    );
    await new Promise((r) => setTimeout(r, 20));
    return frames.slice(seen).find((f) => f.type === "response");
  }

  it("start without origin fails schema validation", async () => {
    const { created, frames } = makeSession({});
    const res = await startOnce(created, frames, "r1", "s1", {
      agentId: "codex",
    });
    expect(res?.ok).toBe(false);
    expect(res?.error?.code).toBe("invalid_command");
  });

  it("start with unresolvable origin is rejected invalid_origin", async () => {
    const { created, frames } = makeSession({
      resolveOriginPanel: () => undefined,
    });
    const res = await startOnce(created, frames, "r1", "s1", {
      agentId: "codex",
      origin: { panelId: "panel_ghost", windowId: "win_ghost" },
    });
    expect(res?.ok).toBe(false);
    expect(res?.error?.code).toBe("invalid_origin");
  });

  it("start targeting another window is rejected cross_window_unsupported", async () => {
    const { created, frames } = makeSession({
      resolveOriginPanel: () => ({ agentId: "omp" }),
    });
    const res = await startOnce(created, frames, "r1", "s1", {
      agentId: "codex",
      origin: { panelId: "panel_parent", windowId: "win_parent" },
      windowId: "win_other",
    });
    expect(res?.ok).toBe(false);
    expect(res?.error?.code).toBe("cross_window_unsupported");
  });

  it("start with promptText delivers marker-assembled prompt", async () => {
    const { created, frames, backend } = makeSession({});
    const res = await startOnce(created, frames, "r1", "s1", {
      agentId: "codex",
      origin: { panelId: "panel_parent", windowId: "win_parent" },
      promptText: "只回复 OK",
    });
    expect(res?.ok).toBe(true);
    const panelId = (res?.data as { panelId?: string } | undefined)?.panelId;
    const panel = panelId ? backend.panels.get(panelId) : undefined;
    expect(panel?.delivered[0]).toMatch(
      /^\[Delegated by parent \S+ panel \S+\]\n\n只回复 OK/u
    );
  });

  it("undeliverable prompt rolls back with retry details", async () => {
    const backend = createFakeTerminalBackend();
    backend.deliverInitialPrompt = async () => false;
    const { created, frames } = makeSession({ backend });
    const res = (await startOnce(created, frames, "r1", "s1", {
      agentId: "codex",
      origin: { panelId: "panel_parent", windowId: "win_parent" },
      promptText: "hi",
    })) as {
      ok?: boolean;
      error?: { code?: string; details?: unknown };
      data?: { panelId?: string };
    };
    expect(res?.ok).toBe(false);
    expect(res?.error?.code).toBe("prompt_undeliverable");
    expect(
      agentsStartRetryDetailsSchema.safeParse(res?.error?.details).success
    ).toBe(true);
    const panels = [...backend.panels.values()];
    expect(panels.every((p) => p.closed)).toBe(true);
  });

  it("fifth concurrent child start hits quota_exceeded", async () => {
    const { created, frames } = makeSession({});
    for (let i = 1; i <= 4; i += 1) {
      const res = await startOnce(created, frames, `r${i}`, `s${i}`, {
        agentId: "codex",
        origin: { panelId: `p${i}`, windowId: "w" },
      });
      expect(res?.ok).toBe(true);
    }
    const fifth = await startOnce(created, frames, "r5", "s5", {
      agentId: "codex",
      origin: { panelId: "p5", windowId: "w" },
    });
    expect(fifth?.ok).toBe(false);
    expect(fifth?.error?.code).toBe("quota_exceeded");
  });
});
