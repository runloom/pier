/**
 * 安装脚本 derive-claude-session-title ≡ 宿主 strip 子集。
 *
 * Claude UserPromptSubmit 标题派生落在 userData
 * `derive-claude-session-title`（agent-hooks-install 启动时装），
 * hooks 命令只经 `${PIER_AGENT_HOOKS_DIR}/…` 调用。脚本只复刻 strip +
 * 寒暄挡 + 硬截断这个**便宜子集**（不复刻规则层的首句/前缀/名词化——
 * 那些是 Pier tab 走的 FA 通道，不是这里）。
 *
 * 这份测试锁死：两边在同一批语料上，对这个子集的输出一致。改寒暄表
 * 或 MAX 常量时，两边同时变，漂移即红灯。
 */

import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GREETING_ONLY_SOURCE,
  MAX_AGENT_SESSION_TITLE_LENGTH,
} from "@shared/agent-session-title/index.ts";
import { afterEach, describe, expect, it } from "vitest";
import {
  deriveClaudeSessionTitleScriptPath,
  installAgentHooksEmitScript,
} from "../../src/main/services/agents/agent-hooks-install.ts";

/**
 * 宿主侧的 strip 子集——与 derive-claude-session-title 里的逻辑保持一致。
 * 这里不 import stripAgentPromptMarkup，因为脚本只复刻了它的一个
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

function scriptSessionTitle(scriptPath: string, prompt: string): string | null {
  // 直接执行（#!/usr/bin/env node），与 hooks 调用方式一致
  const r = spawnSync(scriptPath, [], {
    input: JSON.stringify({ prompt }),
    encoding: "utf8",
  });
  expect(r.status).toBe(0);
  const out = r.stdout.trim();
  if (!out) {
    return null;
  }
  const body = JSON.parse(out) as {
    hookSpecificOutput?: { sessionTitle?: string };
  };
  return body.hookSpecificOutput?.sessionTitle ?? null;
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
  let baseDir: string | null = null;

  afterEach(async () => {
    if (baseDir) {
      await rm(baseDir, { force: true, recursive: true });
      baseDir = null;
    }
  });

  it("host subset matches expected for each corpus entry", () => {
    for (const input of CORPUS) {
      const result = hostSubset(input);
      if (/^(hi|你好|继续|ok|thanks)$/i.test(input.trim())) {
        expect(result).toBeNull();
      }
      if (result) {
        expect(result.length).toBeLessThanOrEqual(
          MAX_AGENT_SESSION_TITLE_LENGTH
        );
      }
    }
  });

  it("installed derive-claude-session-title matches hostSubset on CORPUS", async () => {
    const { mkdtemp } = await import("node:fs/promises");
    baseDir = await mkdtemp(join(tmpdir(), "pier-title-parity-"));
    const userData = join(baseDir, "userData");
    const hooksHome = join(baseDir, "hooks");
    await installAgentHooksEmitScript(userData, { hooksHome });
    const script = deriveClaudeSessionTitleScriptPath(hooksHome);
    for (const input of CORPUS) {
      expect(scriptSessionTitle(script, input)).toBe(hostSubset(input));
    }
  });

  it("GREETING_ONLY_SOURCE covers the inline script's greeting set", () => {
    const source = GREETING_ONLY_SOURCE;
    expect(source).toContain("hi");
    expect(source).toContain("你好");
    expect(source).toContain("继续");
    expect(source).toContain("ok");
    expect(source).toContain("thanks");
  });
});
