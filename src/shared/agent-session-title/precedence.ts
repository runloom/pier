/**
 * 标题写入裁决：秩比较，唯一实现。
 *
 * placeholder(0) < rule(1) < model(2) < user(3)
 *
 * 写入当且仅当秩严格升高，或来源是 user（用户可反复改名）。这条规则同时
 * 保证了：auto 不覆盖 user、模型层每会话只落一次、规则层只在首条 prompt
 * 生效——不需要额外的 replaceAuto 开关。
 */

import type { AgentSessionTitleSource } from "../contracts/foreground-activity.ts";
import { normalizeAgentSessionTitle } from "./normalize.ts";

const SOURCE_RANK: Record<AgentSessionTitleSource, number> = {
  rule: 1,
  model: 2,
  user: 3,
};

export function agentSessionTitleRank(
  source: AgentSessionTitleSource | null | undefined
): number {
  return source ? SOURCE_RANK[source] : 0;
}

/**
 * 历史值归一：v1 只有 `auto`（等价今天的 rule）。读取期映射，永不写回。
 * 有标题但无来源的历史条目按最低非零秩处理，好让 model / user 能改进它。
 */
export function normalizeAgentSessionTitleSource(
  raw: unknown
): AgentSessionTitleSource | undefined {
  if (raw === "user" || raw === "model" || raw === "rule") {
    return raw;
  }
  if (raw === "auto") {
    return "rule";
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
  // 有标题但缺来源的历史条目按 rule 秩处理。
  const currentRank = agentSessionTitleRank(input.currentSource ?? "rule");
  if (agentSessionTitleRank(input.nextSource) > currentRank) {
    return { apply: true, source: input.nextSource, title };
  }
  return { apply: false };
}
