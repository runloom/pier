import { copilotIntegration } from "@main/services/agents/integrations/copilot.ts";
import { qodercliIntegration } from "@main/services/agents/integrations/qodercli.ts";
import { traceAction } from "../nested-hook-traces.ts";
import type { AgentStatusTraceFixture } from "../status-trace-types.ts";
import {
  createTranscriptReconcilerProducer,
  jsonl,
  transcriptAction,
} from "../transcript-reconciler-driver.ts";

// 原生格式与版本证据见各适配器及 tests/unit/main/agents/{copilot,qodercli}。
// 这里只用提供方已经支持的取消记录，不把模型一条回复结束当作整个回合完成。
export const INTERRUPT_RECONCILER_TRACES: readonly AgentStatusTraceFixture[] = [
  {
    agentId: "copilot",
    covers: ["processing", "interrupted"],
    createProducer: () => createTranscriptReconcilerProducer("copilot"),
    stopAuthority: copilotIntegration.runtime.stopAuthority,
    actions: [
      traceAction(
        "userPromptSubmitted",
        "PromptSubmit",
        "processing",
        {
          expectedStatus: "processing",
        },
        { sessionId: "copilot-session-1", prompt: "Inspect" },
        true
      ),
      transcriptAction(
        "copilot.events.abort.user_initiated",
        jsonl({
          type: "abort",
          data: { reason: "user_initiated" },
        }),
        [
          {
            dimension: "interrupted",
            expectedEvent: "TurnInterrupted",
            expectedNativeEvent: "copilot.events.abort.user_initiated",
            expectedStatus: "ready",
            expectedEventFields: { sessionId: "copilot-session-1" },
          },
        ],
        ["interrupted"]
      ),
    ],
  },
  {
    agentId: "qodercli",
    covers: ["processing", "ready", "interrupted"],
    createProducer: () => createTranscriptReconcilerProducer("qodercli"),
    stopAuthority: qodercliIntegration.runtime.stopAuthority,
    actions: [
      traceAction("UserPromptSubmit", "PromptSubmit", "processing", {
        expectedStatus: "processing",
      }),
      transcriptAction(
        "qoder.transcript.user_interrupt",
        jsonl({
          type: "user",
          message: { content: "[Request interrupted by user]" },
        }),
        (["ready", "interrupted"] as const).map((dimension) => ({
          dimension,
          expectedEvent: "TurnInterrupted",
          expectedNativeEvent: "qoder.transcript.user_interrupt",
          expectedStatus: "ready",
          expectedEventFields: { sessionId: "session-1" },
        })),
        ["interrupted"]
      ),
    ],
  },
];
