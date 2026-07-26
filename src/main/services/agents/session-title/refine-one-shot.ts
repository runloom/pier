/**
 * T2 模型精修：跑该面板**正在用的那个 agent** 的标题专用一次性调用。
 *
 * 不做 agent 排序 / 探测 / 冷却——面板里跑着的 agent 已经证明它装好了、
 * 登录了、能用。这是比通用 AiService 的 rank+fallback 更准也更省的选择。
 */

import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { getAgentCatalogEntry } from "@shared/agent-catalog.ts";
import { splitShellCommandWords } from "@shared/agent-command-detection.ts";
import {
  MAX_AGENT_SESSION_TITLE_LENGTH,
  MAX_REFINE_CHANGED_FILES,
  MAX_REFINE_PROMPT_CHARS,
  normalizeAgentSessionTitle,
  stripAgentPromptMarkup,
  TARGET_AUTO_TITLE_LENGTH,
} from "@shared/agent-session-title/index.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import { resolveAgentCommand } from "../agent-launch.ts";
import { agentSessionTitleDeps, type TitleGitSignals } from "./refine-port.ts";

/** 与 CLI 冷启动量级对齐。8 秒赢不了冷启动，只会静默超时。 */
export const TITLE_REFINE_TIMEOUT_MS = 30_000;

const MAX_STDOUT_BYTES = 256 * 1024;
const TITLE_TAG = /<title>([\s\S]*?)<\/title>/i;

export type RefineFailure = "unavailable" | "timeout" | "empty";

export type RefineOutcome =
  | { status: "ok"; title: string }
  | { status: "failed"; reason: RefineFailure };

function buildPrompt(input: {
  promptSnippet: string;
  signals: TitleGitSignals;
}): string {
  const files = input.signals.changedFiles
    .slice(0, MAX_REFINE_CHANGED_FILES)
    .join(", ");
  const lines = [
    "Write a short title for this coding session.",
    "Output the title inside <title></title> tags and nothing else.",
    "",
    "Rules:",
    "- A noun phrase naming the work. Not a sentence, not a question.",
    "- No trailing punctuation, no quotes, no markdown.",
    `- Target ${TARGET_AUTO_TITLE_LENGTH} characters, hard maximum ${MAX_AGENT_SESSION_TITLE_LENGTH}.`,
    "- Use the same language as the user's message.",
    "",
    "Examples:",
    "<title>Markdown 大纲布局重构</title>",
    "<title>Terminal resize flicker fix</title>",
    "",
    "User's first message:",
    input.promptSnippet.slice(0, MAX_REFINE_PROMPT_CHARS),
  ];
  if (files) {
    lines.push("", "Files changed in the first turn:", files);
  }
  return lines.join("\n");
}

/**
 * 三级提取。只要「输出纯标题」的契约——现状那样直接 trim 整段——CLI 随口加
 * 一句前言就会因为换行检查被判非法，白跑一次调用。
 */
export function extractRefinedTitle(raw: string): string | null {
  const tagged = TITLE_TAG.exec(raw)?.[1];
  const candidate =
    tagged?.trim() ||
    raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1) ||
    raw;
  const cleaned = stripAgentPromptMarkup(candidate)
    .replace(/^["'「『]|["'」』]$/g, "")
    .trim();
  return normalizeAgentSessionTitle(cleaned);
}

function runTitleCommand(
  binary: string,
  args: readonly string[],
  signal: AbortSignal
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      binary,
      [...args],
      {
        cwd: tmpdir(),
        env: process.env,
        maxBuffer: MAX_STDOUT_BYTES,
        signal,
      },
      (err, stdout) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(stdout);
      }
    );
    // 标题 prompt 全部走 argv；不关 stdin 的话 codex 系会等 EOF。
    child.stdin?.end();
  });
}

/** 无 titleArgs / 无依赖 / 无命令 → null（调用方降级为纯规则）。 */
async function resolveTitleInvocation(
  agentId: AgentKind,
  prompt: string
): Promise<{ binary: string; args: readonly string[] } | null> {
  const titleArgs = getAgentCatalogEntry(agentId)?.titleArgs;
  const deps = agentSessionTitleDeps();
  if (!(titleArgs && deps)) {
    return null;
  }
  const override = await deps.readAgentCommandOverride(agentId);
  const command = resolveAgentCommand({
    agentDefaultArgs: {},
    agentId,
    ...(override ? { override } : {}),
  });
  if (!command) {
    return null;
  }
  const words = splitShellCommandWords(command, 32);
  const binary = words[0];
  if (!binary) {
    return null;
  }
  return { args: [...words.slice(1), ...titleArgs(prompt)], binary };
}

export async function refineAgentSessionTitle(input: {
  agentId: AgentKind;
  promptSnippet: string;
  signals: TitleGitSignals;
}): Promise<RefineOutcome> {
  const invocation = await resolveTitleInvocation(
    input.agentId,
    buildPrompt(input)
  );
  if (!invocation) {
    return { reason: "unavailable", status: "failed" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TITLE_REFINE_TIMEOUT_MS);
  try {
    const stdout = await runTitleCommand(
      invocation.binary,
      invocation.args,
      controller.signal
    );
    const title = extractRefinedTitle(stdout);
    return title
      ? { status: "ok", title }
      : { reason: "empty", status: "failed" };
  } catch {
    // abort 会 SIGTERM 掉子进程——不像 Promise.race，不会留下跑满
    // 45/75 秒的孤儿进程。
    return {
      reason: controller.signal.aborted ? "timeout" : "unavailable",
      status: "failed",
    };
  } finally {
    clearTimeout(timer);
  }
}
