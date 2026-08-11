/**
 * v7 产品契约：一次性 = 原生 agent；Pier = 发现 + 持久运行控制。
 */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  collectCliDocsAvailableViolations,
  collectCliManualShippedSurfaceText,
  collectInventoryMismatches,
  readCliUserManualData,
} from "../../../tests/unit/cli/cli-docs-surface.ts";
import type { SchemeData } from "./model.ts";
import { parseClosedLoopPhase } from "./phase-schema.ts";

async function readData(): Promise<SchemeData["data"]> {
  const raw = await readFile(new URL("./data.json", import.meta.url), "utf8");
  return (JSON.parse(raw) as SchemeData).data;
}

describe("本机运行控制协议闭环（v7）", () => {
  it("agents 产品命令不含 invoke/self，只保留发现与持久控制", async () => {
    const data = await readData();
    const agents = data.cli.commandGroups.find((row) => row.group === "agents");
    const commands = agents?.commands.split(" · ").map((s) => s.trim()) ?? [];

    expect(commands).toEqual([
      "catalog",
      "list",
      "get",
      "start",
      "turn",
      "screen",
      "wait",
      "watch",
      "focus",
      "interrupt",
      "terminate",
    ]);
    expect(commands).not.toContain("invoke");
    expect(commands).not.toContain("self");
  });

  it("无独立 activity 命令组；事实流归顶层 snapshot/watch", async () => {
    const data = await readData();
    const groups = data.cli.commandGroups.map((row) => row.group);
    expect(groups).not.toContain("activity");
    expect(groups).toContain("顶层");
    const top = data.cli.commandGroups.find((row) => row.group === "顶层");
    expect(top?.commands ?? "").toMatch(/snapshot/u);
    expect(top?.commands ?? "").toMatch(/watch/u);
  });

  it("W2 产品撤回；W0/W1 done；W3 为持久主交付", async () => {
    const data = await readData();
    for (const phase of data.phases) {
      expect(() => parseClosedLoopPhase(phase)).not.toThrow();
    }
    expect(data.phases.find((p) => p.wave === 2)?.status).toBe("cancelled");
    expect(data.phases.find((p) => p.wave === 1)?.status).toBe("done");
    expect(data.phases.find((p) => p.wave === 3)?.name ?? "").toMatch(/持久/u);
  });

  it("pierOwns 不含 one-shot 封装；callerOwns 含原生一次性", async () => {
    const data = await readData();
    expect(data.scope.pierOwns).not.toContain("one-shot-agent-invocation");
    expect(data.scope.callerOwns).toEqual(
      expect.arrayContaining(["one-shot-native-agent-invocation"])
    );
    expect(data.scope.forbiddenInPier.join("\n")).toMatch(
      /不封装|agents invoke|InvocationReply/u
    );
  });

  it("内容契约：screen 有界；无公共历史；无 Pier invoke 产品规则", async () => {
    const data = await readData();
    const rules = data.cli.commonRules.join("\n");
    expect(rules).toMatch(/screen 只返回当前 viewport/u);
    expect(rules).toMatch(/不提供公共 transcript/u);
    expect(rules).toMatch(/产品面禁止 agents invoke|不封装/u);
    expect(rules).not.toMatch(/AgentInvokeService/u);
  });

  it("实现纪律：核心逻辑优先，拒绝业界能力二次封装", async () => {
    const data = await readData();
    const h4 = data.hardConstraints.find((row) => row.id === "H4")?.text ?? "";
    const h12 = data.hardConstraints.find((row) => row.id === "H12")?.text ?? "";
    const rules = data.cli.commonRules.join("\n");
    const nonGoals = data.productNonGoals.join("\n");
    const anti = data.antiPatterns.join("\n");

    expect(h4).toMatch(/核心逻辑优先/u);
    expect(h4).toMatch(/拒绝业界能力二次封装/u);
    expect(h4).toMatch(/去掉 Pier 后用户仍可用原生工具完成同一动作/u);
    expect(h12).toMatch(/产品面禁止 agents invoke/u);
    expect(h12).not.toMatch(/AgentInvokeService 在沙箱/u);
    expect(rules).toMatch(/核心逻辑优先，拒绝业界能力二次封装/u);
    expect(nonGoals).toMatch(/业界已成熟支持的能力|第二套产品 API/u);
    expect(anti).toMatch(/业界已支持的能力再造 Pier 封装/u);
    expect(data.insight).toMatch(/核心逻辑优先/u);
  });

  it("双路径叙事：一次性原生、持久主路径", async () => {
    const data = await readData();
    expect(data.mainLoop.caption).toMatch(/原生 agent/u);
    expect(data.mainLoop.diagram).toMatch(/原生 agent CLI/u);
    expect(data.mainLoop.diagram).not.toMatch(/\binvoke\b/u);
    expect(data.decision).toMatch(/不实现 Pier invoke|不实现.*invoke/u);
    expect(data.bluf).toMatch(/不提供 agents invoke/u);
  });

  it("CLI 命令组状态与波次合法", async () => {
    const data = await readData();
    for (const row of data.cli.commandGroups) {
      expect(["shipped", "partial", "planned"]).toContain(row.status);
      expect(row.wave.length).toBeGreaterThan(0);
    }
    const agents = data.cli.commandGroups.find((row) => row.group === "agents");
    expect(agents?.wave ?? "").toMatch(/W1|W3/u);
  });

  it("pier-cli-user-manual：invoke blocked；shipped 无 invoke", () => {
    const manual = readCliUserManualData();
    expect(collectInventoryMismatches(manual)).toEqual([]);
    const available = collectCliManualShippedSurfaceText(manual);
    expect(collectCliDocsAvailableViolations(available)).toEqual([]);
    expect(available).not.toMatch(/pier\s+agents\s+invoke/u);
    expect(available).toMatch(/agents catalog|agents list/u);
  });

  it("Day 1：原生 one-shot + Pier 发现/持久，不含 pier agents invoke", async () => {
    const data = await readData();
    const cmds = data.day1Commands.map((c) => c.cmd).join("\n");
    expect(cmds).toMatch(/codex exec|原生/u);
    expect(cmds).not.toMatch(/pier agents invoke/u);
    expect(cmds).toMatch(/pier agents catalog/u);
    expect(data.day1Recipe).not.toMatch(/pier agents invoke/u);
    expect(data.day1Recipe).toMatch(/codex exec/u);
  });

  it("无 InvocationReply 实体；协作 UI 不承载一次性回复", async () => {
    const data = await readData();
    const entityNames = (data.entities ?? []).map(
      (e: { name?: string }) => e.name
    );
    expect(entityNames).not.toContain("InvocationReply");
    const ui = JSON.stringify(data.runtimeUi ?? data.collaborationUi ?? {});
    expect(ui).not.toMatch(/InvocationReply/u);
  });

  it("lifecycle 含非 Pier 一次性阶段与持久主阶段", async () => {
    const data = await readData();
    const stages = data.cli.lifecycle.map((s) => s.stage).join("\n");
    expect(stages).toMatch(/一次性.*非 Pier|原生/u);
    expect(stages).toMatch(/持久/u);
    const oneShot = data.cli.lifecycle.find((s) =>
      /一次性/u.test(s.stage)
    );
    expect(oneShot?.commands ?? "").toMatch(/原生 agent/u);
    expect(oneShot?.commands ?? "").not.toMatch(/agents invoke/u);
  });

  it(" Pier 只返回定位引用类规则仍成立", async () => {
    const data = await readData();
    const rules = data.cli.commonRules.join("\n");
    expect(rules).toMatch(/文件\/Git 由调用者自身工具读取|本地工具读取/u);
    expect(rules).toMatch(/screen 只返回当前 viewport/u);
    const groups = data.cli.commandGroups.map((g) => g.group);
    expect(groups).not.toContain("files");
    expect(groups).not.toContain("git");
  });

  it("journeys/safetyRails/principals/errors 无 Pier invoke 产品叙事", async () => {
    const data = await readData();
    const journeys = JSON.stringify(data.journeys);
    const rails = data.safetyRails.join("\n");
    const principals = JSON.stringify(data.cli.principals);
    const errors = JSON.stringify(data.cli.errors);
    const j2 = data.journeys.find((j) => j.id === "J2");
    const j5 = data.journeys.find((j) => j.id === "J5");

    expect(j2?.name ?? "").toMatch(/原生/u);
    expect(j2?.system ?? "").toMatch(/原生 agent CLI|进程外/u);
    expect(j2?.system ?? "").not.toMatch(/agent-invoke capability|隔离只读沙箱/u);
    expect(j5?.system ?? "").not.toMatch(/agent-invoke/u);
    expect(j5?.userSees ?? "").not.toMatch(/InvocationReply/u);

    // 肯定产品路径（非「禁止/不提供」语境）
    expect(journeys).not.toMatch(
      /invoke 校验目标|精确 agent-invoke|再 invoke\/start|调用 invoke 时/u
    );
    expect(rails).toMatch(/拒绝业界能力二次封装|不提供 agents invoke/u);
    expect(rails).not.toMatch(
      /agent-invoke scope|running invoke|invoke 的 observation_timeout|invoke\/start\/turn/u
    );
    expect(principals).not.toMatch(
      /调用 invoke 还须|agents invoke 必须|agents invoke 另需/u
    );
    expect(errors).not.toMatch(
      /一次性调用观察|一次性调用执行|InvocationReply\.(interrupted|error)/u
    );
  });

  it("持久会话内容 comparison 与 thesis 对齐 v7", async () => {
    const data = await readData();
    const persistent = data.comparison.find(
      (row) => row.dimension === "持久会话内容"
    );
    expect(persistent?.pierDecision ?? "").toMatch(
      /screen|viewport|WorktreeRef|transcript/u
    );
    expect(persistent?.pierDecision ?? "").not.toMatch(
      /一次性直接使用原生 agent CLI/u
    );
    expect(data.problem.thesis).toMatch(/持久|RuntimeRef|发现/u);
    expect(data.problem.thesis).not.toMatch(
      /没有直接返回本次回复的一次性调用/u
    );
  });

  it("W4/W6 与 acceptance 不回退 invoke 产品", async () => {
    const data = await readData();
    const w4 = data.phases.find((p) => p.wave === 4);
    const w6 = data.phases.find((p) => p.wave === 6);
    expect(w4?.outcome ?? "").not.toMatch(/snapshot\/watch\/activity/u);
    expect(JSON.stringify(w4?.slices ?? [])).not.toMatch(
      /activity 便利流/u
    );
    expect(JSON.stringify(w6?.slices ?? [])).not.toMatch(
      /agent-invoke scope|self→invoke|self->invoke/u
    );
    const e5 = data.acceptance.find((a) => a.id === "E5");
    const e8 = data.acceptance.find((a) => a.id === "E8");
    const e14 = data.acceptance.find((a) => a.id === "E14");
    const e15 = data.acceptance.find((a) => a.id === "E15");
    expect(e5?.text ?? "").not.toMatch(/running invoke/u);
    expect(e8?.text ?? "").not.toMatch(/^invoke\//u);
    expect(e14?.evidence ?? "").not.toMatch(
      /observation_timeout attach|execution deadline 终态/u
    );
    expect(e15?.evidence ?? "").not.toMatch(/agent-invoke scope/u);
  });
});
