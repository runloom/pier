import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLAUDE_HOOK_EVENTS } from "@main/services/agents/integrations/claude.ts";
import { CODEBUDDY_HOOK_EVENTS } from "@main/services/agents/integrations/codebuddy.ts";
import { CODEX_HOOK_EVENTS } from "@main/services/agents/integrations/codex.ts";
import { withPierCopilotHooks } from "@main/services/agents/integrations/copilot.ts";
import { GROK_HOOK_EVENTS } from "@main/services/agents/integrations/grok.ts";
import { QODERCLI_HOOK_EVENTS } from "@main/services/agents/integrations/qodercli.ts";
import type { NestedHookEventSpec } from "@main/services/agents/integrations/shared.ts";
import { createClaudeTranscriptReconciler } from "@main/services/agents/integrations/transcript/claude-reconciler.ts";
import { createCodebuddyTranscriptReconciler } from "@main/services/agents/integrations/transcript/codebuddy-reconciler.ts";
import { createCodexTranscriptReconciler } from "@main/services/agents/integrations/transcript/codex-reconciler.ts";
import { createCopilotTranscriptReconciler } from "@main/services/agents/integrations/transcript/copilot-reconciler.ts";
import { createGrokTranscriptReconciler } from "@main/services/agents/integrations/transcript/grok-reconciler.ts";
import { createQoderTranscriptReconciler } from "@main/services/agents/integrations/transcript/qoder-reconciler.ts";
import type { AgentHookEventPayloadV3 } from "@shared/contracts/agent/session.ts";
import { createNestedHookCommandProducer } from "./hook-command-driver.ts";
import { createInstalledCommandProducer } from "./installed-command-driver.ts";
import type {
  AgentStatusTraceAction,
  AgentStatusTraceProducer,
} from "./status-trace-types.ts";

interface TranscriptReconciler {
  dispose(): void;
  observe(event: AgentHookEventPayloadV3): Promise<void>;
}

export async function waitForTranscriptEvents(
  queue: AgentHookEventPayloadV3[]
): Promise<AgentHookEventPayloadV3[]> {
  const deadline = Date.now() + 3000;
  while (queue.length === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  if (queue.length === 0) {
    throw new Error("transcript reconciler 未产出事件");
  }
  return queue.splice(0);
}

export async function createTranscriptReconcilerProducer(
  agentId: "claude" | "codebuddy" | "codex" | "copilot" | "grok" | "qodercli"
): Promise<AgentStatusTraceProducer> {
  const root = await mkdtemp(
    join(tmpdir(), `pier-${agentId}-reconcile-trace-`)
  );
  const queue: AgentHookEventPayloadV3[] = [];
  let transcriptPath: string;
  let reconciler: TranscriptReconciler;
  if (
    agentId === "claude" ||
    agentId === "codebuddy" ||
    agentId === "qodercli"
  ) {
    const transcriptRoot = join(root, "projects");
    await mkdir(transcriptRoot, { recursive: true });
    transcriptPath = join(transcriptRoot, "session.jsonl");
    await writeFile(transcriptPath, '{"type":"summary"}\n', "utf8");
    const onTerminalEvent = (event: { kind?: string; v?: number }) => {
      if (event.kind === "agentEvent" && event.v === 3) {
        queue.push(event as AgentHookEventPayloadV3);
      }
    };
    const create = {
      claude: createClaudeTranscriptReconciler,
      codebuddy: createCodebuddyTranscriptReconciler,
      qodercli: createQoderTranscriptReconciler,
    }[agentId];
    reconciler = create({ onTerminalEvent, transcriptRoot });
  } else if (agentId === "copilot") {
    const sessionStateRoot = join(root, "session-state");
    const sessionDir = join(sessionStateRoot, "copilot-session-1");
    await mkdir(sessionDir, { recursive: true });
    transcriptPath = join(sessionDir, "events.jsonl");
    await writeFile(transcriptPath, '{"type":"session.start"}\n', "utf8");
    reconciler = createCopilotTranscriptReconciler({
      onTerminalEvent: (event) => {
        if (event.kind === "agentEvent" && event.v === 3) queue.push(event);
      },
      sessionStateRoot,
    });
  } else if (agentId === "codex") {
    const transcriptRoot = join(root, "sessions");
    await mkdir(transcriptRoot, { recursive: true });
    transcriptPath = join(transcriptRoot, "rollout.jsonl");
    await writeFile(transcriptPath, '{"type":"session_meta"}\n', "utf8");
    reconciler = createCodexTranscriptReconciler({
      onTerminalEvent: (event) => {
        if (event.kind === "agentEvent" && event.v === 3) queue.push(event);
      },
      transcriptRoot,
    });
  } else {
    const sessionsRoot = join(root, "sessions");
    const sessionDir = join(sessionsRoot, "encoded-cwd", "session-1");
    await mkdir(sessionDir, { recursive: true });
    transcriptPath = join(sessionDir, "updates.jsonl");
    await writeFile(
      transcriptPath,
      '{"method":"session/update","params":{}}\n',
      "utf8"
    );
    reconciler = createGrokTranscriptReconciler({
      onTerminalEvent: (event) => {
        if (event.kind === "agentEvent" && event.v === 3) queue.push(event);
      },
      sessionsRoot,
    });
  }
  let events: readonly NestedHookEventSpec[] = GROK_HOOK_EVENTS;
  if (agentId === "claude") {
    events = CLAUDE_HOOK_EVENTS;
  } else if (agentId === "codebuddy") {
    events = CODEBUDDY_HOOK_EVENTS;
  } else if (agentId === "codex") {
    events = CODEX_HOOK_EVENTS;
  } else if (agentId === "qodercli") {
    events = QODERCLI_HOOK_EVENTS;
  }
  const hookProducer =
    agentId === "copilot"
      ? await createCopilotHookProducer()
      : await createNestedHookCommandProducer(agentId, events);
  return {
    async close() {
      reconciler.dispose();
      await hookProducer.close();
      await rm(root, { force: true, recursive: true });
    },
    async run(action: AgentStatusTraceAction) {
      if (action.producerKey === "transcript") {
        await appendFile(transcriptPath, String(action.payload), "utf8");
        return waitForTranscriptEvents(queue);
      }
      const emitted = await hookProducer.run(action);
      for (const raw of emitted) {
        const event = raw as AgentHookEventPayloadV3;
        if (event.event === "PromptSubmit") {
          const payload =
            action.payload && typeof action.payload === "object"
              ? (action.payload as Record<string, unknown>)
              : {};
          const promptId = payload.promptId ?? payload.prompt_id;
          await reconciler.observe({
            ...event,
            transcriptPath,
            ...(typeof promptId === "string" ? { turnId: promptId } : {}),
          });
        }
      }
      return emitted;
    },
  };
}

function createCopilotHookProducer(): Promise<AgentStatusTraceProducer> {
  const installed = withPierCopilotHooks({});
  const hooks = installed.hooks as Record<string, Array<{ bash?: string }>>;
  return createInstalledCommandProducer(
    "copilot",
    new Map(
      Object.entries(hooks).flatMap(([nativeEvent, entries]) => {
        const command = entries[0]?.bash;
        return command ? [[nativeEvent, command] as const] : [];
      })
    )
  );
}

export function transcriptAction(
  nativeEvent: string,
  payload: string,
  checkpoints: AgentStatusTraceAction["checkpoints"],
  scenarios: AgentStatusTraceAction["scenarios"] = []
): AgentStatusTraceAction {
  return {
    checkpoints,
    expectedNativeEvents: [nativeEvent],
    nativeEvent,
    payload,
    producerKey: "transcript",
    scenarios,
  };
}

export function jsonl(...rows: readonly unknown[]): string {
  return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}
