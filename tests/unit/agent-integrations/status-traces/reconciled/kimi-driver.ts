import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withPierKimiHooks } from "@main/services/agents/integrations/kimi.ts";
import { createKimiTranscriptReconciler } from "@main/services/agents/integrations/transcript/kimi-reconciler.ts";
import { enrichAgentEventFromRawPayload } from "@main/services/foreground-activity/jsonl-enrichment.ts";
import {
  type AgentHookEventPayloadV3,
  agentHookEventSchema,
} from "@shared/contracts/agent/session.ts";
import { createInstalledCommandProducer } from "../installed-command-driver.ts";
import type {
  AgentStatusTraceAction,
  AgentStatusTraceProducer,
} from "../status-trace-types.ts";
import { waitForTranscriptEvents } from "../transcript-reconciler-driver.ts";

export interface KimiTraceAction extends AgentStatusTraceAction {
  /** 该 hook 发出前原生 main wire 已落盘的记录；不会塞入 hook payload。 */
  readonly wireBefore?: readonly Record<string, unknown>[];
}

export async function createKimiTraceProducer(): Promise<AgentStatusTraceProducer> {
  const root = await mkdtemp(join(tmpdir(), "pier-kimi-wire-trace-"));
  const mainDir = join(root, "project", "session-1", "agents", "main");
  await mkdir(mainDir, { recursive: true });
  const wirePath = join(mainDir, "wire.jsonl");
  await writeFile(wirePath, "");
  const queue: AgentHookEventPayloadV3[] = [];
  const reconciler = createKimiTranscriptReconciler({
    sessionsRoots: [root],
    onTerminalEvent: (event) => {
      if (event.kind === "agentEvent" && event.v === 3) queue.push(event);
    },
  });
  const commands = new Map<string, string>();
  for (const block of withPierKimiHooks("").split("[[hooks]]")) {
    const nativeEvent = /^event = (.+)$/m.exec(block)?.[1];
    const command = /^command = (.+)$/m.exec(block)?.[1];
    if (nativeEvent && command)
      commands.set(JSON.parse(nativeEvent), JSON.parse(command));
  }
  const hookProducer = await createInstalledCommandProducer("kimi", commands);

  async function append(rows: readonly Record<string, unknown>[]) {
    await appendFile(
      wirePath,
      `${rows
        .map((row) =>
          JSON.stringify({
            agentId: "main",
            time: Date.now(),
            ...row,
          })
        )
        .join("\n")}\n`
    );
  }

  return {
    async close() {
      reconciler.dispose();
      await hookProducer.close();
      await rm(root, { force: true, recursive: true });
    },
    async run(action: KimiTraceAction) {
      if (action.wireBefore) await append(action.wireBefore);
      if (action.producerKey === "transcript") {
        if (action.payload)
          await append([action.payload as Record<string, unknown>]);
        return waitForTranscriptEvents(queue);
      }
      const rawEvents = await hookProducer.run(action);
      for (const raw of rawEvents) {
        // 和生产入口相同，先解析/enrich 再给提供方对账器观察原生身份。
        const event = enrichAgentEventFromRawPayload(
          agentHookEventSchema.parse(raw)
        );
        if (event.kind === "agentEvent") await reconciler.observe(event);
      }
      return rawEvents;
    },
  };
}
