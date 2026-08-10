import { parseClosedLoopPhases, type ClosedLoopPhase } from "./phase-schema.ts";
import {
  validatePierArchitectureContract,
  validatePierScopeContract,
} from "./scope-contract.ts";

type TextRow<K extends string> = { [P in K]: string };

type Meta = TextRow<
  "title" | "subtitle" | "status" | "version" | "researchCutoff" | "codeBaseline"
>;
type Measure = TextRow<"metric" | "target" | "proof">;
type Pain = TextRow<"id" | "title" | "detail" | "consequence">;
type CurrentState = TextRow<"area" | "owner" | "available" | "missing">;
type ResearchSource = TextRow<
  | "id"
  | "name"
  | "status"
  | "repository"
  | "revision"
  | "positioning"
  | "adopt"
  | "reject"
  | "evidence"
>;
type Comparison = TextRow<"dimension" | "orca" | "cmux" | "agentOrchestrator" | "pierDecision">;
type Constraint = TextRow<"id" | "text">;
type Ownership = TextRow<"layer" | "owner" | "owns" | "mustNotOwn">;
type Entity = TextRow<"name" | "owner" | "identity" | "meaning">;
type StateRule = TextRow<"state" | "source" | "meaning" | "next">;
type StateMachine = TextRow<"entity" | "path" | "guard" | "terminal">;
type Loop = TextRow<"id" | "name" | "steps" | "closed" | "exitStates">;
type CommandGroup = TextRow<"group" | "commands" | "responsibility" | "safety">;
type CliLifecycle = TextRow<"stage" | "commands" | "commit" | "recovery">;
type TransportRule = TextRow<"part" | "rule">;
type Principal = TextRow<"principal" | "scope" | "allowed" | "forbidden">;
type ErrorFamily = TextRow<"family" | "codes" | "exit" | "next">;
type DayCommand = TextRow<"title" | "cmd" | "why" | "userSees">;
type RuntimeSession = TextRow<
  "id" | "name" | "provider" | "status" | "runtime" | "location" | "worktree" | "summary"
>;
type RuntimeFact = TextRow<"fact" | "source" | "observedAt" | "meaning">;
type Journey = TextRow<"id" | "name" | "trigger" | "system" | "userSees" | "failure">;
type DefaultRow = TextRow<"surface" | "before" | "after">;
type Acceptance = TextRow<"id" | "text" | "evidence" | "status">;

export type SchemeData = {
  schemaVersion: 2;
  generatedAt: string;
  source: string;
  data: {
    meta: Meta;
    bluf: string;
    insight: string;
    decision: string;
    scope: {
      model: "agent-facing-runtime-control";
      completionAuthority: "caller-agent-or-external-controller";
      pierOwns: string[];
      callerOwns: string[];
      forbiddenInPier: string[];
    };
    goals: string[];
    productNonGoals: string[];
    successMeasures: Measure[];
    mainLoop: TextRow<"diagram" | "caption">;
    problem: {
      title: string;
      thesis: string;
      pains: Pain[];
    };
    currentState: CurrentState[];
    researchSources: ResearchSource[];
    comparison: Comparison[];
    hardConstraints: Constraint[];
    architecture: { diagram: string; notes: string[] };
    ownership: Ownership[];
    entities: Entity[];
    stateRules: StateRule[];
    stateMachines: StateMachine[];
    closedLoops: Loop[];
    cli: {
      namespace: string;
      decision: string;
      commandGroups: CommandGroup[];
      lifecycle: CliLifecycle[];
      commonRules: string[];
      transport: TransportRule[];
      principals: Principal[];
      errors: ErrorFamily[];
      jsonEnvelope: string;
      streamEnvelope: string;
    };
    day1Commands: DayCommand[];
    day1Recipe: string;
    runtimeUi: {
      disclaimer: string;
      /** 协作台内容边界说明（避免与一次性调用混淆）；不得含 invoke/reply 等禁词。 */
      contentBoundary: string;
      workspace: TextRow<"title" | "meta" | "status">;
      sessions: RuntimeSession[];
      selected: TextRow<"name" | "state" | "runtime" | "location" | "worktree" | "summary">;
      attention: TextRow<"title" | "reason" | "next">;
      facts: RuntimeFact[];
      states: string[];
    };
    journeys: Journey[];
    defaults: DefaultRow[];
    safetyRails: string[];
    antiPatterns: string[];
    phases: ClosedLoopPhase[];
    acceptance: Acceptance[];
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} 必须是对象`);
  }
  return value;
}

function requireExactKeys(record: Record<string, unknown>, keys: string[], label: string) {
  const allowed = new Set(keys);
  const unexpected = Object.keys(record).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new Error(`${label} 含未知字段：${unexpected.join("、")}`);
  }
}

function requireString(record: Record<string, unknown>, key: string, label: string) {
  if (typeof record[key] !== "string" || record[key] === "") {
    throw new Error(`${label}.${key} 必须是非空字符串`);
  }
}

function requireStringArray(value: unknown, label: string) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== "string" || item === "")
  ) {
    throw new Error(`${label} 必须是非空字符串数组`);
  }
}

function requireStringRecord(value: unknown, keys: string[], label: string) {
  const record = requireRecord(value, label);
  for (const key of keys) {
    requireString(record, key, label);
  }
  return record;
}

function requireExactStringRecord(value: unknown, keys: string[], label: string) {
  const record = requireStringRecord(value, keys, label);
  requireExactKeys(record, keys, label);
  return record;
}

function requireRows(value: unknown, keys: string[], label: string) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} 必须是非空数组`);
  }
  for (const [index, item] of value.entries()) {
    requireExactStringRecord(item, keys, `${label}[${index}]`);
  }
}

function hasExactStringSet(value: string[], expected: readonly string[]): boolean {
  return value.length === expected.length && expected.every((item) => value.includes(item));
}

const EXPECTED_PIER_OWNS = [
  "agent-caller-identity",
  "one-shot-agent-invocation",
  "bounded-agent-screen",
  "agent-runtime-observation",
  "terminal-control",
  "panel-focus",
  "worktree-guard",
  "shell-task-runs",
  "attention-routing",
  "local-control-transport",
  "local-control-authorization",
] as const;

const EXPECTED_CALLER_OWNS = [
  "goal-and-work-decomposition",
  "call-selection-and-delegation-policy",
  "retry-and-completion-policy",
  "result-acceptance-and-synthesis",
  "caller-memory-or-external-ledger",
] as const;

const EXPECTED_FORBIDDEN_IN_PIER = [
  "多智能体任务 Run、WorkItem、Attempt、Gate、Result 状态机",
  "多智能体工作 DAG、任务台账、看板与自动调度",
  "将运行事实、通知或终端输出解释为任务完成",
  "用官方插件绕过 Pier 不做任务生命周期的产品边界",
] as const;

const EXPECTED_OWNERS = new Map([
  ["调用方编排语义", "协调智能体 / 外部控制器"],
  ["智能体调用身份", "Pier main AgentCallerService"],
  ["一次性智能体调用", "Pier main AgentInvokeService"],
  ["本机控制传输", "Pier local-control"],
  ["本机控制授权", "Pier main AccessGrantService"],
  ["终端运行控制", "Pier main RuntimeControlService"],
  ["窗口与面板", "Pier workspace"],
  ["运行事实", "ForegroundActivity + Runtime Index + provider adapters"],
  ["工作树", "WorktreeService"],
  ["shell 执行", "TaskRuns"],
  ["注意力与界面", "NCS + Pier renderer"],
]);

const EXPECTED_ENTITIES = [
  "AgentCallerCredential",
  "InvocationReply",
  "AccessGrantRef",
  "CapabilityRef",
  "AgentRef",
  "WindowRef",
  "PanelRef",
  "RuntimeRef",
  "ProviderSessionRef",
  "ForegroundActivitySnapshot",
  "AgentRuntimeIndexEntry",
  "WorktreeRef",
  "TaskRunRef",
  "NotificationRef",
] as const;

const EXPECTED_STATE_MACHINES = [
  "调用方任务（非 Pier）",
  "Agent caller credential",
  "Agent invocation（一次性）",
  "Access connection",
  "Access request",
  "Access grant",
  "Agent activity projection",
  "Terminal runtime",
  "Window surface",
  "Panel surface",
  "Worktree",
  "TaskRun（shell）",
  "Notification",
] as const;

const FORBIDDEN_PUBLIC_HISTORY_COMMAND =
  /(?:^|[\s·|/])(?:transcript|history|replay|scrollback)(?:$|[\s·|/])/iu;

export function parseScheme(raw: string): SchemeData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("data.json 不是合法 JSON");
  }

  const root = requireRecord(parsed, "根对象");
  requireExactKeys(root, ["schemaVersion", "generatedAt", "source", "data"], "根对象");
  if (root.schemaVersion !== 2) {
    throw new Error("data.json 需要 schemaVersion: 2");
  }
  requireString(root, "generatedAt", "根对象");
  requireString(root, "source", "根对象");

  const data = requireRecord(root.data, "data");
  requireExactKeys(
    data,
    [
      "meta",
      "bluf",
      "insight",
      "decision",
      "scope",
      "goals",
      "productNonGoals",
      "successMeasures",
      "mainLoop",
      "problem",
      "currentState",
      "researchSources",
      "comparison",
      "hardConstraints",
      "architecture",
      "ownership",
      "entities",
      "stateRules",
      "stateMachines",
      "closedLoops",
      "cli",
      "day1Commands",
      "day1Recipe",
      "runtimeUi",
      "journeys",
      "defaults",
      "safetyRails",
      "antiPatterns",
      "phases",
      "acceptance",
    ],
    "data",
  );
  for (const key of ["bluf", "insight", "decision", "day1Recipe"]) {
    requireString(data, key, "data");
  }
  for (const key of ["goals", "productNonGoals", "safetyRails", "antiPatterns"]) {
    requireStringArray(data[key], `data.${key}`);
  }

  const scope = requireStringRecord(data.scope, ["model", "completionAuthority"], "data.scope");
  requireExactKeys(
    scope,
    ["model", "completionAuthority", "pierOwns", "callerOwns", "forbiddenInPier"],
    "data.scope",
  );
  for (const key of ["pierOwns", "callerOwns", "forbiddenInPier"]) {
    requireStringArray(scope[key], `data.scope.${key}`);
  }
  if (
    scope.model !== "agent-facing-runtime-control" ||
    scope.completionAuthority !== "caller-agent-or-external-controller"
  ) {
    throw new Error("data.scope 必须把目标分解、重试与完成判断留给调用智能体或外部控制器");
  }
  if (
    !hasExactStringSet(scope.pierOwns as string[], EXPECTED_PIER_OWNS) ||
    !hasExactStringSet(scope.callerOwns as string[], EXPECTED_CALLER_OWNS) ||
    !hasExactStringSet(scope.forbiddenInPier as string[], EXPECTED_FORBIDDEN_IN_PIER)
  ) {
    throw new Error("data.scope 必须精确声明产品边界");
  }
  const scopeResult = validatePierScopeContract({ pierOwns: scope.pierOwns as string[] });
  if (!scopeResult.valid) {
    throw new Error(
      `data.scope.pierOwns 越过产品边界：${scopeResult.forbiddenPierOwnership.join("、")}`,
    );
  }

  requireExactStringRecord(
    data.meta,
    ["title", "subtitle", "status", "version", "researchCutoff", "codeBaseline"],
    "data.meta",
  );
  requireExactStringRecord(data.mainLoop, ["diagram", "caption"], "data.mainLoop");
  const problem = requireStringRecord(data.problem, ["title", "thesis"], "data.problem");
  requireExactKeys(problem, ["title", "thesis", "pains"], "data.problem");
  const architecture = requireStringRecord(data.architecture, ["diagram"], "data.architecture");
  requireExactKeys(architecture, ["diagram", "notes"], "data.architecture");
  requireStringArray(architecture.notes, "data.architecture.notes");
  const cli = requireStringRecord(
    data.cli,
    ["namespace", "decision", "jsonEnvelope", "streamEnvelope"],
    "data.cli",
  );
  requireExactKeys(
    cli,
    [
      "namespace",
      "decision",
      "commandGroups",
      "lifecycle",
      "commonRules",
      "transport",
      "principals",
      "errors",
      "jsonEnvelope",
      "streamEnvelope",
    ],
    "data.cli",
  );
  requireStringArray(cli.commonRules, "data.cli.commonRules");
  const runtimeUi = requireStringRecord(
    data.runtimeUi,
    ["disclaimer", "contentBoundary"],
    "data.runtimeUi",
  );
  requireExactKeys(
    runtimeUi,
    [
      "disclaimer",
      "contentBoundary",
      "workspace",
      "sessions",
      "selected",
      "attention",
      "facts",
      "states",
    ],
    "data.runtimeUi",
  );
  requireStringArray(runtimeUi.states, "data.runtimeUi.states");
  requireExactStringRecord(
    runtimeUi.workspace,
    ["title", "meta", "status"],
    "data.runtimeUi.workspace",
  );
  requireExactStringRecord(
    runtimeUi.selected,
    ["name", "state", "runtime", "location", "worktree", "summary"],
    "data.runtimeUi.selected",
  );
  requireExactStringRecord(
    runtimeUi.attention,
    ["title", "reason", "next"],
    "data.runtimeUi.attention",
  );

  const rowChecks: [unknown, string[], string][] = [
    [data.successMeasures, ["metric", "target", "proof"], "data.successMeasures"],
    [problem.pains, ["id", "title", "detail", "consequence"], "data.problem.pains"],
    [data.currentState, ["area", "owner", "available", "missing"], "data.currentState"],
    [
      data.researchSources,
      [
        "id",
        "name",
        "status",
        "repository",
        "revision",
        "positioning",
        "adopt",
        "reject",
        "evidence",
      ],
      "data.researchSources",
    ],
    [
      data.comparison,
      ["dimension", "orca", "cmux", "agentOrchestrator", "pierDecision"],
      "data.comparison",
    ],
    [data.hardConstraints, ["id", "text"], "data.hardConstraints"],
    [data.ownership, ["layer", "owner", "owns", "mustNotOwn"], "data.ownership"],
    [data.entities, ["name", "owner", "identity", "meaning"], "data.entities"],
    [data.stateRules, ["state", "source", "meaning", "next"], "data.stateRules"],
    [data.stateMachines, ["entity", "path", "guard", "terminal"], "data.stateMachines"],
    [data.closedLoops, ["id", "name", "steps", "closed", "exitStates"], "data.closedLoops"],
    [
      cli.commandGroups,
      ["group", "commands", "responsibility", "safety"],
      "data.cli.commandGroups",
    ],
    [cli.lifecycle, ["stage", "commands", "commit", "recovery"], "data.cli.lifecycle"],
    [cli.transport, ["part", "rule"], "data.cli.transport"],
    [cli.principals, ["principal", "scope", "allowed", "forbidden"], "data.cli.principals"],
    [cli.errors, ["family", "codes", "exit", "next"], "data.cli.errors"],
    [data.day1Commands, ["title", "cmd", "why", "userSees"], "data.day1Commands"],
    [
      runtimeUi.sessions,
      ["id", "name", "provider", "status", "runtime", "location", "worktree", "summary"],
      "data.runtimeUi.sessions",
    ],
    [runtimeUi.facts, ["fact", "source", "observedAt", "meaning"], "data.runtimeUi.facts"],
    [data.journeys, ["id", "name", "trigger", "system", "userSees", "failure"], "data.journeys"],
    [data.defaults, ["surface", "before", "after"], "data.defaults"],
    [data.acceptance, ["id", "text", "evidence", "status"], "data.acceptance"],
  ];
  for (const [value, keys, label] of rowChecks) {
    requireRows(value, keys, label);
  }

  const publicHistoryCommands = (cli.commandGroups as CommandGroup[])
    .map((row) => row.commands)
    .filter((commands) => FORBIDDEN_PUBLIC_HISTORY_COMMAND.test(commands));
  if (publicHistoryCommands.length > 0) {
    throw new Error(
      `data.cli.commandGroups 不得开放公共 transcript/history/replay/scrollback 命令：${publicHistoryCommands.join("、")}`,
    );
  }

  const ownershipRows = data.ownership as Ownership[];
  const ownershipLayers = ownershipRows.map((row) => row.layer);
  if (
    ownershipRows.length !== EXPECTED_OWNERS.size ||
    new Set(ownershipLayers).size !== EXPECTED_OWNERS.size ||
    ownershipRows.some((row) => EXPECTED_OWNERS.get(row.layer) !== row.owner)
  ) {
    throw new Error("data.ownership 所有权表必须使用唯一且固定的 owner");
  }

  const entityNames = (data.entities as Entity[]).map((row) => row.name);
  const stateMachineNames = (data.stateMachines as StateMachine[]).map((row) => row.entity);
  if (
    !hasExactStringSet(entityNames, EXPECTED_ENTITIES) ||
    !hasExactStringSet(stateMachineNames, EXPECTED_STATE_MACHINES)
  ) {
    throw new Error("data.entities/stateMachines 必须与智能体调用和运行控制领域 allowlist 精确一致");
  }

  const architectureResult = validatePierArchitectureContract({
    ownershipLayers,
    ownershipClaims: ownershipRows
      .filter((row) => row.layer !== "调用方编排语义")
      .flatMap((row) => [row.owner, row.owns]),
    entityNames,
    stateMachineEntities: stateMachineNames,
    supportingClaims: {
      ordinary: [
        root.source as string,
        ...Object.entries(data.meta as Meta)
          .filter(([key]) => key !== "subtitle")
          .map(([, value]) => value),
        data.insight as string,
        data.decision as string,
        ...(data.goals as string[]),
        ...(data.successMeasures as Measure[]).flatMap((row) => Object.values(row)),
        (data.mainLoop as TextRow<"diagram" | "caption">).caption,
        problem.title as string,
        problem.thesis as string,
        ...(problem.pains as Pain[]).flatMap((row) => Object.values(row)),
        ...(data.currentState as CurrentState[]).flatMap((row) => Object.values(row)),
        ...(data.researchSources as ResearchSource[]).map((row) => row.adopt),
        ...(architecture.notes as string[]),
        ...(data.comparison as Comparison[]).map((row) => row.pierDecision),
        ...(data.entities as Entity[]).flatMap((row) => [row.owner, row.identity, row.meaning]),
        ...(data.stateMachines as StateMachine[])
          .filter((row) => row.entity !== "调用方任务（非 Pier）")
          .flatMap((row) => [row.path, row.guard, row.terminal]),
        ...(data.stateRules as StateRule[]).flatMap((row) => Object.values(row)),
        ...(data.closedLoops as Loop[]).flatMap((row) => [
          row.name,
          row.steps,
          row.closed,
          row.exitStates,
        ]),
        cli.namespace as string,
        cli.decision as string,
        ...(cli.commandGroups as CommandGroup[]).flatMap((row) => [
          row.commands,
          row.responsibility,
          row.safety,
        ]),
        ...(cli.lifecycle as CliLifecycle[]).flatMap((row) => [
          row.commands,
          row.commit,
          row.recovery,
        ]),
        ...(cli.commonRules as string[]),
        ...(cli.transport as TransportRule[]).map((row) => row.rule),
        ...(cli.principals as Principal[]).flatMap((row) => [
          row.principal,
          row.scope,
          row.allowed,
        ]),
        ...(cli.errors as ErrorFamily[]).flatMap((row) => Object.values(row)),
        cli.jsonEnvelope as string,
        cli.streamEnvelope as string,
        data.day1Recipe as string,
        ...(data.day1Commands as DayCommand[]).flatMap((row) => Object.values(row)),
        runtimeUi.disclaimer as string,
        runtimeUi.contentBoundary as string,
        ...Object.values(runtimeUi.workspace as TextRow<"title" | "meta" | "status">),
        ...(runtimeUi.sessions as RuntimeSession[]).flatMap((row) => Object.values(row)),
        ...Object.values(
          runtimeUi.selected as TextRow<
            "name" | "state" | "runtime" | "location" | "worktree" | "summary"
          >,
        ),
        ...Object.values(runtimeUi.attention as TextRow<"title" | "reason" | "next">),
        ...(runtimeUi.facts as RuntimeFact[]).flatMap((row) => Object.values(row)),
        ...(runtimeUi.states as string[]),
        ...(data.journeys as Journey[]).flatMap((row) => Object.values(row)),
        ...(data.defaults as DefaultRow[]).flatMap((row) => [row.surface, row.after]),
        ...(data.phases as ClosedLoopPhase[]).flatMap((row) => [
          row.name,
          row.outcome,
          ...row.slices.map((slice) => slice.title),
        ]),
        ...(data.hardConstraints as Constraint[]).map((row) => row.text),
        ...(data.safetyRails as string[]),
        ...(data.acceptance as Acceptance[]).flatMap((row) => [row.text, row.evidence]),
      ],
      externalResearch: [
        ...(data.researchSources as ResearchSource[]).flatMap((row) => [
          row.name,
          row.positioning,
          row.evidence,
        ]),
        ...(data.comparison as Comparison[]).flatMap((row) => [
          row.dimension,
          row.orca,
          row.cmux,
          row.agentOrchestrator,
        ]),
      ],
      externalOwnership: [
        (data.meta as Meta).subtitle,
        data.bluf as string,
        (data.mainLoop as TextRow<"diagram" | "caption">).diagram,
        architecture.diagram as string,
        ...ownershipRows
          .filter((row) => row.layer === "调用方编排语义")
          .flatMap((row) => [row.owner, row.owns]),
        ...(data.stateMachines as StateMachine[])
          .filter((row) => row.entity === "调用方任务（非 Pier）")
          .flatMap((row) => [row.path, row.guard, row.terminal]),
      ],
      explicitNonGoals: [
        ...(scope.forbiddenInPier as string[]),
        ...(data.productNonGoals as string[]),
        ...ownershipRows.map((row) => row.mustNotOwn),
        ...(data.researchSources as ResearchSource[]).map((row) => row.reject),
        ...(cli.principals as Principal[]).map((row) => row.forbidden),
      ],
      antiPatterns: [
        ...(data.antiPatterns as string[]),
        ...(data.defaults as DefaultRow[]).map((row) => row.before),
      ],
    },
  });
  if (!architectureResult.valid) {
    throw new Error(
      `data 架构支撑表越过产品边界：${[
        ...architectureResult.unexpectedOwnershipLayers,
        ...architectureResult.forbiddenOwnershipClaims,
        ...architectureResult.unexpectedEntities,
        ...architectureResult.unexpectedStateMachines,
        ...architectureResult.forbiddenSupportingClaims,
      ].join("、")}`,
    );
  }

  if (!Array.isArray(data.day1Commands) || data.day1Commands.length > 4) {
    throw new Error("data.day1Commands 必须为 1–4 条");
  }
  parseClosedLoopPhases(data.phases);
  return parsed as SchemeData;
}
