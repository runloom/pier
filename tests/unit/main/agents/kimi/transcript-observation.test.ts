import { appendFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createKimiTranscriptReconciler } from "@main/services/agents/integrations/transcript/kimi-reconciler.ts";
import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";
import { expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const mockedStat = vi.fn(actual.stat);
  return {
    ...actual,
    default: { ...actual, stat: mockedStat },
    stat: mockedStat,
  };
});

it("preserves the legacy prompt watermark when a tool overtakes the Kimi path lookup", async () => {
  const root = await mkdtemp(join(tmpdir(), "pier-kimi-observe-"));
  const sessionDir = join(root, "project", "session-main");
  await mkdir(sessionDir, { recursive: true });
  const path = join(sessionDir, "wire.jsonl");
  writeFileSync(path, '{"message":{"type":"TurnBegin"}}\n');
  const received: AgentHookEventPayload[] = [];
  const reconciler = createKimiTranscriptReconciler({
    onTerminalEvent: (event) => received.push(event),
    sessionsRoots: [root],
  });
  const context: AgentHookEventPayload = {
    agent: "kimi",
    event: "SessionStart",
    kind: "agentEvent",
    panelId: "panel-kimi",
    sessionId: "session-main",
    v: 1,
    windowId: "1",
  };
  const entered = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  const actual =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises"
    );
  const terminalLine = '{"message":{"type":"TurnEnd","payload":{}}}\n';
  try {
    await reconciler.observe(context);
    vi.mocked(stat)
      .mockImplementationOnce(async (...args) => {
        entered.resolve();
        await resume.promise;
        return actual.stat(...args);
      })
      .mockImplementationOnce(actual.stat)
      .mockImplementationOnce(async (...args) => {
        const initial = await actual.stat(...args);
        // The old completion becomes visible after the initial scan boundary,
        // but before PromptSubmit's watermark read. Only that watermark can reject it.
        appendFileSync(path, terminalLine);
        return initial;
      });
    const prompt = reconciler.observe({ ...context, event: "PromptSubmit" });
    await entered.promise;
    await reconciler.observe({
      ...context,
      event: "ToolStart",
      toolUseId: "tool-1",
    });
    resume.resolve();
    await prompt;
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(received).toHaveLength(0);
    appendFileSync(path, terminalLine);
    await vi.waitFor(() => expect(received).toHaveLength(1));
  } finally {
    resume.resolve();
    reconciler.dispose();
    vi.mocked(stat).mockImplementation(actual.stat);
    await rm(root, { force: true, recursive: true });
  }
});
