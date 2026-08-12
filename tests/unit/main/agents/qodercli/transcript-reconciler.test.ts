import { appendFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentHookEventPayload,
  AgentHookEventPayloadV1,
} from "@shared/contracts/agent/session.ts";
import { agentHookEventSchema } from "@shared/contracts/agent/session.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findSessionJsonlUnderProjects } from "../../../../../src/main/services/agents/integrations/transcript/projects-jsonl-path.ts";
import {
  createQoderTranscriptReconciler,
  QODER_TRANSCRIPT_TERMINAL_EVIDENCE,
} from "../../../../../src/main/services/agents/integrations/transcript/qoder-reconciler.ts";

function hookEvent(
  overrides: Partial<AgentHookEventPayloadV1> = {}
): AgentHookEventPayload {
  return {
    agent: "qodercli",
    event: "PromptSubmit",
    kind: "agentEvent",
    panelId: "panel-1",
    sessionId: "session-1",
    v: 1,
    windowId: "1",
    ...overrides,
  };
}

function interruptLine(
  text = "[Request interrupted by user]",
  extra: Record<string, unknown> = {}
): string {
  return `${JSON.stringify({
    message: { content: [{ text, type: "text" }], role: "user" },
    type: "user",
    ...extra,
  })}\n`;
}

describe("qoder transcript reconciler", () => {
  let dir: string;
  let projectsRoot: string;
  let cwdDir: string;
  let path: string;

  beforeEach(async () => {
    vi.useRealTimers();
    dir = await mkdtemp(join(tmpdir(), "pier-qoder-transcript-"));
    projectsRoot = join(dir, "projects");
    cwdDir = join(projectsRoot, "-Users-test-project");
    await mkdir(cwdDir, { recursive: true });
    path = join(cwdDir, "session-1.jsonl");
    writeFileSync(path, '{"type":"summary"}\n');
  });

  afterEach(async () => {
    await rm(dir, { force: true, recursive: true });
  });

  it("导出中断证据与矩阵对齐", () => {
    expect(QODER_TRANSCRIPT_TERMINAL_EVIDENCE).toEqual([
      {
        nativeEvent: "qoder.transcript.user_interrupt",
        pierEvent: "TurnInterrupted",
      },
    ]);
  });

  it("把主链中断标记对账为 TurnInterrupted", async () => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createQoderTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      transcriptRoot: projectsRoot,
    });
    await reconciler.observe(hookEvent({ transcriptPath: path }));
    appendFileSync(path, interruptLine());

    await vi.waitFor(() => {
      expect(received).toHaveLength(1);
    });
    expect(received[0]).toMatchObject({
      event: "TurnInterrupted",
      nativeEvent: "qoder.transcript.user_interrupt",
      panelId: "panel-1",
      sessionId: "session-1",
      v: 3,
      windowId: "1",
    });
    expect(agentHookEventSchema.safeParse(received[0]).success).toBe(true);
    reconciler.dispose();
  });

  it("无 transcriptPath 时按 sessionId 扫描 projects 布局", async () => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createQoderTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      transcriptRoot: projectsRoot,
    });
    await reconciler.observe(hookEvent({ sessionId: "session-1" }));
    appendFileSync(path, interruptLine());

    await vi.waitFor(() => {
      expect(received).toHaveLength(1);
    });
    expect(received[0]?.event).toBe("TurnInterrupted");
    reconciler.dispose();
  });

  it("findSessionJsonlUnderProjects 命中 cwd 编码目录", async () => {
    const found = await findSessionJsonlUnderProjects(
      projectsRoot,
      "session-1"
    );
    expect(found).toBe(path);
  });

  it("sidechain 中断不派发", async () => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createQoderTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      transcriptRoot: projectsRoot,
    });
    await reconciler.observe(hookEvent({ transcriptPath: path }));
    appendFileSync(
      path,
      interruptLine("[Request interrupted by user]", { isSidechain: true })
    );
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 300));

    expect(received).toHaveLength(0);
    reconciler.dispose();
  });

  it("观察前历史中断不回放", async () => {
    appendFileSync(path, interruptLine());
    const received: AgentHookEventPayload[] = [];
    const reconciler = createQoderTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      transcriptRoot: projectsRoot,
    });
    await reconciler.observe(hookEvent({ transcriptPath: path }));
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 300));

    expect(received).toHaveLength(0);
    reconciler.dispose();
  });

  it("忽略非 qodercli agent", async () => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createQoderTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      transcriptRoot: projectsRoot,
    });
    await reconciler.observe(
      hookEvent({ agent: "claude", transcriptPath: path })
    );
    appendFileSync(path, interruptLine());
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 300));

    expect(received).toHaveLength(0);
    reconciler.dispose();
  });
});
