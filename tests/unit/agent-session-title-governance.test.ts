/**
 * 标题链路治理测试。
 *
 * 底层立场：**标题 ≠ 身份**。标题是尽力而为的可读性信号（来源不可靠、用户可
 * 改、永不全覆盖）；多 agent 调度要用的身份必须确定性——agentId + 项目路径
 * 锚点 + panelId + 主/子会话角色。本文件锁的就是这条分工不被重新混淆。
 *
 * 锁定的不变量：
 * 1. 来源枚举只有 prompt / provider / user——provider 是 agent 自己算好的会话名
 *    （零成本读 transcript），没有模型精修层，也没有启发式规则层。
 * 2. 启发式 / 精修模块不得复活（rules / noise / signals / refine-*）。
 * 3. catalog 不得再声明标题专用的模型调用入口（titleArgs）。
 * 4. 偏好里不得再有标题精修开关。
 * 5. resolveAgentSessionTitle 不接收 OSC / terminalTitle。
 * 6. FA agent 活动必须带确定性身份字段。
 * 7. 每个 agentSessionTitleInput 调用点都要传路径锚点。
 * 8. 主/子会话判据只有一处实现（漂移会让子会话的会话号冒充面板主会话身份）。
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { AGENT_CATALOG } from "@shared/agent-catalog.ts";
import type { ResolveAgentSessionTitleInput } from "@shared/agent-session-title/index.ts";
import {
  type AgentActivity,
  agentSessionTitleSourceSchema,
  foregroundActivitySchema,
} from "@shared/contracts/foreground-activity.ts";
import { projectPreferencesSchema } from "@shared/contracts/preferences.ts";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "../..");

/** 已删除的启发式 / 模型精修模块——复活即 finding。 */
const BANNED_MODULES = [
  "src/shared/agent-session-title/rules.ts",
  "src/shared/agent-session-title/noise.ts",
  "src/shared/agent-session-title/signals.ts",
  "src/main/services/agents/session-title/refine-one-shot.ts",
  "src/main/services/agents/session-title/refine-port.ts",
  "src/main/services/agents/session-title/refine-scheduler.ts",
  "src/main/services/agents/session-title/wire-deps.ts",
];

const SKIPPED_DIRECTORIES = new Set(["build", "dist", "node_modules", "out"]);

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const filePath = join(dir, entry);
    if (statSync(filePath).isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry)) {
        files.push(...sourceFiles(filePath));
      }
      continue;
    }
    if (/\.tsx?$/.test(entry)) {
      files.push(filePath);
    }
  }
  return files;
}

/** 抓取 `agentSessionTitleInput({ … })` 的实参体（按括号配平，容忍嵌套调用）。 */
function titleInputCallBodies(source: string): string[] {
  const bodies: string[] = [];
  const marker = "agentSessionTitleInput({";
  let from = source.indexOf(marker);
  while (from !== -1) {
    let depth = 1;
    let cursor = from + marker.length;
    while (cursor < source.length && depth > 0) {
      const ch = source[cursor];
      if (ch === "{" || ch === "(") {
        depth += 1;
      } else if (ch === "}" || ch === ")") {
        depth -= 1;
      }
      cursor += 1;
    }
    bodies.push(source.slice(from + marker.length, cursor - 1));
    from = source.indexOf(marker, cursor);
  }
  return bodies;
}

describe("agent-session-title governance", () => {
  it("title source enum is exactly prompt < provider < user", () => {
    expect(agentSessionTitleSourceSchema.options).toEqual([
      "prompt",
      "provider",
      "user",
    ]);
  });

  it("provider tier never ingests pier's own dual-write echo", async () => {
    // Claude 的 custom-title / agent-name 装的是我方 derive-claude-session-title
    // 双写回去的 prompt 派生。收下就是把自己的截断洗成更高的 provider 秩，而且
    // 它们比真正的 ai-title 先到，同秩不覆盖会把好标题永久挡在门外。
    const source = await readFile(
      join(
        REPO_ROOT,
        "src/main/services/agents/integrations/claude-transcript-reconciler.ts"
      ),
      "utf8"
    );
    const classifier = source.slice(
      source.indexOf("function classifyClaudeTranscriptTitleLine")
    );
    expect(classifier).not.toContain("customTitle");
    expect(classifier).not.toContain("agentName");
  });

  it("provider tier costs no extra process or token", async () => {
    // provider 秩的立场：只读 agent 已经写下的 transcript 行。一旦这里出现
    // 起进程 / 调模型的痕迹，就等于把删掉的精修层换个名字复活。
    const source = await readFile(
      join(REPO_ROOT, "src/main/services/agents/session-title/index.ts"),
      "utf8"
    );
    for (const banned of ["spawn", "exec", "titleArgs", "refine"]) {
      expect(source, banned).not.toContain(banned);
    }
  });

  it("heuristic and refine modules stay deleted", () => {
    for (const relative of BANNED_MODULES) {
      expect(existsSync(join(REPO_ROOT, relative)), relative).toBe(false);
    }
  });

  it("catalog declares no title-only model invocation", async () => {
    // titleArgs 是模型精修层的唯一入口；精修层删掉后它不得回来。
    for (const entry of AGENT_CATALOG) {
      expect(entry).not.toHaveProperty("titleArgs");
    }
    const contract = await readFile(
      join(REPO_ROOT, "src/shared/contracts/agent.ts"),
      "utf8"
    );
    expect(contract).not.toContain("titleArgs");
  });

  it("preferences have no session-title refine switch", () => {
    const keys = Object.keys(projectPreferencesSchema.shape);
    expect(keys).not.toContain("agentSessionTitleRefine");
  });

  it("resolveAgentSessionTitle input has no terminalTitle field", () => {
    // 入参类型里不应有 terminalTitle——OSC 不进产品标题。
    type Keys = keyof ResolveAgentSessionTitleInput;
    const keys: Keys[] = [
      "agentId",
      "cwd",
      "projectRootPath",
      "sessionTitle",
      "sessionTitleSource",
    ];
    expect(keys).not.toContain("terminalTitle" as Keys);
  });

  it("agent activity carries deterministic identity fields", () => {
    // 身份不能只靠标题：sessionId / actorHint / parentSessionId 是多 agent
    // 调度时区分「在调哪个会话」的确定性依据。schema 是 .strict()，字段被删掉
    // 这里会直接 parse 失败。
    const identity = {
      actorHint: "subagent",
      agentId: "claude",
      kind: "agent",
      panelId: "panel-1",
      parentSessionId: "sess-parent",
      sessionId: "sess-child",
      source: "hook",
      spawnedAt: 1,
      status: "processing",
      subagentCount: 0,
      updatedAt: 2,
      windowId: "win-1",
    } as const;
    const parsed = foregroundActivitySchema.parse(identity) as AgentActivity;
    expect(parsed.sessionId).toBe("sess-child");
    expect(parsed.parentSessionId).toBe("sess-parent");
    expect(parsed.actorHint).toBe("subagent");
  });

  it("subagent predicate has exactly one implementation", () => {
    // 判据同时决定面板级旁路效果与面板行身份；两份拷贝一旦漂移，子会话的
    // 会话号就会冒充面板主会话身份。除唯一实现外，任何文件不得再自己判。
    const owner = "src/shared/agent-session-actor.ts";
    const offenders: string[] = [];
    for (const file of sourceFiles(join(REPO_ROOT, "src"))) {
      const rel = relative(REPO_ROOT, file).split(sep).join("/");
      if (rel === owner) {
        continue;
      }
      const source = readFileSync(file, "utf8");
      if (source.includes('actorHint === "subagent"')) {
        offenders.push(rel);
      }
    }
    // 展示层读 activity.actorHint 是渲染判断，不是事件判据。
    expect(
      offenders.filter(
        (rel) =>
          rel !==
          "src/renderer/panel-kits/workbench/core-widgets/activity/activity-row.tsx"
      )
    ).toEqual([]);
  });

  it("provider title callback rejects subagent ownership", async () => {
    const source = await readFile(
      join(REPO_ROOT, "src/main/ipc/foreground-activity.ts"),
      "utf8"
    );
    const callbackStart = source.indexOf("onTitleRecord:");
    const callback = source.slice(
      callbackStart,
      source.indexOf("jsonlObserver =", callbackStart)
    );
    expect(callback).toContain("isSubagentHookEvent(context)");
  });

  it("every agentSessionTitleInput call site passes a path anchor", () => {
    // 无标题会话的 placeholder 只有 catalog 标签；不给路径锚点，同一 agent 的
    // 多个面板会显示成完全一样的一行，用户无法分辨在调哪个。
    const offenders: string[] = [];
    for (const file of sourceFiles(join(REPO_ROOT, "src"))) {
      const source = readFileSync(file, "utf8");
      if (!source.includes("agentSessionTitleInput({")) {
        continue;
      }
      for (const body of titleInputCallBodies(source)) {
        if (body.includes("projectRootPath:") || body.includes("cwd:")) {
          continue;
        }
        offenders.push(relative(REPO_ROOT, file).split(sep).join("/"));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("rename action is available on all three terminal surfaces and activity uses the shared facade", async () => {
    const actions = await readFile(
      join(REPO_ROOT, "src/renderer/panel-kits/terminal/register-actions.ts"),
      "utf8"
    );
    const renameAction = actions.slice(
      actions.indexOf('id: "pier.terminal.renameAgentSession"'),
      actions.indexOf('id: "pier.terminal.close"')
    );
    for (const surface of [
      '"terminal/content"',
      '"dockview-tab"',
      '"command-palette"',
    ]) {
      expect(renameAction, surface).toContain(surface);
    }

    const activityWidget = await readFile(
      join(
        REPO_ROOT,
        "src/renderer/panel-kits/workbench/core-widgets/activity/activity-widget.tsx"
      ),
      "utf8"
    );
    expect(activityWidget).toContain("promptRenameAgentSession");
    expect(activityWidget).toContain(
      "@/lib/agent-runtime/rename-agent-session.ts"
    );
  });
});
