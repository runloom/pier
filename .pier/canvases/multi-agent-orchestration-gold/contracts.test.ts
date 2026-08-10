import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { parseScheme } from "./model.ts";

type ScopeContractModule = {
  validatePierArchitectureContract(input: {
    ownershipLayers: string[];
    ownershipClaims: string[];
    entityNames: string[];
    stateMachineEntities: string[];
    supportingClaims: {
      ordinary: string[];
      externalResearch: string[];
      externalOwnership: string[];
      explicitNonGoals: string[];
      antiPatterns: string[];
    };
  }): {
    valid: boolean;
    unexpectedOwnershipLayers: string[];
    forbiddenOwnershipClaims: string[];
    unexpectedEntities: string[];
    unexpectedStateMachines: string[];
    forbiddenSupportingClaims: string[];
  };
  validatePierScopeContract(input: { pierOwns: string[] }): {
    valid: boolean;
    forbiddenPierOwnership: string[];
  };
};

type PhaseSchemaModule = {
  parseClosedLoopPhase(input: unknown): unknown;
};

type StatusPresentationModule = {
  presentStatus(status: string): {
    label: string;
    tone: "info" | "outline" | "success" | "warning";
  };
};

function isMissingExpectedModule(error: unknown, moduleName: string): boolean {
  if (!(error instanceof Error) || !error.message.includes(moduleName)) {
    return false;
  }
  return (
    error.message.includes("Cannot find") ||
    error.message.includes("Failed to load") ||
    error.message.includes("Unknown variable dynamic import")
  );
}

async function loadExpectedModule<T>(
  specifier: string,
  moduleName: string,
): Promise<T | undefined> {
  try {
    return (await import(/* @vite-ignore */ specifier)) as T;
  } catch (error) {
    if (isMissingExpectedModule(error, moduleName)) {
      return undefined;
    }
    throw error;
  }
}

describe("Pier 多智能体监督范围契约", () => {
  it("拒绝由 Pier 持有任务生命周期或完成裁决权", async () => {
    const contract = await loadExpectedModule<ScopeContractModule>(
      "./scope-contract.ts",
      "scope-contract",
    );

    expect(contract, "需要新增纯函数模块 scope-contract.ts").toBeDefined();
    if (!contract) {
      return;
    }

    expect(
      contract.validatePierScopeContract({
        pierOwns: [
          "agent-runtime-observation",
          "task-lifecycle",
          "completion-authority",
          "terminal-control",
        ],
      }),
    ).toEqual({
      valid: false,
      forbiddenPierOwnership: ["task-lifecycle", "completion-authority"],
    });

    expect(
      contract.validatePierScopeContract({
        pierOwns: [
          "agent-runtime-observation",
          "terminal-control",
          "panel-focus",
          "worktree-guard",
        ],
      }),
    ).toEqual({
      valid: true,
      forbiddenPierOwnership: [],
    });

    expect(
      contract.validatePierScopeContract({
        pierOwns: ["multi-agent-task-lifecycle", "orchestration-ledger"],
      }),
    ).toEqual({
      valid: false,
      forbiddenPierOwnership: ["multi-agent-task-lifecycle", "orchestration-ledger"],
    });
  });

  it("拒绝在所有权、实体或状态机中补建 Pier 编排领域", async () => {
    const contract = await loadExpectedModule<ScopeContractModule>(
      "./scope-contract.ts",
      "scope-contract",
    );

    expect(contract, "需要新增纯函数模块 scope-contract.ts").toBeDefined();
    if (!contract) {
      return;
    }

    expect(
      contract.validatePierArchitectureContract({
        ownershipLayers: ["终端运行控制", "Pier 多智能体编排"],
        ownershipClaims: ["PTY/process 与精确运行控制", "多智能体任务生命周期与完成权"],
        entityNames: ["AgentRef", "MultiAgentRun"],
        stateMachineEntities: ["Terminal runtime", "WorkItem"],
        supportingClaims: {
          ordinary: ["发现并聚焦 AgentRef", "Pier 持久化任务台账并展示工作看板"],
          externalResearch: [],
          externalOwnership: [],
          explicitNonGoals: [],
          antiPatterns: [],
        },
      }),
    ).toEqual({
      valid: false,
      unexpectedOwnershipLayers: ["Pier 多智能体编排"],
      forbiddenOwnershipClaims: ["多智能体任务生命周期与完成权"],
      unexpectedEntities: ["MultiAgentRun"],
      unexpectedStateMachines: ["WorkItem"],
      forbiddenSupportingClaims: ["Pier 持久化任务台账并展示工作看板"],
    });
  });

  it.each([
    "是",
    "包含",
    "主管",
    "跟踪",
    "运营",
    "托管",
    "裁决",
    "接管",
    "管控",
    "建设",
    "记录并留存",
    "具备",
  ])("普通支撑字段不能用“%s”等动作同义句绕过产品边界", async (verb) => {
    const contract = await loadExpectedModule<ScopeContractModule>(
      "./scope-contract.ts",
      "scope-contract",
    );

    expect(contract, "需要新增纯函数模块 scope-contract.ts").toBeDefined();
    if (!contract) {
      return;
    }

    const claim = `Pier ${verb}多智能体任务生命周期与任务台账`;
    const result = contract.validatePierArchitectureContract({
      ownershipLayers: ["终端运行控制"],
      ownershipClaims: ["PTY/process 与精确运行控制"],
      entityNames: ["RuntimeRef"],
      stateMachineEntities: ["Terminal runtime"],
      supportingClaims: {
        ordinary: [claim],
        externalResearch: [],
        externalOwnership: [],
        explicitNonGoals: [],
        antiPatterns: [],
      },
    });

    expect(result.forbiddenSupportingClaims).toEqual([claim]);
    expect(result.valid).toBe(false);
  });

  it("按结构上下文允许外部研究、外部所有权、明确非目标与反模式", async () => {
    const contract = await loadExpectedModule<ScopeContractModule>(
      "./scope-contract.ts",
      "scope-contract",
    );

    expect(contract, "需要新增纯函数模块 scope-contract.ts").toBeDefined();
    if (!contract) {
      return;
    }

    expect(
      contract.validatePierArchitectureContract({
        ownershipLayers: ["终端运行控制"],
        ownershipClaims: ["PTY/process 与精确运行控制"],
        entityNames: ["RuntimeRef"],
        stateMachineEntities: ["Terminal runtime"],
        supportingClaims: {
          ordinary: ["Pier 只提供终端运行事实"],
          externalResearch: ["Orca 建立 MultiAgentRun、Gate 与 Result"],
          externalOwnership: ["外部编排器持有任务生命周期与完成权"],
          explicitNonGoals: ["Pier 不建立任务台账或工作看板"],
          antiPatterns: ["用官方插件接管 WorkItem 与 Gate"],
        },
      }),
    ).toMatchObject({ valid: true, forbiddenSupportingClaims: [] });
  });

  it("否定只能豁免同一分句内紧邻的领域词，不能遮蔽后续正向声明", async () => {
    const contract = await loadExpectedModule<ScopeContractModule>(
      "./scope-contract.ts",
      "scope-contract",
    );

    expect(contract, "需要新增纯函数模块 scope-contract.ts").toBeDefined();
    if (!contract) {
      return;
    }

    const allowedNegative = "Pier 不建立任务台账";
    const hiddenPositive = "Pier 不保存一般日志，但 Pier 包含任务台账并托管工作看板";
    const result = contract.validatePierArchitectureContract({
      ownershipLayers: ["终端运行控制"],
      ownershipClaims: ["PTY/process 与精确运行控制"],
      entityNames: ["RuntimeRef"],
      stateMachineEntities: ["Terminal runtime"],
      supportingClaims: {
        ordinary: [allowedNegative, hiddenPositive],
        externalResearch: [],
        externalOwnership: [],
        explicitNonGoals: [],
        antiPatterns: [],
      },
    });

    expect(result.forbiddenSupportingClaims).toEqual([hiddenPositive]);
    expect(result.valid).toBe(false);
  });

  it.each(["Pier", "宿主", "本产品"])(
    "外部上下文把“%s”识别为同一受控主体，并区分正向持有与明确否定",
    async (subject) => {
      const contract = await loadExpectedModule<ScopeContractModule>(
        "./scope-contract.ts",
        "scope-contract",
      );

      expect(contract, "需要新增纯函数模块 scope-contract.ts").toBeDefined();
      if (!contract) {
        return;
      }

      const forwardClaim = `${subject} 持有任务生命周期与任务台账`;
      const reversedClaim = `任务生命周期与任务台账全部由${subject}持有`;
      const forwardNegative = `${subject} 不持有任务生命周期与任务台账`;
      const reversedNegative = `任务生命周期与任务台账不由${subject}持有`;
      const result = contract.validatePierArchitectureContract({
        ownershipLayers: ["终端运行控制"],
        ownershipClaims: ["PTY/process 与精确运行控制"],
        entityNames: ["RuntimeRef"],
        stateMachineEntities: ["Terminal runtime"],
        supportingClaims: {
          ordinary: [],
          externalResearch: [],
          externalOwnership: [
            forwardClaim,
            reversedClaim,
            forwardNegative,
            reversedNegative,
          ],
          explicitNonGoals: [],
          antiPatterns: [],
        },
      });

      expect(result.forbiddenSupportingClaims).toEqual([forwardClaim, reversedClaim]);
      expect(result.valid).toBe(false);
    },
  );

  it("普通字段中的明确否定不能遮蔽后续主体别名的正向声明", async () => {
    const contract = await loadExpectedModule<ScopeContractModule>(
      "./scope-contract.ts",
      "scope-contract",
    );

    expect(contract, "需要新增纯函数模块 scope-contract.ts").toBeDefined();
    if (!contract) {
      return;
    }

    const claim = "宿主不持有任务生命周期，本产品持有任务台账";
    const result = contract.validatePierArchitectureContract({
      ownershipLayers: ["终端运行控制"],
      ownershipClaims: ["PTY/process 与精确运行控制"],
      entityNames: ["RuntimeRef"],
      stateMachineEntities: ["Terminal runtime"],
      supportingClaims: {
        ordinary: [claim],
        externalResearch: [],
        externalOwnership: [],
        explicitNonGoals: [],
        antiPatterns: [],
      },
    });

    expect(result.forbiddenSupportingClaims).toEqual([claim]);
    expect(result.valid).toBe(false);
  });
});

describe("规范 Canvas 数据", () => {
  it("以智能体调用者为首屏主回路，并把完成权留给调用方", async () => {
    const raw = await readFile(new URL("./data.json", import.meta.url), "utf8");
    const data = JSON.parse(raw) as {
      data: {
        scope: { model: string; completionAuthority: string };
        mainLoop: { diagram: string };
      };
    };

    expect(data.data.scope).toMatchObject({
      model: "agent-facing-runtime-control",
      completionAuthority: "caller-agent-or-external-controller",
    });

    const diagram = data.data.mainLoop.diagram;
    expect(diagram).toContain("协调智能体");
    expect(diagram).toContain("工作智能体");
    expect(diagram).toContain("Pier 智能体 CLI");
    expect(diagram).toMatch(/外部控制器.*可选|可选.*外部控制器/u);
  });

  it.each([
    "是",
    "包含",
    "主管",
    "跟踪",
    "运营",
    "托管",
    "裁决",
    "接管",
    "管控",
    "建设",
    "记录并留存",
    "具备",
  ])("architecture.notes 中的 Pier 越界同义句“%s”会被拒绝", async (verb) => {
    const raw = await readFile(new URL("./data.json", import.meta.url), "utf8");
    const injected = JSON.parse(raw) as { data: { architecture: { notes: string[] } } };
    injected.data.architecture.notes.push(`Pier ${verb}任务生命周期与任务台账`);

    expect(() => parseScheme(JSON.stringify(injected))).toThrow("架构支撑表越过产品边界");
  });

  it("真实 data.json 可解析，且跨表注入 Pier 任务生命周期会被拒绝", async () => {
    const raw = await readFile(new URL("./data.json", import.meta.url), "utf8");
    expect(() => parseScheme(raw)).not.toThrow();

    const injected = JSON.parse(raw) as {
      data: {
        ownership: Array<{ layer: string; owner: string; owns: string; mustNotOwn: string }>;
        entities: Array<{ name: string; owner: string; identity: string; meaning: string }>;
      };
    };
    injected.data.ownership.push({
      layer: "终端运行控制",
      owner: "Pier main RuntimeControlService",
      owns: "多智能体任务生命周期与完成权",
      mustNotOwn: "无",
    });

    expect(() => parseScheme(JSON.stringify(injected))).toThrow(
      "所有权表必须使用唯一且固定的 owner",
    );

    const hiddenInAllowedEntity = JSON.parse(raw) as {
      data: {
        entities: Array<{ name: string; owner: string; identity: string; meaning: string }>;
      };
    };
    hiddenInAllowedEntity.data.entities[0].meaning = "Pier 持久化任务台账并展示工作看板";
    expect(() => parseScheme(JSON.stringify(hiddenInAllowedEntity))).toThrow(
      "架构支撑表越过产品边界",
    );

    const hiddenInRecipe = JSON.parse(raw) as { data: { day1Recipe: string } };
    hiddenInRecipe.data.day1Recipe =
      "pier multi-agent run --auto-schedule --persist-task-ledger";
    expect(() => parseScheme(JSON.stringify(hiddenInRecipe))).toThrow(
      "架构支撑表越过产品边界",
    );

    const hiddenInAttention = JSON.parse(raw) as {
      data: { runtimeUi: { attention: { title: string; reason: string; next: string } } };
    };
    hiddenInAttention.data.runtimeUi.attention.reason =
      "Pier 创建审批 Gate 并自动推进多智能体任务生命周期";
    expect(() => parseScheme(JSON.stringify(hiddenInAttention))).toThrow(
      "架构支撑表越过产品边界",
    );

    const hiddenInOwner = JSON.parse(raw) as {
      data: {
        ownership: Array<{ layer: string; owner: string; owns: string; mustNotOwn: string }>;
      };
    };
    hiddenInOwner.data.ownership[3].owner = "Pier MultiAgentScheduler";
    expect(() => parseScheme(JSON.stringify(hiddenInOwner))).toThrow(
      "所有权表必须使用唯一且固定的 owner",
    );

    const hiddenInProblem = JSON.parse(raw) as { data: { problem: { thesis: string } } };
    hiddenInProblem.data.problem.thesis = "Pier 创建并持久化多智能体任务台账";
    expect(() => parseScheme(JSON.stringify(hiddenInProblem))).toThrow(
      "架构支撑表越过产品边界",
    );

    const hiddenInCurrentState = JSON.parse(raw) as {
      data: { currentState: Array<{ available: string }> };
    };
    hiddenInCurrentState.data.currentState[0].available =
      "Pier 自动调度 WorkItem 并判定 Result";
    expect(() => parseScheme(JSON.stringify(hiddenInCurrentState))).toThrow(
      "架构支撑表越过产品边界",
    );

    const hiddenInMainLoop = JSON.parse(raw) as {
      data: { mainLoop: { diagram: string; caption: string } };
    };
    hiddenInMainLoop.data.mainLoop.caption = "Pier 建立工作看板并推进任务生命周期";
    expect(() => parseScheme(JSON.stringify(hiddenInMainLoop))).toThrow(
      "架构支撑表越过产品边界",
    );

    const hiddenInStateRule = JSON.parse(raw) as {
      data: { stateRules: Array<{ meaning: string }> };
    };
    hiddenInStateRule.data.stateRules[0].meaning = "Pier 保存编排数据库并拥有完成权";
    expect(() => parseScheme(JSON.stringify(hiddenInStateRule))).toThrow(
      "架构支撑表越过产品边界",
    );

    const hiddenInResearchAdoption = JSON.parse(raw) as {
      data: { researchSources: Array<{ adopt: string }> };
    };
    hiddenInResearchAdoption.data.researchSources[0].adopt =
      "Pier 实现 MultiAgentRun 和 Gate";
    expect(() => parseScheme(JSON.stringify(hiddenInResearchAdoption))).toThrow(
      "架构支撑表越过产品边界",
    );

    const unknownRootDomain = JSON.parse(raw) as {
      data: Record<string, unknown>;
    };
    unknownRootDomain.data.taskLedger = {
      owner: "Pier",
      rule: "Pier 持久化任务台账并展示工作看板",
    };
    expect(() => parseScheme(JSON.stringify(unknownRootDomain))).toThrow("含未知字段");

    const unknownEntityField = JSON.parse(raw) as {
      data: { entities: Array<Record<string, unknown>> };
    };
    unknownEntityField.data.entities[0].taskLifecycle = "Pier 管理任务生命周期";
    expect(() => parseScheme(JSON.stringify(unknownEntityField))).toThrow("含未知字段");

    const forgedExternalOwner = JSON.parse(raw) as {
      data: {
        ownership: Array<{ layer: string; owner: string; owns: string; mustNotOwn: string }>;
      };
    };
    forgedExternalOwner.data.ownership[0].owner = "Pier main Scheduler";
    forgedExternalOwner.data.ownership[0].owns = "任务生命周期、任务台账、自动调度与完成权";
    expect(() => parseScheme(JSON.stringify(forgedExternalOwner))).toThrow(
      "所有权表必须使用唯一且固定的 owner",
    );

    const forgedExternalMachine = JSON.parse(raw) as {
      data: {
        stateMachines: Array<{ entity: string; path: string; guard: string; terminal: string }>;
      };
    };
    forgedExternalMachine.data.stateMachines[0].path = "Pier 创建任务台账";
    forgedExternalMachine.data.stateMachines[0].guard = "Pier 自动调度 WorkItem";
    forgedExternalMachine.data.stateMachines[0].terminal = "Pier 判定 Result";
    expect(() => parseScheme(JSON.stringify(forgedExternalMachine))).toThrow(
      "架构支撑表越过产品边界",
    );

    const emptyCallerBoundary = JSON.parse(raw) as {
      data: { scope: { callerOwns: string[]; forbiddenInPier: string[] } };
    };
    emptyCallerBoundary.data.scope.callerOwns = [];
    emptyCallerBoundary.data.scope.forbiddenInPier = [];
    expect(() => parseScheme(JSON.stringify(emptyCallerBoundary))).toThrow(
      "必须是非空字符串数组",
    );

    const synonymBypass = JSON.parse(raw) as { data: { architecture: { notes: string[] } } };
    synonymBypass.data.architecture.notes.push(
      "Pier 管理目标分解和任务队列，编排 WorkItem，运行任务看板并输出 Result",
    );
    expect(() => parseScheme(JSON.stringify(synonymBypass))).toThrow(
      "架构支撑表越过产品边界",
    );

    const contrastBypass = JSON.parse(raw) as { data: { architecture: { notes: string[] } } };
    contrastBypass.data.architecture.notes.push(
      "Pier 不保存一般日志，但 Pier 持久化任务台账并推进任务生命周期",
    );
    expect(() => parseScheme(JSON.stringify(contrastBypass))).toThrow(
      "架构支撑表越过产品边界",
    );
  });

  it.each([
    {
      name: "阶段结果",
      mutate: (value: {
        data: { phases: Array<{ outcome: string }> };
      }) => {
        value.data.phases[5].outcome = "建立任务台账并自动调度智能体";
      },
    },
    {
      name: "验收证据",
      mutate: (value: {
        data: { acceptance: Array<{ evidence: string }> };
      }) => {
        value.data.acceptance[0].evidence = "Pier 持久化任务台账并展示工作看板";
      },
    },
    {
      name: "硬约束",
      mutate: (value: {
        data: { hardConstraints: Array<{ text: string }> };
      }) => {
        value.data.hardConstraints[0].text = "Pier 持久化任务台账并展示工作看板";
      },
    },
    {
      name: "安全护栏",
      mutate: (value: {
        data: { safetyRails: string[] };
      }) => {
        value.data.safetyRails[0] = "Pier 持久化任务台账并展示工作看板";
      },
    },
  ])("$name 不能因字段分类而绕过边界门禁", async ({ mutate }) => {
    const raw = await readFile(new URL("./data.json", import.meta.url), "utf8");
    const injected = JSON.parse(raw);
    mutate(injected);

    expect(() => parseScheme(JSON.stringify(injected))).toThrow("架构支撑表越过产品边界");
  });

  it.each([
    {
      name: "首屏结论中的后置 Pier 主体",
      mutate: (value: { data: { bluf: string } }) => {
        value.data.bluf = "任务生命周期、任务台账、工作看板、自动调度与完成权全部由 Pier 持有";
      },
    },
    {
      name: "外部所有权行中的后置 Pier 主体",
      mutate: (value: {
        data: { ownership: Array<{ owns: string }> };
      }) => {
        value.data.ownership[0].owns =
          "任务生命周期、任务台账、工作看板、自动调度与完成权全部由 Pier 持有";
      },
    },
    {
      name: "外部状态机中的后置 Pier 主体",
      mutate: (value: {
        data: { stateMachines: Array<{ path: string }> };
      }) => {
        value.data.stateMachines[0].path = "任务生命周期和任务台账改由 Pier 创建";
      },
    },
    {
      name: "架构图中的后置 Pier 节点",
      mutate: (value: { data: { architecture: { diagram: string } } }) => {
        value.data.architecture.diagram = "flowchart LR\nT[任务生命周期与任务台账] --> P[Pier 持有]";
      },
    },
  ])("$name 不能利用词序反转绕过外部上下文门禁", async ({ mutate }) => {
    const raw = await readFile(new URL("./data.json", import.meta.url), "utf8");
    const injected = JSON.parse(raw);
    mutate(injected);

    expect(() => parseScheme(JSON.stringify(injected))).toThrow("架构支撑表越过产品边界");
  });

  it.each([
    {
      name: "首屏结论中的后置宿主主体",
      mutate: (value: { data: { bluf: string } }) => {
        value.data.bluf = "任务生命周期、任务台账、工作看板、自动调度与完成权全部由宿主持有";
      },
    },
    {
      name: "外部所有权行中的后置本产品主体",
      mutate: (value: {
        data: { ownership: Array<{ owns: string }> };
      }) => {
        value.data.ownership[0].owns =
          "任务生命周期、任务台账、工作看板、自动调度与完成权全部由本产品持有";
      },
    },
    {
      name: "外部状态机中的后置宿主主体",
      mutate: (value: {
        data: { stateMachines: Array<{ path: string }> };
      }) => {
        value.data.stateMachines[0].path = "任务生命周期和任务台账改由宿主创建";
      },
    },
    {
      name: "架构图中的后置本产品主体",
      mutate: (value: { data: { architecture: { diagram: string } } }) => {
        value.data.architecture.diagram =
          "flowchart LR\nT[任务生命周期与任务台账] --> P[本产品持有]";
      },
    },
  ])("$name 不能利用主体别名绕过外部上下文门禁", async ({ mutate }) => {
    const raw = await readFile(new URL("./data.json", import.meta.url), "utf8");
    const injected = JSON.parse(raw);
    mutate(injected);

    expect(() => parseScheme(JSON.stringify(injected))).toThrow("架构支撑表越过产品边界");
  });
});

describe("closed-loop 阶段契约", () => {
  it("接受 pack 约定的 wave、name、outcome、status 与 slices 结构", async () => {
    const schema = await loadExpectedModule<PhaseSchemaModule>("./phase-schema.ts", "phase-schema");

    expect(schema, "需要新增纯函数模块 phase-schema.ts").toBeDefined();
    if (!schema) {
      return;
    }

    const phase = {
      wave: 1,
      name: "宿主监督边界",
      outcome: "外部编排器持有任务生命周期，Pier 仅提供运行监督能力",
      status: "planned" as const,
      slices: [{ id: "S1", title: "建立只读运行快照" }],
    };

    expect(schema.parseClosedLoopPhase(phase)).toEqual(phase);
  });

  it.each([
    {
      name: "仅含 files 与 verify 的旧结构",
      value: {
        wave: 1,
        name: "旧阶段",
        outcome: "不应通过",
        files: "src/**",
        verify: "pnpm test",
      },
    },
    {
      name: "在 slices 旁保留 files 与 verify",
      value: {
        wave: 1,
        name: "混合阶段",
        outcome: "不应通过",
        status: "planned",
        slices: [{ id: "S1", title: "正确切片" }],
        files: "src/**",
        verify: "pnpm test",
      },
    },
    {
      name: "切片缺少 title",
      value: {
        wave: 1,
        name: "不完整阶段",
        outcome: "不应通过",
        status: "planned",
        slices: [{ id: "S1" }],
      },
    },
    {
      name: "缺少 status",
      value: {
        wave: 1,
        name: "无状态阶段",
        outcome: "不应通过",
        slices: [{ id: "S1", title: "正确切片" }],
      },
    },
  ])("拒绝 $name", async ({ value }) => {
    const schema = await loadExpectedModule<PhaseSchemaModule>("./phase-schema.ts", "phase-schema");

    expect(schema, "需要新增纯函数模块 phase-schema.ts").toBeDefined();
    if (!schema) {
      return;
    }

    expect(() => schema.parseClosedLoopPhase(value)).toThrow();
  });
});

describe("状态展示契约", () => {
  it("为内部状态返回统一的中文产品标签", async () => {
    const presentation = await loadExpectedModule<StatusPresentationModule>(
      "./status-presentation.ts",
      "status-presentation",
    );

    expect(presentation, "需要新增纯函数模块 status-presentation.ts").toBeDefined();
    if (!presentation) {
      return;
    }

    expect(
      ["blocked", "planned", "verified"].map((status) => presentation.presentStatus(status)),
    ).toEqual([
      { label: "已阻塞", tone: "warning" },
      { label: "待实现", tone: "warning" },
      { label: "已核对", tone: "success" },
    ]);

    expect(
      ["shipped", "partial", "in_progress", "done"].map((status) =>
        presentation.presentStatus(status),
      ),
    ).toEqual([
      { label: "已实现", tone: "success" },
      { label: "部分可用", tone: "info" },
      { label: "进行中", tone: "info" },
      { label: "已完成", tone: "success" },
    ]);

    for (const status of ["unmapped_internal_state", "future_状态"]) {
      expect(presentation.presentStatus(status)).toEqual({
        label: "状态未知",
        tone: "warning",
      });
    }
  });
});
