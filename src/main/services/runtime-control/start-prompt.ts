import { AGENTS_START_ASSEMBLED_MAX_BYTES } from "@shared/contracts/local-control/agents-runtime.ts";
import type { RuntimeControlErr, RuntimeControlStartInput } from "./types.ts";

type AssembledStartPrompt =
  | { ok: false; error: RuntimeControlErr }
  | { ok: true; text: string | undefined };

/**
 * 组装委派 marker + promptText（create 之前做，超限不建面）。
 * text 为 undefined 表示普通 start（无委派 prompt）。
 */
export function assembleStartPrompt(
  input: RuntimeControlStartInput
): AssembledStartPrompt {
  if (input.promptText === undefined) {
    return { ok: true, text: undefined };
  }
  const kind = input.originAgentKind ?? "unknown";
  const panel = input.originPanelId ?? "unknown";
  const marker = `[Delegated by parent ${kind} panel ${panel}]\n\n`;
  const assembled = `${marker}${input.promptText}`;
  if (Buffer.byteLength(assembled, "utf8") > AGENTS_START_ASSEMBLED_MAX_BYTES) {
    return {
      ok: false,
      error: {
        ok: false,
        code: "prompt_too_long",
        message: `assembled agents.start prompt exceeds ${AGENTS_START_ASSEMBLED_MAX_BYTES} bytes`,
      },
    };
  }
  return { ok: true, text: assembled };
}
