import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectCliDocsAvailableViolations,
  collectCliManualShippedSurfaceText,
  collectInventoryMismatches,
  readCliUserManualData,
} from "../../../tests/unit/cli/cli-docs-surface.ts";
import type { SchemeData } from "./model.ts";

async function readData(): Promise<SchemeData["data"]> {
  const raw = await readFile(new URL("./data.json", import.meta.url), "utf8");
  return (JSON.parse(raw) as SchemeData).data;
}

describe("本机运行控制协议闭环", () => {
  it("agents 提供智能体优先的完整调用命令集", async () => {
    const data = await readData();
    const agents = data.cli.commandGroups.find((row) => row.group === "agents");
    const commands = agents?.commands.split(" · ") ?? [];

    expect(commands).toEqual(
      expect.arrayContaining([
        "self",
        "catalog",
        "list",
        "get",
        "invoke",
        "start",
        "turn",
        "screen",
        "wait",
        "watch",
        "focus",
        "interrupt",
        "terminate",
      ]),
    );
  });

  it("CLI 命令组标注现状与交付波次，W0 以 pier-cli-user-manual 为命令面真源", async () => {
    const data = await readData();
    const w0 = data.phases.find((row) => row.wave === 0);
    const agents = data.cli.commandGroups.find((row) => row.group === "agents");
    const windows = data.cli.commandGroups.find((row) => row.group === "windows");

    expect(w0?.name ?? "").toMatch(/文档|边界/u);
    expect(w0?.outcome ?? "").toMatch(/pier-cli-user-manual|Canvas/u);
    expect(["planned", "in_progress", "done"]).toContain(w0?.status);
    expect(
      w0?.slices.some((s) => /pier-cli-user-manual|Canvas/u.test(s.title))
    ).toBe(true);

    for (const row of data.cli.commandGroups) {
      expect(["shipped", "partial", "planned"]).toContain(row.status);
      expect(row.wave.length).toBeGreaterThan(0);
    }
    expect(["partial", "planned"]).toContain(agents?.status);
    expect(agents?.wave ?? "").toMatch(/W1|W2|W3/u);
    expect(windows?.status).toBe("partial");
    expect(data.cli.decision).toMatch(/pier-cli-user-manual|Canvas/u);
  });

  it("pier-cli-user-manual 与 unit 共用 shipped/planned 清单门禁", () => {
    const manual = readCliUserManualData();
    expect(manual.meta.status).toMatch(/使用手册/u);
    expect(JSON.stringify(manual)).not.toMatch(/交付波次|W0–W6|W0-W6/u);

    expect(collectInventoryMismatches(manual)).toEqual([]);

    const available = collectCliManualShippedSurfaceText(manual);
    expect(collectCliDocsAvailableViolations(available)).toEqual([]);
    expect(available).toMatch(/agents catalog|agents list/u);
  });

  it("方案 A 只返回本次结构化回复或当前 viewport，不开放公共运行历史", async () => {
    const data = await readData();
    const rules = data.cli.commonRules.join("\n");

    expect(rules).toContain("invoke 只返回本次调用的结构化回复");
    expect(rules).toContain("InvocationReply.responded 不等于任务成功");
    expect(rules).toContain("screen 只返回当前 viewport");
    expect(rules).toContain("文件/Git 由调用者自身工具读取");
    expect(rules).toContain("不提供公共 transcript");
    expect(rules).toContain("不提供 scrollback/history/replay");
  });

  it("协调智能体、工作智能体、人类 CLI 与外部控制器都是调用主体", async () => {
    const data = await readData();
    const principals = data.cli.principals.map((row) => row.principal);

    expect(principals).toEqual(
      expect.arrayContaining(["协调智能体", "普通工作智能体", "人类 CLI", "外部控制器"]),
    );
  });

  it("智能体调用凭证由宿主按当前 boot 注入，不能自报、泄漏或传给子智能体", async () => {
    const data = await readData();
    const rules = data.cli.commonRules.join("\n");

    expect(rules).toContain("AgentCallerCredential");
    expect(rules).toContain("当前 boot 有效");
    expect(rules).toContain("不得通过 --as-agent、panelId、当前焦点或可伪造环境变量自报身份");
    expect(rules).toContain("不打印秘密");
    expect(rules).toContain("不传给子智能体");
  });

  it("智能体、外部控制器与宿主写入统一落在 principalRef 与同一回执管线", async () => {
    const data = await readData();
    const rules = data.cli.commonRules.join("\n");

    expect(rules).toContain("principalRef");
    expect(rules).toMatch(/agent:(?:<[^>]+>:)*<credentialId>/u);
    expect(rules).toMatch(/external:<clientKeyHash>[^\s，。]*/u);
    expect(rules).toMatch(/(?:human|host):<[^>]+>/u);
    expect(rules).toMatch(/所有主体先按各自证据鉴权|先按 principal 类型鉴权/u);
    expect(rules).toContain("principalRef + operation");
    expect(rules).toMatch(/AgentCallerCredential.*(?:临时 grant|child CapabilityRef)/u);
  });

  it("一次性回复按调用者命名空间精确重放，执行期限属于请求摘要", async () => {
    const data = await readData();
    const entities = new Map(data.entities.map((row) => [row.name, row]));
    const rules = data.cli.commonRules.join("\n");

    expect(entities.get("InvocationReply")?.identity).toBe(
      "bootId + principalRef + operationId",
    );
    expect(rules).toMatch(/invokeDeadline.*maxOutputBytes.*进入.*摘要/u);
    expect(rules).toMatch(/observation wait timeout.*(?:排除|不进入)/u);
    expect(rules).toMatch(/同一(?:份)?有界、不可枚举 InvocationReply/u);
    expect(rules).toMatch(/无法证明.*返回 effect_unknown/u);
  });

  it("v1 invoke 固定为可证明的只读建议模式，写文件必须转持久子运行", async () => {
    const data = await readData();
    const agents = data.cli.commandGroups.find((row) => row.group === "agents");
    const rules = data.cli.commonRules.join("\n");
    const e3 = data.acceptance.find((row) => row.id === "E3");

    expect(agents?.safety).toContain("advisory-read-only");
    expect(rules).toMatch(/invoke.*固定.*advisory-read-only/u);
    expect(rules).toContain("无 --write");
    expect(rules).toMatch(/可信 AgentInvokeService.*provider adapter.*工具沙箱之外/u);
    expect(rules).toMatch(/选定 provider endpoint.*窄 egress/u);
    expect(rules).toMatch(/工具子进程.*精确 WorktreeRef.*Git admin.*只读/u);
    expect(rules).toMatch(/不挂载 userData.*Pier socket.*(?:credential|凭证).*密钥/u);
    expect(rules).toMatch(/provider-native adapter.*无法隔离.*catalog.*provider_unavailable/u);
    expect(rules).toMatch(/provider_unavailable.*start/u);
    expect(e3?.evidence).toMatch(/写文件.*拒绝/u);
  });

  it("智能体根凭证来自不持久化的 bootstrap grant，子能力同时包含精确读写操作", async () => {
    const data = await readData();
    const rules = data.cli.commonRules.join("\n");

    expect(rules).toContain("agent-bootstrap grant");
    expect(rules).toContain("不写 userData");
    expect(rules).toContain("grantId + parentClauseId + credentialId");
    expect(rules).toMatch(/退出|换代/u);
    expect(rules).toContain("级联失效");
    expect(rules).toMatch(/get.*screen.*wait.*watch.*focus/u);
    expect(rules).toMatch(/turn.*interrupt.*terminate/u);
  });

  it("所有 grant 与 CapabilityRef 只有一个授权权威和线性化点", async () => {
    const data = await readData();
    const ownership = new Map(data.ownership.map((row) => [row.layer, row]));
    const rules = data.cli.commonRules.join("\n");
    const architecture = [data.architecture.diagram, ...data.architecture.notes].join("\n");

    expect(ownership.get("本机控制授权")?.owner).toBe("Pier main AccessGrantService");
    expect(ownership.get("本机控制授权")?.owns ?? "").toMatch(
      /bootstrap.*child.*external.*CapabilityRef/u,
    );
    expect(ownership.get("智能体调用身份")?.owns ?? "").not.toMatch(
      /(?:mint|签发|创建).*(?:grant|CapabilityRef)/iu,
    );
    expect(rules).toContain("CapabilityAuthority");
    expect(rules).toMatch(/唯一.*mint\/revoke\/authorize.*线性化点/u);
    expect(architecture).toMatch(/AccessGrantService.*CapabilityAuthority/us);
  });

  it("advisory-read-only 只在隔离沙箱内开放查询能力", async () => {
    const data = await readData();
    const rules = data.cli.commonRules.join("\n");
    const e3 = data.acceptance.find((row) => row.id === "E3");

    expect(rules).toMatch(/只读文件.*搜索.*Git 查询/u);
    expect(rules).toMatch(/AgentInvokeService.*provider adapter.*auth.*工具沙箱之外/u);
    expect(rules).toMatch(/选定 provider endpoint.*窄 egress/u);
    expect(rules).toMatch(/精确 WorktreeRef.*repo.*Git admin.*只读/u);
    expect(rules).toMatch(/不挂载 userData/u);
    expect(rules).not.toMatch(/userData.*(?:只读|read-only).*挂载/u);
    expect(rules).toMatch(/临时目录.*隔离.*销毁/u);
    expect(rules).toMatch(/工具子进程.*(?:禁止|没有).*任意网络.*外部连接器/u);
    expect(rules).toMatch(/Pier socket.*credential.*密钥.*持久副作用/u);
    expect(rules).toMatch(/模型传输.*工具网络.*无法隔离.*provider_unavailable/u);
    expect(e3?.evidence ?? "").toMatch(/repo.*userData.*socket.*auth.*network/u);
  });

  it("调用凭证实体由授权权威拥有，AgentCallerService 只保留绑定语义", async () => {
    const data = await readData();
    const credential = data.entities.find((row) => row.name === "AgentCallerCredential");
    const binding = data.ownership.find((row) => row.layer === "智能体调用身份");

    expect(credential?.owner).toBe("AccessGrantService/CapabilityAuthority");
    expect(binding?.owns ?? "").toContain("AgentCallerBinding");
    expect(binding?.owns ?? "").not.toMatch(/签发|mint|revoke|authorize/u);
  });

  it("人类与外部控制器 invoke 需要精确 agent-invoke scope", async () => {
    const data = await readData();
    const rules = data.cli.commonRules.join("\n");
    const human = data.cli.principals.find((row) => row.principal === "人类 CLI");
    const external = data.cli.principals.find((row) => row.principal === "外部控制器");

    expect(rules).toContain("agent-invoke");
    expect(rules).toMatch(
      /agent-invoke.*WorktreeRef.*allowedAgents.*agents\.invoke.*deadline.*output cap.*TTL/u,
    );
    expect(human?.scope ?? "").toContain("agent-invoke");
    expect(human?.scope ?? "").toMatch(/宿主.*确认/u);
    expect(external?.scope ?? "").toContain("agent-invoke");
    expect(external?.scope ?? "").toMatch(/Ed25519.*grant/u);
  });

  it("invoke 分离执行期限与观察等待，附着不能延长首次期限", async () => {
    const data = await readData();
    const invoke = data.day1Commands[1]?.cmd ?? "";
    const rules = data.cli.commonRules.join("\n");

    expect(invoke).toContain("--execution-deadline");
    expect(invoke).toContain("--wait-timeout");
    expect(invoke).not.toMatch(/(?:^|\s)--timeout(?:\s|$)/u);
    expect(rules).toMatch(/--execution-deadline.*--wait-timeout/u);
    expect(rules).toMatch(/首次.*execution deadline.*(?:不重置|不能延长)/u);
    expect(rules).toMatch(/attach|附着/u);
  });

  it("一次性调用与持久子运行共享原子活跃预算", async () => {
    const data = await readData();
    const rules = data.cli.commonRules.join("\n");

    expect(rules).toMatch(/running invoke.*starting\/running child runtime/u);
    expect(rules).toContain("共享");
    expect(rules).toContain("maxActiveChildren");
    expect(rules).toMatch(/原子.*reservation/u);
    expect(rules).toMatch(/attach.*replay.*不重复/u);
    expect(rules).toMatch(/reap.*释放/u);
  });

  it("协作台只展示持久运行内容，不全局留存一次性回复", async () => {
    const data = await readData();
    const ui = JSON.stringify(data.runtimeUi);

    expect(ui).not.toMatch(/一次性|invoke|InvocationReply|本次回复|reply/iu);
    expect(data.runtimeUi.sessions.every((row) => row.runtime.includes("运行实例"))).toBe(true);
    expect(data.runtimeUi.facts.map((row) => row.fact).join("\n")).toMatch(
      /当前可见画面|工作树文件与 Git 变化/u,
    );
  });

  it("AgentCallerCredential 文件在 Unix 与 Windows 都按私有临时文件管理", async () => {
    const data = await readData();
    const identity = data.cli.transport.find((row) => row.part === "智能体调用身份")?.rule ?? "";

    expect(identity).toMatch(/Unix.*0700.*0600/u);
    expect(identity).toMatch(/no-follow|O_NOFOLLOW/u);
    expect(identity).toMatch(/原子创建/u);
    expect(identity).toMatch(/退出.*删除/u);
    expect(identity).toMatch(/Windows.*owner-only DACL/u);
  });

  it("行业对照不把不同产品的能力混写成同一套调用面", async () => {
    const data = await readData();
    const comparisons = new Map(data.comparison.map((row) => [row.dimension, row]));
    const orca = data.researchSources.find((row) => row.name === "Orca");
    const ao = data.researchSources.find((row) => row.name === "Agent Orchestrator");

    expect(data.insight).toMatch(/Orca.*spawn\/send\/read\/wait/u);
    expect(data.insight).toMatch(/Agent Orchestrator.*spawn\/send\/session/u);
    expect(data.insight).not.toMatch(/Orca 与 Agent Orchestrator.*spawn\/send\/read/u);
    expect(orca?.positioning ?? "").toMatch(/持久.*Dispatch.*(?:provider transcript|终端)/u);
    expect(comparisons.get("一次性内容")?.orca ?? "").toMatch(/无同构.*one-shot invoke/u);
    expect(ao?.reject ?? "").toMatch(/session\/conversation\/issue\/PR/u);
    expect(ao?.reject ?? "").not.toMatch(/通用 Task|worker_done/u);
    expect(comparisons.get("工作结束判断")?.agentOrchestrator ?? "").toMatch(
      /协调智能体|人类/u,
    );
  });

  it("Orca 身份证据与机器可读能力发现分开表述", async () => {
    const data = await readData();
    const identity = data.comparison.find((row) => row.dimension === "调用者身份")?.orca ?? "";
    const orca = data.researchSources.find((row) => row.name === "Orca");

    expect(identity).toMatch(/当前终端.*terminal handle.*pane key.*generation/u);
    expect(identity).not.toContain("agent-context");
    expect(orca?.adopt ?? "").toMatch(/agent-context.*机器可读能力发现/u);
  });

  it("Pier 将普通终端当前画面列为 native 主路径新增能力", async () => {
    const data = await readData();
    const content = data.currentState.find((row) => row.area === "持久内容读取");

    expect(content?.available ?? "").toMatch(/NativeAddon.*selection/u);
    expect(content?.available ?? "").toMatch(/TerminalAPI\.readSession.*元数据/u);
    expect(content?.available ?? "").not.toMatch(/当前画面.*已有/u);
    expect(content?.missing ?? "").toMatch(/screen.*native 主路径/u);
  });

  it("cmux 只提供可选滚屏的画面读取，Pier 采用更窄的当前画面边界", async () => {
    const data = await readData();
    const row = data.comparison.find((item) => item.dimension === "持久会话内容");

    expect(row?.cmux ?? "").toMatch(/默认.*viewport.*--scrollback.*--lines/u);
    expect(row?.pierDecision ?? "").toMatch(/只采用当前画面/u);
  });

  it("三项调研证据都锚定固定 revision 的具体文件和行号", async () => {
    const data = await readData();

    for (const source of data.researchSources) {
      expect(source.evidence).toContain(`/blob/${source.revision}/`);
      expect(source.evidence.match(/#[Ll]\d+-L\d+/gu)?.length ?? 0).toBeGreaterThanOrEqual(2);
      expect(source.evidence).not.toContain("同 revision");
    }
  });

  it("进行中的 invoke 只能附着同一操作，取消必须确认 provider 已停止", async () => {
    const data = await readData();
    const rules = data.cli.commonRules.join("\n");
    const errors = data.cli.errors.flatMap((row) => row.codes.split(" · "));

    expect(rules).toMatch(/execution deadline.*observation timeout.*断线/u);
    expect(rules).toContain("effect_in_progress");
    expect(rules).toMatch(/附着同一 operation|等待同一 operation/u);
    expect(rules).toMatch(/确认 provider.*停止.*interrupted/u);
    expect(rules).toMatch(/无法证明.*effect_unknown/u);
    expect(rules).toMatch(/不得留下.*孤儿/u);
    expect(errors).toContain("effect_in_progress");
  });

  it("默认只控制父调用者自己新建的精确子运行，递归预算只能收缩", async () => {
    const data = await readData();
    const rules = data.cli.commonRules.join("\n");

    expect(rules).toContain("默认只允许父调用者控制自己新建的精确子运行");
    expect(rules).toContain("跨同伴读取、递归调用和提高并发预算必须显式授权");
    expect(rules).toContain("递归深度和并发预算只能单调收缩");
  });

  it("agents 写命令把 effect fence cursor 交给后续观察", async () => {
    const data = await readData();
    const agents = data.cli.commandGroups.find((row) => row.group === "agents");

    expect(agents?.safety).toContain(
      "agents invoke/start/turn/interrupt/terminate 的回执返回 effectRevision 与 cursor",
    );
  });

  it("Day 1 用四步覆盖协调智能体 self、invoke 与持久会话内容读取", async () => {
    const data = await readData();
    const commands = data.day1Commands.map((row) => row.cmd);
    const titles = data.day1Commands.map((row) => row.title);

    expect(data.day1Commands).toHaveLength(4);
    expect(titles.every((title) => title.trim().length > 0)).toBe(true);
    expect(commands[0]).toContain("pier agents self");
    expect(commands[1]).toContain("pier agents invoke");
    expect(commands[2]).toContain("pier agents start");
    expect(commands[3]).toContain("pier agents turn");
    expect(commands[3]).toMatch(/--include-screen|pier agents screen/u);
    expect(commands.join("\n")).toMatch(/--file|--stdin/u);
    expect(commands.join("\n")).not.toContain("--as-agent");
    expect(commands.join("\n")).not.toMatch(/pier access (keygen|request|revoke)/u);
  });

  it("Day 1 短命令与完整配方共享同一调用状态默认路径", async () => {
    const data = await readData();
    const defaultPath = "${PIER_AGENT_CALLER_CREDENTIAL_FILE}.call-state/state.json";
    const firstCmd = data.day1Commands[0]?.cmd ?? "";

    expect(firstCmd).toContain(defaultPath);
    expect(data.day1Recipe).toContain(defaultPath);
    // 禁止旧的同级 .call-state.json 默认（与专用 0700 目录契约冲突）
    expect(firstCmd).not.toMatch(/\.call-state\.json(?!["/])/u);
  });

  it("外部控制器作为进阶路径使用签名 transcript 绑定唯一 challenge、客户端类型与规范编码", async () => {
    const data = await readData();
    const rules = data.cli.commonRules.join("\n");
    const externalController = data.cli.principals.find(
      (row) => row.principal === "外部控制器",
    );

    expect(rules).toContain("challengeId,purpose,clientKind");
    expect(rules).toContain("base64url 无填充");
    expect(rules).toContain("request-grant");
    expect(rules).toContain("use-grant");
    expect(rules).toContain("验证尝试即消费");
    expect(externalController, "外部控制器必须保留为进阶调用主体").toBeDefined();
    expect(externalController?.scope ?? "").toContain("Ed25519");
  });

  it("先校验授权再查回执，且旧 boot 与被淘汰回执不能执行副作用", async () => {
    const data = await readData();
    const rules = data.cli.commonRules.join("\n");
    const errors = data.cli.errors.flatMap((row) => row.codes.split(" · "));

    expect(rules).toContain("revoke 与 admission 共用同一线性化点");
    expect(rules).toContain("禁止 LRU/TTL 提前遗忘");
    expect(rules).toContain("expectedBootId");
    expect(errors).toEqual(
      expect.arrayContaining([
        "boot_changed",
        "effect_window_full",
        "effect_window_expired",
        "effect_unknown",
        "idempotency_conflict",
      ]),
    );
  });

  it("授权请求先耐久记录，保留期后只会重新确认而不会沿用旧结果", async () => {
    const data = await readData();
    const rules = data.cli.commonRules.join("\n");
    const errors = data.cli.errors.flatMap((row) => row.codes.split(" · "));

    expect(rules).toContain("进入确认队列前先原子耐久提交最小恢复记录");
    expect(rules).toContain("崩溃恢复把遗留 pending 原子转为 unavailable");
    expect(rules).toContain("retentionUntil");
    expect(rules).toContain("同 key 无记录时按新请求处理并重新进入宿主确认");
    expect(rules).not.toContain("保留期后旧 key 只返回 access_request_unknown");
    expect(errors).not.toContain("access_request_unknown");
  });

  it("顶层 watch 承担全局序列，资源 cursor 不得跨命名空间", async () => {
    const data = await readData();
    const top = data.cli.commandGroups.find((row) => row.group === "顶层");
    const terminal = data.cli.commandGroups.find((row) => row.group === "terminal");
    const rules = data.cli.commonRules.join("\n");

    expect(top?.commands).toContain("watch");
    expect(terminal?.commands).toContain("watch");
    expect(rules).toContain("cursorScope=global");
    expect(rules).toContain("cursorScope=resource:<name>");
    expect(rules).toContain("不得交给其他资源命名空间");
    expect(data.cli.streamEnvelope).toContain('"agents"');
    expect(data.cli.streamEnvelope).toContain('"runtimes"');
    expect(data.cli.streamEnvelope).toContain('"worktrees"');
    expect(data.cli.streamEnvelope).toContain('"notifications"');
  });

  it("精确引用与派生能力都有 boot fence、来源条款和最小操作集", async () => {
    const data = await readData();
    const entities = new Map(data.entities.map((row) => [row.name, row]));
    const rules = data.cli.commonRules.join("\n");

    expect(entities.get("RuntimeRef")?.identity).toBe("bootId + runtimeId + generation");
    expect(entities.get("TaskRunRef")?.identity).toBe("bootId + runId");
    expect(entities.get("CapabilityRef")?.identity).toContain("parentClauseId");
    expect(rules).toContain("runtime.control-created");
    expect(rules).toContain("worktree.remove-created");
    expect(rules).toContain("task-run.control-created");
    expect(rules).toContain("不得跨同一 grant 的项目条款借权");
  });

  it("既有工作树注册不派生删除权，删除与运行准入在线性化点互斥", async () => {
    const data = await readData();
    const rules = data.cli.commonRules.join("\n");
    const worktrees = data.cli.commandGroups.find((row) => row.group === "worktrees");

    expect(rules).toContain("marker 是唯一权威，不写 userData 索引");
    expect(rules).toContain("Git admin 父目录");
    expect(rules).toContain("register 必须使用独立 worktree-register scope");
    expect(rules).toContain("绝不派生 remove 能力");
    expect(rules).toContain("同一 WorktreeRef 线性化锁");
    expect(rules).toContain("pending、running、stopping");
    expect(rules).toContain("tasks run/rerun");
    expect(rules).toContain("v1/human/renderer");
    expect(worktrees?.safety).toContain("任一非终态 TaskRun");
  });

  it("能力引用与操作标识在实体、线协议和授权规则中完全一致", async () => {
    const data = await readData();
    const capability = data.entities.find((row) => row.name === "CapabilityRef");
    const rules = data.cli.commonRules.join("\n");

    expect(capability?.identity).toBe("grantId + parentClauseId + childClauseId");
    expect(data.cli.jsonEnvelope).toContain('"childClauseId"');
    expect(data.cli.jsonEnvelope).not.toMatch(/"clauseId"/u);
    expect(rules).toContain("worktrees.remove");
  });

  it("JSON 示例只表示一次 invoke，并在 meta 返回 effect fence", async () => {
    const data = await readData();

    expect(data.cli.jsonEnvelope).toContain('"invocationReply"');
    expect(data.cli.jsonEnvelope).toContain('"effectRevision"');
    expect(data.cli.jsonEnvelope).toContain('"cursor"');
    expect(data.cli.jsonEnvelope).not.toContain('"callerRef"');
    expect(data.cli.jsonEnvelope).not.toContain('"delegatedCapabilityRef"');
  });

  it("传输准入按三类 principal 证据分支，同 UID 只构成工程纪律边界", async () => {
    const data = await readData();
    const admission = data.cli.transport.find((row) => row.part === "副作用准入")?.rule ?? "";
    const constraints = data.hardConstraints.map((row) => row.text).join("\n");

    expect(admission).toContain("AgentCallerCredential");
    expect(admission).toContain("external Ed25519 grant");
    expect(admission).toContain("human consent");
    expect(admission).toContain("principalRef");
    expect(constraints).toMatch(/所有本机 principal.*同一系统用户.*工程纪律/u);
    expect(constraints).toMatch(/恶意.*进程.*OS 主体隔离/u);
  });

  it("Day 1 配方以协调智能体的 ambient caller credential 走两条内容路径", async () => {
    const data = await readData();
    const recipe = data.day1Recipe;

    expect(recipe).toMatch(/^#!\/usr\/bin\/env bash\n/u);
    expect(recipe).toContain("set -uo pipefail");
    expect(recipe).not.toContain("set -e");
    expect(recipe).toMatch(/ambient caller credential|环境调用凭证/u);
    expect(recipe).toContain("pier agents self");
    expect(recipe).toContain("pier agents invoke");
    expect(recipe).toContain("pier agents start");
    expect(recipe).toContain("TURN=$(pier agents turn");
    expect(recipe).toMatch(/--include-screen|pier agents screen/u);
    expect(recipe).toContain("effectRevision");
    expect(recipe).toContain("cursor");
    expect(recipe).toMatch(/--file|--stdin/u);
    expect(recipe).not.toContain("pier access keygen");
    expect(recipe).not.toContain("pier access request");
    expect(recipe).not.toContain("pier access revoke");
    expect(recipe).not.toContain("--as-agent");
    expect(recipe).toContain('printf \'%s\\n\' "$TURN"');
    expect(recipe).toContain("effectRevision");
  });

  it("Day 1 在调用方私有状态文件保存键与摘要，并可安全重附着 invoke", async () => {
    const data = await readData();
    const recipe = data.day1Recipe;

    expect(recipe).not.toContain("set -e");
    expect(recipe).toContain("PIER_AGENT_CALL_STATE_FILE");
    expect(recipe).toMatch(/0700.*0600/su);
    expect(recipe).toMatch(/BOOT_ID.*OPERATION_ID.*LAUNCH_KEY.*INPUT_ID/su);
    expect(recipe).toMatch(/QUESTION_DIGEST.*TASK_DIGEST.*FOLLOWUP_DIGEST/su);
    expect(recipe).toMatch(/canonical.*digest|规范.*摘要/iu);
    expect(recipe).toMatch(/observation_timeout.*effect_in_progress.*transport_closed/su);
    expect(recipe).toMatch(/同一.*key.*digest|same.*key.*digest/iu);
    expect(recipe).toMatch(/boot_changed.*snapshot/su);
    expect(recipe.lastIndexOf('rm -f "$CALL_STATE_FILE"')).toBeGreaterThan(
      recipe.lastIndexOf("git -C"),
    );
  });

  it("观察超时保持 invoke 运行并返回可重附着身份，执行期限终止后禁止附着", async () => {
    const data = await readData();
    const rules = data.cli.commonRules.join("\n");
    const recipe = data.day1Recipe;
    const observation = data.cli.errors.find((row) =>
      row.codes.split(" · ").includes("observation_timeout"),
    );
    const e14 = data.acceptance.find((row) => row.id === "E14");

    expect(observation?.exit).toContain("124");
    expect(observation?.next).toMatch(/operation.*running|仍在运行/iu);
    expect(rules).toMatch(
      /observation_timeout.*operationId.*effectRevision.*(?:attach|重附着)/u,
    );
    expect(rules).toMatch(
      /execution_deadline_exceeded.*(?:interrupted|error).*(?:禁止|不得).*attach/u,
    );
    expect(recipe).toMatch(/observation_timeout[\s\S]*同一 key \+ digest.*重附着/u);
    expect(recipe).toMatch(
      /execution_deadline_exceeded\|provider_interrupted\|provider_error[\s\S]*(?:fail|停止)/u,
    );
    expect(e14?.text).toMatch(/observation_timeout.*仍在运行.*execution deadline.*不得重附着/u);
  });

  it("Day 1 状态由调用方专用私有目录和全程独占锁保护，发布不可覆盖且已落盘", async () => {
    const data = await readData();
    const rules = data.cli.commonRules.join("\n");
    const recipe = data.day1Recipe;
    const e14 = data.acceptance.find((row) => row.id === "E14");

    expect(recipe).not.toContain('mkdir -p "$STATE_DIR"');
    expect(recipe).not.toContain('chmod 0700 "$STATE_DIR"');
    expect(recipe).not.toContain('mv -f "$STATE_TMP" "$CALL_STATE_FILE"');
    expect(recipe).toMatch(/mkdir -m 0700.*STATE_DIR/u);
    expect(recipe).toMatch(/当前 owner|CURRENT_UID|id -u/u);
    expect(recipe).toMatch(/0700.*STATE_DIR|STATE_DIR.*0700/su);
    expect(recipe).toMatch(/符号链接|symlink/u);
    expect(recipe).toMatch(/lockf|flock|O_EXCL/u);
    expect(recipe).toMatch(/trap.*(?:release|LOCK_FD|8>&-)/u);
    expect(recipe).toMatch(/set -C|noclobber|O_EXCL/u);
    expect(recipe).toMatch(/mv -n|RENAME_NOREPLACE|renamex_np/u);
    expect(recipe).toMatch(/fsync.*状态文件.*父目录|fsyncSync/su);
    expect(recipe.indexOf("fsync")).toBeLessThan(recipe.indexOf("run_invoke"));
    expect(rules).toMatch(/双进程.*一套.*key|并发.*同一套.*键/u);
    expect(rules).toMatch(/crash-before.*crash-after|崩溃前.*崩溃后/u);
    expect(e14?.evidence).toMatch(/双进程竞争.*crash-before.*crash-after/u);
  });

  it("Day 1 实际展开默认状态路径，并在 macOS 用 lockf FD 排除第二调用者后恢复", async () => {
    const data = await readData();
    const recipe = data.day1Recipe;
    const root = await mkdtemp(join(tmpdir(), "pier-day1-probe-"));
    const credential = join(root, "caller.credential");
    const bin = join(root, "bin");
    const mockPier = join(bin, "pier");

    expect(recipe).not.toContain("\\${");

    try {
      await mkdir(bin, { mode: 0o700 });
      await writeFile(credential, "opaque\n", { mode: 0o600 });
      await writeFile(join(root, "question.md"), "question\n");
      await writeFile(join(root, "task.md"), "task\n");
      await writeFile(join(root, "followup.md"), "follow-up\n");
      await writeFile(
        mockPier,
        '#!/usr/bin/env bash\nprintf \'{"ok":true}\\n\'\n',
        { mode: 0o700 },
      );
      await chmod(mockPier, 0o700);

      const cut = recipe.indexOf("BOOT_ID=$(printf");
      expect(cut).toBeGreaterThan(0);
      const probe = `${recipe.slice(0, cut)}printf 'STATE=%s SELF=%s\\n' "$CALL_STATE_FILE" "$SELF"\n`;
      const env = {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        PIER_AGENT_CALLER_CREDENTIAL_FILE: credential,
      };
      delete env.PIER_AGENT_CALL_STATE_FILE;

      const expanded = spawnSync("/bin/bash", ["-c", probe], {
        cwd: root,
        encoding: "utf8",
        env,
      });
      expect(expanded.status, expanded.stderr).toBe(0);
      expect(expanded.stdout).toContain(`${credential}.call-state/state.json`);
      expect(expanded.stdout).toContain('SELF={"ok":true}');

      if (process.platform === "darwin") {
        const lockPath = join(root, "fd-smoke.lock");
        const holder = spawn(
          "/bin/bash",
          [
            "-c",
            'exec 8<> "$1"; lockf -s -t 0 8 || exit 75; printf locked; sleep 0.5',
            "bash",
            lockPath,
          ],
          { stdio: ["ignore", "pipe", "pipe"] },
        );
        await once(holder.stdout, "data");

        const contender = spawnSync(
          "/bin/bash",
          ["-c", 'exec 8<> "$1"; lockf -s -t 0 8', "bash", lockPath],
          { encoding: "utf8" },
        );
        expect(contender.status).not.toBe(0);

        const [holderCode] = (await once(holder, "close")) as [number];
        expect(holderCode).toBe(0);

        const recovered = spawnSync(
          "/bin/bash",
          ["-c", 'exec 8<> "$1"; lockf -s -t 0 8', "bash", lockPath],
          { encoding: "utf8" },
        );
        expect(recovered.status, recovered.stderr).toBe(0);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("Pier 只返回工作树定位引用，文件与 Git 内容由调用方本地工具读取", async () => {
    const data = await readData();
    const rules = data.cli.commonRules.join("\n");
    const groups = data.cli.commandGroups.map((row) => row.group);
    const loop = data.closedLoops.find((row) => row.id === "L4");
    const journey = data.journeys.find((row) => row.id === "J3");
    const phase = data.phases.find((row) => row.wave === 4);
    const e9 = data.acceptance.find((row) => row.id === "E9");

    expect(data.scope.pierOwns).not.toEqual(expect.arrayContaining(["files", "git"]));
    expect(groups).not.toEqual(expect.arrayContaining(["files", "git"]));
    expect(rules).toMatch(/CLI.*只返回 canonicalPath.*完整 WorktreeRef/u);
    expect(rules).toMatch(/调用方.*自身.*文件\/Git 工具.*读取/u);
    expect(rules).toMatch(/path containment.*调用方工具.*现有 Files UI/u);
    expect(rules).toMatch(/同一系统用户.*不是安全隔离/u);
    expect(loop?.steps ?? "").toMatch(/调用方本地工具/u);
    expect(journey?.system ?? "").toMatch(/调用方自身.*文件\/Git 工具/u);
    expect(phase?.outcome ?? "").toMatch(/定位.*WorktreeRef.*调用方本地/u);
    expect(e9?.text ?? "").toMatch(/CLI.*不返回文件.*Git 内容/u);
  });

  it("invoke 使用完整 WorktreeRef，settled 只等待本次 effect fence 之后的运行事实", async () => {
    const data = await readData();
    const invoke = data.day1Commands[1]?.cmd ?? "";
    const rules = data.cli.commonRules.join("\n");

    expect(invoke).toContain('--worktree-key "$WT_KEY"');
    expect(invoke).toContain('--incarnation-id "$WT_INCARNATION"');
    expect(rules).toContain("--wait settled");
    expect(rules).toMatch(/本次 (?:turn|input).*effect fence/u);
    expect(rules).toContain("waiting|ready|error|exited");
    expect(rules).toMatch(/不是任务终态|不表示工作结论/u);
  });

  it("Day 1 的 self 输出调用者身份和权限摘要，但不输出调用凭证秘密", async () => {
    const data = await readData();
    const firstStep = data.day1Commands[0];

    expect(firstStep?.why).toContain("调用者身份");
    expect(firstStep?.userSees).toContain("权限摘要");
    expect(firstStep?.userSees).toContain("不显示调用凭证秘密");
  });

  it("智能体协作原型展示协调者、工作智能体和可读取的内容产物", async () => {
    const data = await readData();
    const prototype = [
      data.runtimeUi.workspace.title,
      data.runtimeUi.workspace.meta,
      data.runtimeUi.workspace.status,
      data.runtimeUi.contentBoundary,
      ...data.runtimeUi.sessions.flatMap((row) => [row.name, row.summary, row.worktree]),
      ...Object.values(data.runtimeUi.selected),
    ].join("\n");

    expect(data.runtimeUi.workspace.title).toContain("智能体协作");
    expect(data.runtimeUi.contentBoundary.length).toBeGreaterThan(12);
    expect(prototype).toContain("协调智能体");
    expect(prototype).toContain("工作智能体");
    expect(prototype).toMatch(/当前画面|viewport/u);
    expect(prototype).toContain("工作树");
    expect(prototype).not.toMatch(/一次性|本次回复/u);
    expect(prototype).not.toMatch(/\b(?:responded|viewport|turn|screen)\b/iu);
  });
});
