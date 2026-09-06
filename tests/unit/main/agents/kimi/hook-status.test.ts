import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  eventsJsonlPath,
  installAgentHooksEmitScript,
  pierHooksCurrentDir,
} from "@main/services/agents/hooks-install.ts";
import {
  kimiIntegration,
  withPierKimiHooks,
} from "@main/services/agents/integrations/kimi.ts";
import { resolveAgentEventIngestOptions } from "@main/services/agents/integrations/runtime/event-authority.ts";
import { createForegroundActivityAggregator } from "@main/services/foreground-activity/aggregator.ts";
import { enrichAgentEventFromRawPayload } from "@main/services/foreground-activity/jsonl-enrichment.ts";
import { agentHookEventSchema } from "@shared/contracts/agent/session.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pathForHookSpawn } from "../../../agent-integrations/hook-spawn-path.ts";

describe("Kimi Code hook status", () => {
  let root: string;
  let hooksHome: string;
  let logPath: string;
  let aggregator: ReturnType<typeof createForegroundActivityAggregator>;
  const commands = new Map<string, string>();

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "pier-kimi-status-"));
    hooksHome = join(root, "hooks");
    const userData = join(root, "userData");
    await installAgentHooksEmitScript(userData, { hooksHome });
    logPath = eventsJsonlPath(userData);
    aggregator = createForegroundActivityAggregator();
    for (const entry of withPierKimiHooks("").split("[[hooks]]")) {
      const lines = entry.split("\n");
      const event = lines.find((line) => line.startsWith("event = "));
      const command = lines.find((line) => line.startsWith("command = "));
      if (event && command) {
        commands.set(
          JSON.parse(event.slice("event = ".length)),
          JSON.parse(command.slice("command = ".length))
        );
      }
    }
  });

  afterEach(async () => {
    aggregator.dispose();
    commands.clear();
    await rm(root, { force: true, recursive: true });
  });

  async function emit(
    nativeEvent: string,
    fields: Record<string, unknown> = {}
  ) {
    const command = commands.get(nativeEvent);
    if (!command) throw new Error(`Missing Kimi hook: ${nativeEvent}`);
    const result = spawnSync("/bin/sh", ["-c", command], {
      env: {
        ...process.env,
        PATH: pathForHookSpawn(process.env.PATH),
        PIER_AGENT_EVENT_LOG: logPath,
        PIER_AGENT_HOOKS_DIR: pierHooksCurrentDir(hooksHome),
        PIER_PANEL_ID: "panel-kimi",
        PIER_WINDOW_ID: "window-kimi",
      },
      input: JSON.stringify({
        hook_event_name: nativeEvent,
        session_id: "session-main",
        ...fields,
      }),
    });
    expect(result.status, result.stderr.toString()).toBe(0);
    const line = (await readFile(logPath, "utf8")).trim().split("\n").at(-1);
    const event = enrichAgentEventFromRawPayload(
      agentHookEventSchema.parse(JSON.parse(line ?? ""))
    );
    if (event.kind !== "agentEvent") throw new Error("Expected agent event");
    aggregator.ingestAgentEvent(
      event,
      resolveAgentEventIngestOptions({
        event,
        evidenceSource: "hook",
        runtime: kimiIntegration.runtime,
      })
    );
    return event;
  }

  it("subagent Stop events cannot clear the parent's work or processing state", async () => {
    // Kimi Code 0.41.0: both children emit Stop with the main session_id,
    // without an agent_id/turn_id. No UserPromptSubmit preceded this run.
    await emit("SessionStart");
    for (const [index, id] of ["task-a", "task-b"].entries()) {
      await emit("PreToolUse", { tool_call_id: id, tool_name: "Agent" });
      const started = await emit("SubagentStart", { agent_name: "explore" });
      expect(started).toMatchObject({ parentSessionId: "session-main" });
      expect(aggregator.snapshot().activities[0]).toMatchObject({
        subagentCount: index + 1,
      });
    }
    for (const [index, id] of ["task-a", "task-b"].entries()) {
      await emit("Stop", { stop_hook_active: false });
      await emit("StopFailure", {
        error_type: "ModelError",
        error_message: "child failed",
      });
      expect(aggregator.snapshot().activities[0]).toMatchObject({
        status: "tool",
        subagentCount: 2 - index,
      });
      await emit("SubagentStop", { agent_name: "explore" });
      expect(aggregator.snapshot().activities[0]).toMatchObject({
        subagentCount: 1 - index,
      });
      await emit("PostToolUse", { tool_call_id: id, tool_name: "Agent" });
    }
    expect(aggregator.snapshot().activities[0]).toMatchObject({
      status: "processing",
      subagentCount: 0,
    });
    await emit("PreToolUse", { tool_call_id: "write-1", tool_name: "Write" });
    expect(aggregator.snapshot().activities[0]).toMatchObject({
      status: "tool",
    });
    await emit("PostToolUse", { tool_call_id: "write-1", tool_name: "Write" });
    expect(aggregator.snapshot().activities[0]).toMatchObject({
      status: "processing",
    });
  }, 15_000);

  it.each([
    ["PostToolUse", "completed"],
    ["PostToolUseFailure", "failed"],
  ])("AskUserQuestion waits for an answer until %s", async (postEvent, outcome) => {
    const fields = { tool_call_id: "question-1", tool_name: "AskUserQuestion" };
    const requested = await emit("PreToolUse", fields);
    expect(requested).toMatchObject({
      event: "InteractionRequested",
      interactionId: "question-1",
      interactionKind: "question",
    });
    expect(aggregator.snapshot().activities[0]).toMatchObject({
      status: "waiting",
    });

    // Background tool activity must not hide a pending question.
    await emit("PreToolUse", { tool_call_id: "read-1", tool_name: "Read" });
    await emit("PostToolUse", { tool_call_id: "read-1", tool_name: "Read" });
    expect(aggregator.snapshot().activities[0]).toMatchObject({
      status: "waiting",
    });

    const resolved = await emit(postEvent, fields);
    expect(resolved).toMatchObject({
      event: "InteractionResolved",
      interactionId: "question-1",
      interactionKind: "question",
      interactionOutcome: outcome,
    });
    expect(aggregator.snapshot().activities[0]).toMatchObject({
      status: "processing",
    });
  });
});
