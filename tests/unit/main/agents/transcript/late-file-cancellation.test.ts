import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTranscriptTailReconciler } from "@main/services/agents/integrations/transcript/tail-reconciler.ts";
import type { AgentHookEventPayloadV1 } from "@shared/contracts/agent/session.ts";
import { expect, it, vi } from "vitest";

const gate = vi.hoisted(() => ({
  wait: undefined as (() => Promise<void>) | undefined,
}));
vi.mock(
  "@main/services/agents/integrations/transcript/tail-path.ts",
  async (original) => {
    const paths =
      await original<
        typeof import("@main/services/agents/integrations/transcript/tail-path.ts")
      >();
    return {
      ...paths,
      selectObservedTranscriptPath: async (
        ...args: Parameters<typeof paths.selectObservedTranscriptPath>
      ) => {
        const path = await paths.selectObservedTranscriptPath(...args);
        await gate.wait?.();
        return path;
      },
    };
  }
);

it("releasing a panel during late-path lookup cannot create an orphan watcher", async () => {
  const root = await mkdtemp(join(tmpdir(), "pier-late-file-cancel-"));
  const path = join(root, "session.jsonl");
  const target = join(root, "native.jsonl");
  const createLineClassifier = vi.fn(() => () => null);
  const reconciler = createTranscriptTailReconciler({
    agent: "claude",
    createLineClassifier,
    onTerminalEvent() {},
    transcriptRoot: root,
  });
  const prompt: AgentHookEventPayloadV1 = {
    agent: "claude",
    event: "PromptSubmit",
    kind: "agentEvent",
    panelId: "panel-1",
    sessionId: "session-1",
    transcriptPath: path,
    v: 1,
    windowId: "1",
  };
  let resume = () => {};
  let entered = () => {};
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const paused = new Promise<void>((resolve) => {
    resume = resolve;
  });
  try {
    await reconciler.observe(prompt);
    expect(createLineClassifier).toHaveBeenCalledTimes(1);
    await writeFile(target, '{"type":"summary"}\n');
    await symlink(target, path);
    gate.wait = () => {
      entered();
      return paused;
    };
    const observing = reconciler.observe({ ...prompt, event: "Stop" });
    await waiting;
    reconciler.releasePanel("panel-1", "1");
    resume();
    await observing;
    expect(createLineClassifier).toHaveBeenCalledTimes(1);
  } finally {
    resume();
    gate.wait = undefined;
    reconciler.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
