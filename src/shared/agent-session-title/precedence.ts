/**
 * 标题写入裁决：秩比较，唯一实现。
 *
 * placeholder(0) < provider(1) < user(2)
 *
 * 写入当且仅当秩严格升高，或来源是 user（用户可反复改名）。
 * 同秩不覆盖——provider 每回合重算 ai-title 不会让标题抖动。
 */

import type { AgentSessionTitleSource } from "../contracts/foreground-activity.ts";
import { normalizeAgentSessionTitle } from "./normalize.ts";

const SOURCE_RANK: Record<AgentSessionTitleSource, number> = {
  provider: 1,
  user: 2,
};

export function agentSessionTitleRank(
  source: AgentSessionTitleSource | null | undefined
): number {
  return source ? SOURCE_RANK[source] : 0;
}

/**
 * 读取期归一。仅保留 provider / user。
 * 历史 `prompt` / `auto` / `rule` / `model` → undefined（整段标题视为无效）。
 */
export function normalizeAgentSessionTitleSource(
  raw: unknown
): AgentSessionTitleSource | undefined {
  if (raw === "user" || raw === "provider") {
    return raw;
  }
  // 明确丢弃的旧源（勿映射成仍可展示的值）
  if (raw === "prompt" || raw === "auto" || raw === "rule" || raw === "model") {
    return;
  }
  return;
}

export type AgentSessionTitleWriteDecision =
  | { apply: false }
  | { apply: true; title: string; source: AgentSessionTitleSource };

export function decideAgentSessionTitleWrite(input: {
  nextTitle: string;
  nextSource: AgentSessionTitleSource;
  currentTitle?: string | null;
  currentSource?: AgentSessionTitleSource | null;
}): AgentSessionTitleWriteDecision {
  const title = normalizeAgentSessionTitle(input.nextTitle);
  if (!title) {
    return { apply: false };
  }
  if (!input.currentTitle?.trim()) {
    return { apply: true, source: input.nextSource, title };
  }
  if (input.nextSource === "user") {
    return { apply: true, source: "user", title };
  }
  // 无合法来源的历史标题按空槽秩处理，允许 provider/user 写入。
  const currentRank = agentSessionTitleRank(input.currentSource);
  if (agentSessionTitleRank(input.nextSource) > currentRank) {
    return { apply: true, source: input.nextSource, title };
  }
  return { apply: false };
}
