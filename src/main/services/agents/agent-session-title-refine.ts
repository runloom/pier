import {
  deriveAgentSessionTitleFromPrompt,
  MAX_AGENT_SESSION_TITLE_LENGTH,
  normalizeAgentSessionTitle,
} from "@shared/agent-session-title.ts";
import type {
  AiGenerateTextRequest,
  AiGenerateTextResult,
} from "@shared/contracts/ai.ts";

export type AgentSessionTitleRefineGenerateText = (
  request: AiGenerateTextRequest
) => Promise<AiGenerateTextResult>;

let refineGenerateText: AgentSessionTitleRefineGenerateText | null = null;

/** app-core 在创建 AiService 后注册；未注册则 refine no-op。 */
export function registerAgentSessionTitleRefineGenerateText(
  fn: AgentSessionTitleRefineGenerateText | null
): void {
  refineGenerateText = fn;
}

const REFINE_TIMEOUT_MS = 8000;

/**
 * 对截断过的 auto 标题做一次轻量 refine（fire-and-forget 友好）。
 * 失败 / 超时 / 无 generateText → null。
 */
export async function refineAgentSessionTitleFromPrompt(
  promptSnippet: string,
  currentTitle: string
): Promise<string | null> {
  const generateText = refineGenerateText;
  if (!generateText) {
    return null;
  }
  if (currentTitle.length < MAX_AGENT_SESSION_TITLE_LENGTH) {
    return null;
  }
  const prompt = [
    "Generate a short session title for this coding agent chat.",
    `Max ${MAX_AGENT_SESSION_TITLE_LENGTH} characters, single line, no quotes.`,
    "Match the user language. Output ONLY the title.",
    "",
    "User message:",
    promptSnippet.slice(0, 400),
  ].join("\n");

  try {
    const result = await Promise.race([
      generateText({ prompt }),
      new Promise<AiGenerateTextResult>((resolve) => {
        setTimeout(
          () =>
            resolve({
              message: "timeout",
              reason: "timeout",
              status: "unavailable",
            }),
          REFINE_TIMEOUT_MS
        );
      }),
    ]);
    if (result.status !== "ok") {
      return null;
    }
    const refined = normalizeAgentSessionTitle(
      result.text.replace(/^["「]|["」]$/g, "").trim()
    );
    if (!refined || refined === currentTitle) {
      return null;
    }
    const baseline = deriveAgentSessionTitleFromPrompt(promptSnippet);
    if (baseline && refined === baseline) {
      return null;
    }
    return refined;
  } catch {
    return null;
  }
}
