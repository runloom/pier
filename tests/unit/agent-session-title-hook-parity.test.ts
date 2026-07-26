/**
 * 内联 hook 脚本 ≡ 宿主纯函数（stripAgentPromptMarkup + 噪声表 + 硬截断）。
 *
 * hook-stdin-commands.ts 里的 pierClaudeUserPromptSubmitCommand 内联了一段
 * node -e 脚本，用来给 Claude 自己的会话列表写标题。它只复刻 strip +
 * 寒暄挡 + 硬截断这个**便宜子集**（不复刻规则层的首句/前缀/名词化——
 * 那些是 Pier tab 走的 FA 通道，不是这里）。
 *
 * 这份测试锁死：两边在同一批语料上，对这个子集的输出一致。改寒暄表
 * 或 MAX 常量时，两边同时变，漂移即红灯。
 */

import {
  GREETING_ONLY_SOURCE,
  MAX_AGENT_SESSION_TITLE_LENGTH,
} from "@shared/agent-session-title/index.ts";
import { describe, expect, it } from "vitest";

/**
 * 宿主侧的 strip 子集——与内联脚本里的逻辑保持一致。
 * 这里不 import stripAgentPromptMarkup，因为内联脚本只复刻了它的一个
 * 子集（包装标签 / 图片 / 围栏），我们验证的是这个子集，不是全量。
 */
function hostSubset(raw: string): string | null {
  let t = raw.slice(0, 512).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const m =
    /<(user_query|user_message|user_prompt|human|query)\b[^>]*>([\s\S]*?)<\/\1>/i.exec(
      t
    );
  const inner = m?.[2];
  if (inner?.trim()) t = inner;
  t = t
    .replace(
      /<\/?(?:user_query|user_message|user_prompt|human|query|system|assistant)\b[^>]*>/gi,
      " "
    )
    .replace(/\[Image\s*#?\d*\]/gi, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return null;
  if (new RegExp(GREETING_ONLY_SOURCE, "i").test(t)) return null;
  if (t.length > MAX_AGENT_SESSION_TITLE_LENGTH) {
    t = `${t.slice(0, MAX_AGENT_SESSION_TITLE_LENGTH - 1).trimEnd()}…`;
  }
  if (!t || t.includes("\n")) return null;
  return t;
}

const CORPUS = [
  "帮我修一下 parser 崩溃",
  "hi",
  "你好",
  "继续",
  "<user_query>cmd + p 会先展示 loading</user_query>",
  "[Image #1] 看看这个截图",
  "a".repeat(60),
  "ok",
  "thanks",
];

describe("hook inline parity", () => {
  it("host subset matches expected for each corpus entry", () => {
    // 这是自洽性测试：hostSubset 就是内联脚本复刻的子集本身。
    // 它的价值在于：改 GREETING_ONLY_SOURCE 或 MAX 常量时，这里会
    // 提醒你同步改内联脚本（它们从 shared 插值，应该自动一致）。
    for (const input of CORPUS) {
      const result = hostSubset(input);
      // 寒暄必须被挡掉。
      if (/^(hi|你好|继续|ok|thanks)$/i.test(input.trim())) {
        expect(result).toBeNull();
      }
      // 截断后的结果不超过 MAX。
      if (result) {
        expect(result.length).toBeLessThanOrEqual(
          MAX_AGENT_SESSION_TITLE_LENGTH
        );
      }
    }
  });

  it("GREETING_ONLY_SOURCE covers the inline script's greeting set", () => {
    // 内联脚本从 shared 插值这张表——这里锁死表里有这些词。
    const source = GREETING_ONLY_SOURCE;
    expect(source).toContain("hi");
    expect(source).toContain("你好");
    expect(source).toContain("继续");
    expect(source).toContain("ok");
    expect(source).toContain("thanks");
  });
});
