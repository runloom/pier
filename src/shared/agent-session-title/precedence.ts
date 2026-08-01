/**
 * 标题写入裁决：秩比较，唯一实现。
 *
 * placeholder(0) < prompt(1) < provider(2) < user(3)
 *
 * 写入当且仅当秩严格升高，或来源是 user（用户可反复改名）。这条规则同时
 * 保证了：自动标题不覆盖用户改名、每个自动层只在首次生效——provider 自己
 * 反复重算标题（Claude 每回合都会重写 `ai-title`）不会让标题一直抖动，
 * 也不需要额外的 replaceAuto 开关。
 */

import type { AgentSessionTitleSource } from "../contracts/foreground-activity.ts";
import { normalizeAgentSessionTitle } from "./normalize.ts";

const SOURCE_RANK: Record<AgentSessionTitleSource, number> = {
  prompt: 1,
  provider: 2,
  user: 3,
};

export function agentSessionTitleRank(
  source: AgentSessionTitleSource | null | undefined
): number {
  return source ? SOURCE_RANK[source] : 0;
}

/**
 * 历史值归一：v1 只有 `auto`，v2 有 `rule` / `model`。三者今天都等价
 * `prompt`（自动来源，可被用户改名覆盖）。读取期映射，永不写回。
 * 有标题但无来源的历史条目按最低非零秩处理，好让用户改名能覆盖它。
 */
export function normalizeAgentSessionTitleSource(
  raw: unknown
): AgentSessionTitleSource | undefined {
  if (raw === "user" || raw === "provider" || raw === "prompt") {
    return raw;
  }
  if (raw === "auto" || raw === "rule" || raw === "model") {
    return "prompt";
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
  // 有标题但缺来源的历史条目按 prompt 秩处理。
  const currentRank = agentSessionTitleRank(input.currentSource ?? "prompt");
  if (agentSessionTitleRank(input.nextSource) > currentRank) {
    return { apply: true, source: input.nextSource, title };
  }
  return { apply: false };
}
