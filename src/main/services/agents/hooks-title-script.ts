import { TITLE_SOFT_BREAK_LOOKBACK } from "@shared/agent-session-title/constants.ts";
import {
  MAX_AGENT_SESSION_TITLE_LENGTH,
  MAX_PROMPT_SNIPPET_LENGTH,
} from "@shared/agent-session-title/index.ts";

/**
 * hooks 命令 + 共享运行时世代（只增不减）。
 * 2 = PromptSubmit 命名所需的 prompt → promptSnippet。
 * 3 = 世代标记改为赋值（禁止 `#` 注释，避免 `;` 拼接后整行被注释掉）。
 * 4 = stdin 身份字段补 camelCase（toolUseId / toolName / turnId / agentId /
 *     agentType / transcriptPath）；Grok 等 provider 官方 envelope 为 camelCase。
 * 5 = 全局 hooks 命令去掉 process.execPath 内联 fallback；只引用
 *     `${PIER_AGENT_HOOKS_DIR}/…`。共享运行时迁入 `~/.pier/hooks/vN`，
 *     只允许更高（或相等刷新）世代写入；旧客户端不得降级。
 * 6 = extract/derive 改为 `#!/usr/bin/env node` 纯脚本，运行时不再绑定
 *     Electron 绝对路径（金标准：同 gen 多实例零路径互盖）。
 * 7 = derive 去掉寒暄启发式，只保留 strip + 硬截断；标题上限 40 → 120，
 *     与 shared 侧 deriveAgentSessionTitleFromPrompt 同构。
 * 8 = derive 真正取首行（换行不再被折成空格），且只提取**用户**包装标签内文
 *     （system / assistant 只删标签），与 shared unwrap + firstLine 同构。
 * 9 = 标题长度按 Unicode 码点计算，禁止在代理对中间截断。
 * 10 = 严格 v3 状态事件、交互身份与提供方字段提取链路。
 */
export const PIER_HOOK_COMMAND_GENERATION = 10;

/**
 * derive-claude-session-title：`#!/usr/bin/env node` 纯脚本。
 * stdin JSON → stdout hookSpecificOutput.sessionTitle。
 * 只做 strip + 硬截断，与 shared 侧 deriveAgentSessionTitleFromPrompt 同构：
 * 无寒暄判定、无语义改写，保证 hook 路径与宿主路径给出同一个标题。
 * **不绑定** Electron/process.execPath。
 */
export function buildDeriveClaudeSessionTitleScript(): string {
  const cap = MAX_AGENT_SESSION_TITLE_LENGTH;
  const snippetCap = MAX_PROMPT_SNIPPET_LENGTH;
  const lookback = TITLE_SOFT_BREAK_LOOKBACK;
  return `#!/usr/bin/env node
// pier-hook-gen=${PIER_HOOK_COMMAND_GENERATION}
// Managed by Pier. Do not edit.
"use strict";
const MAX_TITLE = ${cap};
const MAX_SNIPPET = ${snippetCap};
const LOOKBACK = ${lookback};
const SOFT_BREAK = /[\\s，。、；：,.!?;:：]/u;
let s = "";
process.stdin.on("data", (d) => {
  s += d;
});
process.stdin.on("end", () => {
  try {
    const p = JSON.parse(s);
    const raw = [p.prompt, p.user_prompt, p.content, p.message].find(
      (v) => typeof v === "string"
    );
    if (typeof raw !== "string") {
      return;
    }
    let t = Array.from(String(raw))
      .slice(0, MAX_SNIPPET)
      .join("")
      .replace(/\\r\\n/g, "\\n")
      .replace(/\\r/g, "\\n");
    const fenced = /^\\\`\\\`\\\`[\\w-]*\\n([\\s\\S]*?)\\n\\\`\\\`\\\`$/m.exec(t.trim());
    if (fenced && fenced[1] !== undefined) {
      t = fenced[1];
    }
    // 只提取**用户**包装标签的内文；system / assistant 只删标签不提内文。
    const m =
      /<(user_query|user_message|user_prompt|human|query)\\b[^>]*>([\\s\\S]*?)<\\/\\1>/i.exec(
        t
      );
    if (m && m[2].trim()) {
      t = m[2];
    }
    t = t
      .replace(
        /<\\/?(?:user_query|user_message|user_prompt|human|query|system|assistant)\\b[^>]*>/gi,
        " "
      )
      .replace(/\\[Image\\s*#?\\d*\\]/gi, " ")
      .replace(/!\\[[^\\]]*\\]\\([^)]*\\)/g, " ")
      // 行内空白折叠，换行保留 → 随后取首行（与 shared unwrap + firstLine 同构）
      .replace(/[^\\S\\n]+/g, " ");
    t = t
      .split("\\n")
      .map((line) => line.trim())
      .join("\\n")
      .trim();
    t = t.split("\\n").find((line) => line) || "";
    if (!t) {
      return;
    }
    const points = Array.from(t);
    if (points.length > MAX_TITLE) {
      const budget = MAX_TITLE - 1;
      let cutPoints = points.slice(0, budget);
      const minKeep = Math.max(0, budget - LOOKBACK);
      for (let i = cutPoints.length - 1; i >= minKeep; i -= 1) {
        if (cutPoints[i] && SOFT_BREAK.test(cutPoints[i])) {
          cutPoints = cutPoints.slice(0, i);
          break;
        }
      }
      let cut = cutPoints.join("").replace(/\\s+$/, "");
      if (Array.from(cut).length < 2) {
        cut = points.slice(0, budget).join("").replace(/\\s+$/, "");
      }
      t = cut + "…";
    }
    if (!t || t.includes("\\n")) {
      return;
    }
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          sessionTitle: t,
          suppressOutput: true,
        },
      })
    );
  } catch {
    // best-effort
  }
});
`;
}
