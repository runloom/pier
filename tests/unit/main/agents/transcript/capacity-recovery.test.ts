import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTranscriptTailReconciler } from "@main/services/agents/integrations/transcript/tail-reconciler.ts";
import type {
  AgentHookEventPayload,
  AgentHookEventPayloadV1,
} from "@shared/contracts/agent/session.ts";
import { expect, it, vi } from "vitest";

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "pier-tail-capacity-"));
  const received: AgentHookEventPayload[] = [];
  const reconciler = createTranscriptTailReconciler({
    agent: "kimi",
    transcriptRoot: root,
    classifyLine: (line) => ({
      turnId: JSON.parse(line).turnId,
      nativeEvent: "native.completed",
      pierEvent: "TurnCompleted",
    }),
    onTerminalEvent: (event) => received.push(event),
  });
  const hook = (n: number, panel = `p${n}`): AgentHookEventPayloadV1 => ({
    agent: "kimi",
    event: "PromptSubmit",
    kind: "agentEvent",
    panelId: panel,
    windowId: "w",
    sessionId: `s${n}`,
    transcriptPath: join(root, `${n}.jsonl`),
    v: 1,
  });
  for (let n = 0; n < 33; n += 1) {
    await writeFile(join(root, `${n}.jsonl`), "");
    if (n < 32) await reconciler.observe(hook(n));
  }
  return {
    reconciler,
    received,
    hook,
    append: () => appendFile(join(root, "32.jsonl"), '{"turnId":""}\n'),
    close: async () => {
      reconciler.dispose();
      await rm(root, { recursive: true, force: true });
    },
  };
}

it("rebinds an existing sole owner at the 32-file limit without requiring another free slot", async () => {
  const s = await setup();
  try {
    await s.reconciler.observe(s.hook(32, "p0"));
    await s.append();
    await vi.waitFor(() => expect(s.received).toHaveLength(1));
    expect(s.received[0]).toMatchObject({ panelId: "p0", sessionId: "s32" });
  } finally {
    await s.close();
  }
});

it("a capacity waiter keeps its prompt boundary and follows a window transfer when capacity frees", async () => {
  const s = await setup();
  try {
    await s.reconciler.observe(s.hook(32));
    await s.append();
    s.reconciler.transferPanelOwnership({
      panelId: "p32",
      sourceWindowId: "w",
      targetWindowId: "next",
    });
    s.reconciler.releasePanel("p0", "w");
    await vi.waitFor(() => expect(s.received).toHaveLength(1));
    expect(s.received[0]).toMatchObject({ panelId: "p32", windowId: "next" });
  } finally {
    await s.close();
  }
});

it("releasing a capacity waiter cancels its delayed registration", async () => {
  const s = await setup();
  try {
    await s.reconciler.observe(s.hook(32));
    s.reconciler.releasePanel("p32", "w");
    s.reconciler.releasePanel("p0", "w");
    await s.append();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(s.received).toEqual([]);
  } finally {
    await s.close();
  }
});

it("a shared old file keeps its other owner while a rebind waits for capacity", async () => {
  const s = await setup();
  try {
    await s.reconciler.observe(s.hook(0, "shared"));
    await s.reconciler.observe(s.hook(32, "p0"));
    await s.append();
    const oldPath = s.hook(0).transcriptPath;
    if (!oldPath) throw new Error("missing fixture path");
    await appendFile(oldPath, '{"turnId":""}\n');
    await vi.waitFor(() => expect(s.received).toHaveLength(1));
    expect(s.received[0]?.panelId).toBe("shared");
    s.reconciler.releasePanel("shared", "w");
    await vi.waitFor(() => expect(s.received).toHaveLength(2));
    expect(s.received[1]?.panelId).toBe("p0");
  } finally {
    await s.close();
  }
});
