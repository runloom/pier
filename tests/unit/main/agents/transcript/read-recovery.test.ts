import {
  appendFile,
  mkdtemp,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTranscriptTailReconciler } from "@main/services/agents/integrations/transcript/tail-reconciler.ts";
import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";
import { expect, it, vi } from "vitest";

const fault = vi.hoisted(() => ({ path: "", unreadable: true, attempts: 0 }));
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  const failingOpen = async (...args: Parameters<typeof fs.open>) => {
    if (args[0] === fault.path) {
      fault.attempts += 1;
      if (fault.unreadable)
        throw Object.assign(new Error("permission denied"), { code: "EACCES" });
    }
    return fs.open(...args);
  };
  return { ...fs, default: { ...fs, open: failingOpen }, open: failingOpen };
});

it("a new Prompt during a failed read keeps its own replacement-file boundary", async () => {
  const root = await mkdtemp(join(tmpdir(), "pier-tail-prompt-generation-"));
  const path = join(root, "session.jsonl");
  await writeFile(path, "");
  fault.path = await realpath(path);
  fault.attempts = 0;
  fault.unreadable = false;
  const received: AgentHookEventPayload[] = [];
  const reconciler = createTranscriptTailReconciler({
    agent: "kimi",
    transcriptRoot: root,
    classifyLine: () => ({
      turnId: "",
      nativeEvent: "native.completed",
      pierEvent: "TurnCompleted",
    }),
    onTerminalEvent: (event) => received.push(event),
  });
  const context = {
    agent: "kimi",
    kind: "agentEvent",
    panelId: "p",
    windowId: "w",
    transcriptPath: path,
    v: 1,
  } as const;
  try {
    await reconciler.observe({ ...context, event: "SessionStart" });
    await vi.waitFor(() => expect(fault.attempts).toBe(1));
    fault.unreadable = true;
    await reconciler.observe({ ...context, event: "Stop" });
    await vi.waitFor(() => expect(fault.attempts).toBe(2));
    // The pre-Prompt anonymous terminal in B is history; only its append is current.
    await writeFile(`${path}.next`, '{"done":"old"}\n');
    await rename(`${path}.next`, path);
    await reconciler.observe({ ...context, event: "PromptSubmit" });
    await appendFile(path, '{"done":"current"}\n');
    fault.unreadable = false;
    await vi.waitFor(() => expect(received).toHaveLength(1), { timeout: 2000 });
  } finally {
    reconciler.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
// Recovery must work even when the watcher provides no further callback.
vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  const overrides = { watchFile: vi.fn(), unwatchFile: vi.fn() };
  return { ...fs, ...overrides, default: { ...fs, ...overrides } };
});

it.each([
  false,
  true,
])("read failure retries without another hook or file change; released=%s", async (release) => {
  const root = await mkdtemp(join(tmpdir(), "pier-tail-retry-"));
  const path = join(root, "session.jsonl");
  await writeFile(path, '{"turnId":"current"}\n');
  fault.path = await realpath(path);
  fault.unreadable = true;
  fault.attempts = 0;
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
  try {
    await reconciler.observe({
      agent: "kimi",
      event: "PromptSubmit",
      kind: "agentEvent",
      panelId: "p",
      windowId: "w",
      turnId: "current",
      transcriptPath: path,
      v: 1,
    });
    await vi.waitFor(() => expect(fault.attempts).toBe(1));
    if (release) reconciler.releasePanel("p", "w");
    fault.unreadable = false;
    if (release) {
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(fault.attempts).toBe(1);
      expect(received).toEqual([]);
    } else {
      await vi.waitFor(() => expect(received).toHaveLength(1), {
        timeout: 2000,
      });
      expect(received[0]?.turnId).toBe("current");
    }
  } finally {
    reconciler.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
