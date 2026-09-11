import {
  appendFile,
  mkdtemp,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTranscriptTailReconciler } from "@main/services/agents/integrations/transcript/tail-reconciler.ts";
import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";
import { expect, it, vi } from "vitest";

it.each([
  0, 256,
])("same-path replacement with %i extra bytes replays exact turn IDs without adopting anonymous history", async (extra) => {
  const root = await mkdtemp(join(tmpdir(), "pier-tail-generation-"));
  const path = join(root, "session.jsonl");
  const received: AgentHookEventPayload[] = [];
  const terminal = (turnId: string) => `${JSON.stringify({ turnId })}\n`;
  const old = `${JSON.stringify({ padding: "x".repeat(800) })}\n`;
  await writeFile(path, old);
  let lines = 0;
  let classifiers = 0;
  const reconciler = createTranscriptTailReconciler({
    agent: "kimi",
    transcriptRoot: root,
    createLineClassifier: () => {
      classifiers += 1;
      return (line) => {
        lines += 1;
        const parsed = JSON.parse(line);
        return typeof parsed.turnId === "string"
          ? {
              turnId: parsed.turnId,
              nativeEvent: "native.completed",
              pierEvent: "TurnCompleted",
            }
          : null;
      };
    },
    onTerminalEvent: (event) => received.push(event),
  });
  try {
    await reconciler.observe({
      agent: "kimi",
      event: "PromptSubmit",
      kind: "agentEvent",
      panelId: "p",
      windowId: "w",
      sessionId: "s",
      turnId: "current",
      transcriptPath: path,
      v: 1,
    });
    await vi.waitFor(() => expect(lines).toBeGreaterThan(0));
    const before = await stat(path);
    const records = terminal("") + terminal("old") + terminal("current");
    await writeFile(
      `${path}.next`,
      `${records}${" ".repeat(old.length + extra - records.length - 1)}\n`
    );
    await rename(`${path}.next`, path);
    expect((await stat(path)).ino).not.toBe(before.ino);
    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]).toMatchObject({
      event: "TurnCompleted",
      turnId: "current",
    });
    expect(classifiers).toBe(2);
    // A later anonymous terminal is new evidence, unlike replacement history.
    await appendFile(path, terminal(""));
    await vi.waitFor(() => expect(received).toHaveLength(2));
  } finally {
    reconciler.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
