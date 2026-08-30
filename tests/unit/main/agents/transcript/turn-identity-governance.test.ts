import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_STATUS_EVIDENCE } from "../../../../../src/main/services/agents/integrations/evidence/matrix.ts";
import { classifyCodexTranscriptLine } from "../../../../../src/main/services/agents/integrations/transcript/codex-reconciler.ts";
import { classifyGrokUpdatesLine } from "../../../../../src/main/services/agents/integrations/transcript/grok-reconciler.ts";

const ROOT = process.cwd();

describe("transcript turn identity governance", () => {
  it("documents the discipline in AGENTS.md", () => {
    const agents = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
    expect(agents).toContain("Transcript 终态对账纪律");
    expect(agents).toContain("prompt_id");
    expect(agents).toContain("turn_id");
    expect(agents).toContain("PromptSubmit 文件水位");
    expect(agents).toContain("evidenceSource=host");
    expect(agents).toContain("turn-identity-governance.test.ts");
  });

  it("requires transcript-reconciler agents to declare turn identity", () => {
    for (const [agentId, evidence] of Object.entries(AGENT_STATUS_EVIDENCE)) {
      if (!evidence.transport.includes("transcript-reconciler")) {
        expect(evidence.transcriptTurnIdentity, agentId).toBeUndefined();
        continue;
      }
      expect(
        evidence.transcriptTurnIdentity === "absent" ||
          evidence.transcriptTurnIdentity === "native-field",
        agentId
      ).toBe(true);
    }
  });

  it("native-field classifiers emit a non-empty turnId", () => {
    const grok = classifyGrokUpdatesLine(
      JSON.stringify({
        method: "_x.ai/session/update",
        params: {
          update: {
            prompt_id: "e3083396-b937-41d1-ad78-4b6c7a1cd65a",
            sessionUpdate: "turn_completed",
            stop_reason: "end_turn",
          },
        },
      })
    );
    expect(grok?.turnId).toBe("e3083396-b937-41d1-ad78-4b6c7a1cd65a");
    expect(
      classifyGrokUpdatesLine(
        JSON.stringify({
          method: "_x.ai/session/update",
          params: {
            update: {
              sessionUpdate: "turn_completed",
              stop_reason: "end_turn",
            },
          },
        })
      )
    ).toBeNull();
    const codex = classifyCodexTranscriptLine(
      JSON.stringify({
        payload: {
          turn_id: "turn-native-1",
          type: "task_complete",
        },
        type: "event_msg",
      })
    );
    expect(codex?.turnId).toBe("turn-native-1");
  });
});
