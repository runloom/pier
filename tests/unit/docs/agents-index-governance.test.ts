import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

/** Only decreases. Bump requires shrinking AGENTS.md first. */
const MAX_AGENTS_MD_LINES = 567;

/**
 * §03 H3 that are architecture / process hard constraints and do not
 * have a standalone gold-standard spec. Adding a new member needs a
 * spec pointer instead, unless it is truly a process boundary.
 */
const ARCHITECTURE_WITHOUT_SPEC = new Set([
  "### 插件边界是纪律边界，不是安全边界",
  "### 交互控件密度规范",
  "### 设置页状态提示布局",
  "### 路径锚点上下文 `src/main/services/panel-context-resolver.ts` + `src/shared/contracts/panel.ts`",
  "### LSP Gateway `src/main/services/lsp/session-broker.ts`",
  "### 终端 scrollback `0108-live-scrollback-limit`",
  "### 终端 PTY 写入 UTF-8 边界 `0111-utf8-safe-pty-write-chunk`",
  "### 账号域模块迁移：`src/main/services/agent-accounts/` → `pier.codex`",
  "### Managed 官方外部插件模块 `src/main/services/managed-plugins/`",
  "### 项目设置贡献点 `projectSettings`",
  "### 插件数据投影与 Canvas 动作",
]);

function agentsMd(): string {
  return readFileSync(join(ROOT, "AGENTS.md"), "utf8");
}

function lineCount(text: string): number {
  const lines = text.split("\n");
  if (lines.at(-1) === "") {
    return lines.length - 1;
  }
  return lines.length;
}

function section03H3(text: string): Array<{ heading: string; body: string }> {
  const lines = text.split("\n");
  const result: Array<{ heading: string; body: string }> = [];
  let in03 = false;
  let current: string | undefined;
  let body: string[] = [];
  const flush = (): void => {
    if (current) {
      result.push({ heading: current, body: body.join("\n") });
    }
  };
  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (in03) {
        flush();
        current = undefined;
        body = [];
      }
      in03 = line.startsWith("## 03 ");
      continue;
    }
    if (in03 && line.startsWith("### ")) {
      flush();
      current = line;
      body = [];
      continue;
    }
    if (in03 && current) {
      body.push(line);
    }
  }
  flush();
  return result;
}

describe("AGENTS.md is an index, not a rulebook", () => {
  it("does not grow past the line-count ratchet", () => {
    const count = lineCount(agentsMd());
    expect(count).toBeLessThanOrEqual(MAX_AGENTS_MD_LINES);
  });

  it("keeps §03 surface sections on a spec pointer or the architecture allowlist", () => {
    const sections = section03H3(agentsMd());
    expect(sections.length).toBeGreaterThan(10);
    const offenders: string[] = [];
    for (const section of sections) {
      const hasSpec = section.body.includes("权威规格");
      const allowed = ARCHITECTURE_WITHOUT_SPEC.has(section.heading);
      if (!(hasSpec || allowed)) {
        offenders.push(section.heading);
      }
      if (hasSpec && allowed) {
        offenders.push(
          `${section.heading} (allowlist stale; has spec pointer)`
        );
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the delivery-discipline method as a top-level section", () => {
    expect(agentsMd()).toContain(
      "## 06 设计稿与 UI 交付纪律（编码助手硬约定）"
    );
  });
});
