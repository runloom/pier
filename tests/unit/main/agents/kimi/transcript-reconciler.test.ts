import { appendFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentHookEventPayload,
  AgentHookEventPayloadV1,
} from "@shared/contracts/agent/session.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyKimiWireLine,
  createKimiTranscriptReconciler,
  findKimiWireForSession,
  KIMI_TRANSCRIPT_TERMINAL_EVIDENCE,
} from "../../../../../src/main/services/agents/integrations/transcript/kimi-reconciler.ts";

function hookEvent(
  overrides: Partial<AgentHookEventPayloadV1> = {}
): AgentHookEventPayload {
  return {
    agent: "kimi",
    event: "PromptSubmit",
    kind: "agentEvent",
    panelId: "panel-1",
    sessionId: "sess-uuid",
    v: 1,
    windowId: "1",
    ...overrides,
  };
}

describe("kimi transcript reconciler", () => {
  let dir: string;
  let root: string;
  let path: string;

  beforeEach(async () => {
    vi.useRealTimers();
    dir = await mkdtemp(join(tmpdir(), "pier-kimi-transcript-"));
    root = join(dir, "sessions");
    const sessionDir = join(root, "projecthash", "sess-uuid");
    await mkdir(sessionDir, { recursive: true });
    path = join(sessionDir, "wire.jsonl");
    writeFileSync(path, '{"message":{"type":"TurnBegin","payload":{}}}\n');
  });

  afterEach(async () => {
    await rm(dir, { force: true, recursive: true });
  });

  it("classify TurnEnd", () => {
    expect(
      classifyKimiWireLine(
        JSON.stringify({ message: { payload: {}, type: "TurnEnd" } })
      )
    ).toEqual({
      ...KIMI_TRANSCRIPT_TERMINAL_EVIDENCE[0],
      turnId: "",
    });
  });

  it("find wire under project hash", async () => {
    expect(await findKimiWireForSession(root, "sess-uuid")).toBe(path);
  });

  it("TurnEnd 对账为 TurnCompleted", async () => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createKimiTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      sessionsRoot: root,
    });
    await reconciler.observe(hookEvent());
    appendFileSync(
      path,
      `${JSON.stringify({ message: { payload: {}, type: "TurnEnd" } })}\n`
    );

    await vi.waitFor(() => {
      expect(received).toHaveLength(1);
    });
    expect(received[0]).toMatchObject({
      event: "TurnCompleted",
      nativeEvent: "kimi.wire.TurnEnd",
      v: 3,
    });
    reconciler.dispose();
  });
});
