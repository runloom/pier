import { AGENT_CATALOG } from "@shared/agent-catalog.ts";
import { agentKindSchema } from "@shared/contracts/agent.ts";
import { describe, expect, it } from "vitest";
import { CLAUDE_HOOK_EVENTS } from "../../../src/main/services/agents/integrations/claude.ts";
import { CLAUDE_TRANSCRIPT_TERMINAL_EVIDENCE } from "../../../src/main/services/agents/integrations/claude-transcript-reconciler.ts";
import { CLINE_HOOK_EVENTS } from "../../../src/main/services/agents/integrations/cline.ts";
import { CODEX_HOOK_EVENTS } from "../../../src/main/services/agents/integrations/codex.ts";
import {
  CODEX_TRANSCRIPT_INTERACTION_EVIDENCE,
  CODEX_TRANSCRIPT_TERMINAL_EVIDENCE,
} from "../../../src/main/services/agents/integrations/codex-transcript-reconciler.ts";
import {
  AGENT_STATUS_EVIDENCE,
  type AgentStatusEvidenceDimension,
  evidenceDimensionsForEventMappings,
} from "../../../src/main/services/agents/integrations/evidence-matrix.ts";
import { AGENT_STATUS_EVIDENCE_ROWS_A } from "../../../src/main/services/agents/integrations/evidence-matrix-rows-a.ts";
import { AGENT_STATUS_EVIDENCE_ROWS_B } from "../../../src/main/services/agents/integrations/evidence-matrix-rows-b.ts";
import { GROK_TRANSCRIPT_TERMINAL_EVIDENCE } from "../../../src/main/services/agents/integrations/grok-transcript-reconciler.ts";
import { AGENT_HOOK_INTEGRATIONS } from "../../../src/main/services/agents/integrations/registry.ts";

const ALL_EVIDENCE_DIMENSIONS: readonly AgentStatusEvidenceDimension[] = [
  "lifecycle",
  "ready",
  "processing",
  "tool",
  "waiting",
  "error",
  "completed",
  "interrupted",
  "subagent",
];

const KNOWN_UPSTREAM_LOCATORS = {
  autohand: {
    kind: "source-commit",
    commit: "8595299fa7c2cb2f63715b03c48e39f26c6e2f7e",
  },
  codex: {
    kind: "source-commit",
    commit: "a4d2f3102249a94835e96910a3649a830182813e",
  },
  cline: {
    kind: "source-commit",
    commit: "912c4678180854399e9b20106311dd763396c775",
  },
  crush: {
    kind: "source-commit",
    commit: "b83944c45805a4b7abcf3e245acddb8e58294972",
  },
  continue: {
    kind: "source-commit",
    commit: "5522c6f44ca0ac3528b37244818fbfa39b5af470",
  },
  gemini: {
    kind: "source-commit",
    commit: "3499c84f7b8e70c86600e7cd2c67a7c65a667f5e",
  },
  goose: {
    kind: "source-commit",
    commit: "8b73e1a1b6b9e960304fdf9b25ea2f8cec4329a8",
  },
  grok: { kind: "installed-version", version: "0.2.114" },
  hermes: {
    kind: "source-commit",
    commit: "cbecd72e976a59e4c4b8277086abaa59ab3dc510",
  },
  kilo: {
    kind: "source-commit",
    commit: "c0ebf987789ab6fa070106219ebc8c46cd0105af",
  },
  kimi: {
    kind: "source-commit",
    commit: "4a550effdfcb29a25a5d325bf935296cc50cd417",
  },
  "mimo-code": {
    kind: "source-commit",
    commit: "c045a9891069000b112079bb10bdc8828d75eb6e",
  },
  "mistral-vibe": {
    kind: "source-commit",
    commit: "89350a4064ca90e4732271dcc27688e5d684871d",
  },
  omp: {
    kind: "source-commit",
    commit: "cc00ab161b2721e50d8a96a0dc9552abfd258b8b",
  },
  opencode: {
    kind: "source-commit",
    commit: "e8b09927889ba4b5b7fc74bbab5b864d205406ca",
  },
  openclaude: {
    kind: "source-commit",
    commit: "c2030bbb2bd62fc56a8dd58748e039682e05aa97",
  },
  openclaw: {
    kind: "source-commit",
    commit: "b4d14d78480650860423964b4b450e8a3f878150",
  },
  pi: {
    kind: "source-commit",
    commit: "0c32e83a352a4284133b2544f730a23814948ac3",
  },
} as const;

describe("agent status evidence matrix", () => {
  it("covers exactly the AgentKind and catalog sets", () => {
    const matrixIds = Object.keys(AGENT_STATUS_EVIDENCE).sort();
    const agentKindIds = [...agentKindSchema.options].sort();
    const catalogIds = AGENT_CATALOG.map((entry) => entry.id).sort();

    expect(matrixIds).toEqual(agentKindIds);
    expect(matrixIds).toEqual(catalogIds);
  });

  it("requires every evidence dimension and upstream provenance explicitly", () => {
    for (const [agentId, evidence] of Object.entries(AGENT_STATUS_EVIDENCE)) {
      expect(Object.keys(evidence.evidence).sort(), agentId).toEqual(
        [...ALL_EVIDENCE_DIMENSIONS].sort()
      );
      expect(evidence.upstream.officialEvidenceUrl, agentId).toMatch(/^https:/);
      expect(
        new URL(evidence.upstream.officialEvidenceUrl).pathname,
        agentId
      ).not.toBe("/");
    }
  });

  it("Mistral Vibe 使用固定提交下真实存在的 hooks 源码证据", () => {
    expect(
      AGENT_STATUS_EVIDENCE["mistral-vibe"].upstream.officialEvidenceUrl
    ).toBe(
      "https://github.com/mistralai/mistral-vibe/blob/89350a4064ca90e4732271dcc27688e5d684871d/vibe/core/hooks/models.py"
    );
  });

  it("keeps matrix rows mutually exclusive before aggregation", () => {
    const rowAIds = new Set(Object.keys(AGENT_STATUS_EVIDENCE_ROWS_A));
    for (const id of Object.keys(AGENT_STATUS_EVIDENCE_ROWS_B)) {
      expect(rowAIds.has(id), id).toBe(false);
    }
  });

  it("models combined transports explicitly", () => {
    expect(AGENT_STATUS_EVIDENCE.claude.transport).toEqual([
      "hook-command",
      "transcript-reconciler",
    ]);
  });

  it("aligns Claude facts with its installed hook map and sole reconciled interrupt", () => {
    const claude = AGENT_STATUS_EVIDENCE.claude;
    const declaredHookMappings = CLAUDE_HOOK_EVENTS.flatMap((event) =>
      (event.emittedPierEvents ?? [event.pierEvent]).map((pierEvent) => ({
        nativeEvent: event.nativeEvent,
        pierEvent,
      }))
    );
    expect(claude.evidence.completed).toBe("unsupported");
    expect(claude.evidence.interrupted).toBe("reconciled");
    expect(claude.eventMappings).not.toContainEqual(
      expect.objectContaining({ pierEvent: "TurnCompleted" })
    );
    for (const mapping of claude.eventMappings.filter(
      (entry) => entry.level === "native"
    )) {
      expect(declaredHookMappings).toContainEqual(
        expect.objectContaining({
          nativeEvent: mapping.nativeEvent,
          pierEvent: mapping.pierEvent,
        })
      );
    }
    expect(CLAUDE_TRANSCRIPT_TERMINAL_EVIDENCE).toEqual([
      {
        nativeEvent: "claude.transcript.user_interrupt",
        pierEvent: "TurnInterrupted",
      },
    ]);
    expect(claude.eventMappings).toContainEqual(
      expect.objectContaining({
        level: "reconciled",
        nativeEvent: "claude.transcript.user_interrupt",
        pierEvent: "TurnInterrupted",
      })
    );
  });

  it("Claude 系不把 PreToolUse 或无完整结果的事件伪装为 waiting", () => {
    for (const agentId of ["claude", "openclaude"] as const) {
      const integration = AGENT_HOOK_INTEGRATIONS.find(
        (entry) => entry.id === agentId
      );
      expect(
        integration?.runtime.emittedMappings.filter(
          (mapping) => mapping.nativeEvent === "PreToolUse"
        ),
        agentId
      ).toEqual([{ nativeEvent: "PreToolUse", pierEvent: "ToolStart" }]);
      expect(
        integration?.runtime.emittedMappings.some(
          ({ nativeEvent, pierEvent }) =>
            ["PermissionRequest", "Elicitation", "ElicitationResult"].includes(
              nativeEvent
            ) ||
            pierEvent === "InteractionRequested" ||
            pierEvent === "InteractionResolved"
        ),
        agentId
      ).toBe(false);
      expect(
        integration?.runtime.emittedMappings.filter(
          (mapping) => mapping.nativeEvent === "Stop"
        ),
        agentId
      ).toEqual([{ nativeEvent: "Stop", pierEvent: "Stop" }]);
    }
    expect(
      Reflect.get(
        CLAUDE_HOOK_EVENTS.find(
          (event) => event.nativeEvent === "PreToolUse"
        ) ?? {},
        "emittedPierEvents"
      )
    ).toBeUndefined();
  });

  it("Codex waiting 只归 transcript 对账所有，hook 不重复建立权限等待", () => {
    const codex = AGENT_STATUS_EVIDENCE.codex;
    expect(codex.evidence.waiting).toBe("reconciled");
    expect(
      codex.eventMappings.filter(({ dimension }) => dimension === "waiting")
    ).toEqual([
      expect.objectContaining({
        level: "reconciled",
        nativeEvent: "codex.transcript.request_user_input",
        pierEvent: "InteractionRequested",
      }),
      expect.objectContaining({
        level: "reconciled",
        nativeEvent: "codex.transcript.request_user_input.output",
        pierEvent: "InteractionResolved",
      }),
      expect.objectContaining({
        level: "reconciled",
        nativeEvent: "codex.transcript.request_permissions",
        pierEvent: "InteractionRequested",
      }),
      expect.objectContaining({
        level: "reconciled",
        nativeEvent: "codex.transcript.request_permissions.output",
        pierEvent: "InteractionResolved",
      }),
    ]);
    expect(CODEX_TRANSCRIPT_INTERACTION_EVIDENCE).toHaveLength(4);
    expect(CODEX_HOOK_EVENTS).not.toContainEqual(
      expect.objectContaining({ nativeEvent: "PermissionRequest" })
    );
  });

  it("binds Cline terminal facts to current SDK file events", () => {
    expect(AGENT_STATUS_EVIDENCE.cline.evidence.completed).toBe("native");
    expect(AGENT_STATUS_EVIDENCE.cline.evidence.ready).toBe("native");
    expect(CLINE_HOOK_EVENTS).toContainEqual(
      expect.objectContaining({
        fileName: "TaskComplete",
        pierEvent: "TurnCompleted",
      })
    );
  });

  it("MiMo waiting facts use the v0.1.9 hosted-plugin runtime events", () => {
    const waiting = AGENT_STATUS_EVIDENCE["mimo-code"].eventMappings.filter(
      (mapping) => mapping.dimension === "waiting"
    );
    expect(waiting).toContainEqual(
      expect.objectContaining({
        nativeEvent: "permission.asked",
        pierEvent: "InteractionRequested",
      })
    );
    expect(waiting).toContainEqual(
      expect.objectContaining({
        nativeEvent: "permission.replied",
        pierEvent: "InteractionResolved",
      })
    );
    expect(waiting).not.toContainEqual(
      expect.objectContaining({ nativeEvent: "permission.updated" })
    );
    expect(
      AGENT_STATUS_EVIDENCE["mimo-code"].upstream.officialEvidenceUrl
    ).toBe(
      "https://github.com/XiaomiMiMo/MiMo-Code/blob/c045a9891069000b112079bb10bdc8828d75eb6e/packages/opencode/src/permission/index.ts"
    );
  });

  it("已注册矩阵 facts 与 runtime mappings 规范化后严格等集", () => {
    const normalize = (
      mappings: readonly { nativeEvent: string; pierEvent: string }[]
    ) =>
      [
        ...new Set(
          mappings.map(
            ({ nativeEvent, pierEvent }) => `${nativeEvent}\0${pierEvent}`
          )
        ),
      ].sort();
    const matrixByAgent = Object.fromEntries(
      Object.entries(AGENT_STATUS_EVIDENCE)
        .filter(
          ([, evidence]) =>
            evidence.integration === "active" ||
            evidence.integration === "cleanup-only" ||
            evidence.integration === "retired"
        )
        .map(([agentId, evidence]) => [
          agentId,
          normalize(
            evidence.eventMappings
              .filter((entry) => entry.level === "native")
              .map(({ nativeEvent, pierEvent }) => ({
                nativeEvent,
                pierEvent,
              }))
          ),
        ])
    );
    const runtimeByAgent = Object.fromEntries(
      AGENT_HOOK_INTEGRATIONS.map((integration) => [
        integration.id,
        normalize(integration.runtime.emittedMappings),
      ])
    );
    expect(matrixByAgent).toEqual(runtimeByAgent);
  });

  it("SessionStart 与 SessionEnd 只属于 lifecycle，不冒充 ready", () => {
    for (const [agentId, evidence] of Object.entries(AGENT_STATUS_EVIDENCE)) {
      for (const mapping of evidence.eventMappings.filter(
        ({ pierEvent }) =>
          pierEvent === "SessionStart" || pierEvent === "SessionEnd"
      )) {
        expect(mapping.dimension, `${agentId}:${mapping.nativeEvent}`).toBe(
          "lifecycle"
        );
      }
    }
    for (const [agentId, evidence] of Object.entries(AGENT_STATUS_EVIDENCE)) {
      expect(
        evidence.eventMappings
          .filter(({ dimension }) => dimension === "ready")
          .some(
            ({ pierEvent }) =>
              pierEvent === "SessionStart" || pierEvent === "SessionEnd"
          ),
        agentId
      ).toBe(false);
    }
  });

  it("binds reconciled facts to a reconciler transport and exported reachability", () => {
    expect(AGENT_STATUS_EVIDENCE.codex.transport).toContain(
      "transcript-reconciler"
    );
    expect(AGENT_STATUS_EVIDENCE.grok.transport).toContain(
      "transcript-reconciler"
    );
    for (const [agentId, emittedMappings] of [
      [
        "codex",
        [
          ...CODEX_TRANSCRIPT_TERMINAL_EVIDENCE,
          ...CODEX_TRANSCRIPT_INTERACTION_EVIDENCE,
        ],
      ],
      ["grok", GROK_TRANSCRIPT_TERMINAL_EVIDENCE],
    ] as const) {
      const reconciledMappings = [
        ...new Map(
          AGENT_STATUS_EVIDENCE[agentId].eventMappings
            .filter((entry) => entry.level === "reconciled")
            .map(({ nativeEvent, pierEvent }) => [
              `${nativeEvent}\0${pierEvent}`,
              { nativeEvent, pierEvent },
            ])
        ).values(),
      ];
      expect(
        new Set(
          reconciledMappings.map(
            ({ nativeEvent, pierEvent }) => `${nativeEvent}\0${pierEvent}`
          )
        )
      ).toEqual(
        new Set(
          emittedMappings.map(
            ({ nativeEvent, pierEvent }) => `${nativeEvent}\0${pierEvent}`
          )
        )
      );
    }
  });

  it("以当前 Codex task_complete 作为完成证据，turn_complete 仅作兼容别名", () => {
    expect(CODEX_TRANSCRIPT_TERMINAL_EVIDENCE[0]).toEqual({
      nativeEvent: "codex.transcript.task_complete",
      pierEvent: "TurnCompleted",
    });
    expect(
      AGENT_STATUS_EVIDENCE.codex.eventMappings.find(
        (entry) => entry.dimension === "completed"
      )
    ).toMatchObject({
      nativeEvent: "codex.transcript.task_complete",
      pierEvent: "TurnCompleted",
    });
  });

  it("Amp 的工具能力不支持，等待证据只来自正式 ThreadState", () => {
    expect(AGENT_STATUS_EVIDENCE.amp.evidence.tool).toBe("unsupported");
    expect(AGENT_STATUS_EVIDENCE.amp.evidence.waiting).toBe("native");
    expect(AGENT_STATUS_EVIDENCE.amp.eventMappings).toContainEqual(
      expect.objectContaining({
        dimension: "waiting",
        nativeEvent: "thread.state.awaiting-approval",
        pierEvent: "InteractionRequested",
      })
    );
  });

  it("所有受支持 waiting 都同时具备请求与解除事实", () => {
    for (const [agentId, evidence] of Object.entries(AGENT_STATUS_EVIDENCE)) {
      if (evidence.evidence.waiting === "unsupported") continue;
      const waitingFacts = evidence.eventMappings.filter(
        ({ dimension }) => dimension === "waiting"
      );
      expect(
        waitingFacts.some(
          ({ pierEvent }) => pierEvent === "InteractionRequested"
        ),
        `${agentId}:requested`
      ).toBe(true);
      expect(
        waitingFacts.some(
          ({ pierEvent }) => pierEvent === "InteractionResolved"
        ),
        `${agentId}:resolved`
      ).toBe(true);
    }
  });

  it("uses a discriminated, honest upstream locator for every row", () => {
    for (const [agentId, evidence] of Object.entries(AGENT_STATUS_EVIDENCE)) {
      const source = evidence.upstream;
      expect(source.kind, agentId).toMatch(
        /^(source-commit|installed-version|dated-documentation)$/
      );
      if (source.kind === "source-commit") {
        expect(source.commit, agentId).toMatch(/^[0-9a-f]{7,40}$/);
      } else if (source.kind === "installed-version") {
        expect(source.version, agentId).toMatch(/^v?\d+\.\d+\.\d+/);
      } else {
        expect(source.verifiedOn, agentId).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  it("pins the known audited commits and installed package versions", () => {
    for (const agentId of Object.keys(KNOWN_UPSTREAM_LOCATORS) as Array<
      keyof typeof KNOWN_UPSTREAM_LOCATORS
    >) {
      const expected = KNOWN_UPSTREAM_LOCATORS[agentId];
      expect(AGENT_STATUS_EVIDENCE[agentId].upstream).toMatchObject(expected);
    }
  });

  it("keeps each non-unsupported capability backed by a same-level event mapping", () => {
    for (const [agentId, evidence] of Object.entries(AGENT_STATUS_EVIDENCE)) {
      const mapped = evidenceDimensionsForEventMappings(evidence.eventMappings);
      for (const dimension of ALL_EVIDENCE_DIMENSIONS) {
        const level = evidence.evidence[dimension];
        if (level === "unsupported") {
          continue;
        }
        expect(mapped.get(dimension), `${agentId}:${dimension}`).toContain(
          level
        );
      }
    }
  });

  it("advisory/none Stop 只能是控制事实，不能支撑 ready", () => {
    for (const integration of AGENT_HOOK_INTEGRATIONS) {
      const stopMappings = integration.runtime.emittedMappings.filter(
        (mapping) => mapping.pierEvent === "Stop"
      );
      for (const runtimeMapping of stopMappings) {
        const evidenceMapping = integration.statusEvidence.eventMappings.find(
          (mapping) =>
            mapping.nativeEvent === runtimeMapping.nativeEvent &&
            mapping.pierEvent === runtimeMapping.pierEvent
        );
        expect(
          evidenceMapping,
          `${integration.id}:${runtimeMapping.nativeEvent}`
        ).toBeDefined();
        expect(
          evidenceMapping?.dimension,
          `${integration.id}:${runtimeMapping.nativeEvent}:${integration.runtime.stopAuthority}`
        ).toBe(
          integration.runtime.stopAuthority === "advisory" ||
            integration.runtime.stopAuthority === "none"
            ? "control"
            : "ready"
        );
      }
    }
  });

  it("does not manufacture event mappings for unsupported dimensions", () => {
    for (const [agentId, evidence] of Object.entries(AGENT_STATUS_EVIDENCE)) {
      for (const dimension of ALL_EVIDENCE_DIMENSIONS) {
        if (evidence.evidence[dimension] !== "unsupported") {
          continue;
        }
        expect(
          evidence.eventMappings.some((entry) => entry.dimension === dimension),
          `${agentId}:${dimension}`
        ).toBe(false);
      }
    }
  });

  it("binds every installed integration to its matrix evidence without a fallback", () => {
    for (const integration of AGENT_HOOK_INTEGRATIONS) {
      expect(integration.statusEvidence).toBe(
        AGENT_STATUS_EVIDENCE[integration.id]
      );
      expect(integration.statusEvidence.integration).not.toBe("not-integrated");
    }
  });

  it("非主动项状态、空映射与注册表严格等集", () => {
    const expected = {
      aider: "retired",
      ante: "not-integrated",
      codebuff: "not-integrated",
      continue: "not-integrated",
      kiro: "cleanup-only",
      openclaw: "not-integrated",
      rovo: "not-integrated",
    } as const;
    const registeredIds = new Set(
      AGENT_HOOK_INTEGRATIONS.map((integration) => integration.id)
    );
    for (const [agentId, integrationState] of Object.entries(expected)) {
      const evidence = AGENT_STATUS_EVIDENCE[agentId as keyof typeof expected];
      expect(evidence.integration, agentId).toBe(integrationState);
      expect(evidence.transport, agentId).toEqual(["none"]);
      expect(evidence.eventMappings, agentId).toEqual([]);
      expect(
        Object.values(evidence.evidence).every(
          (level) => level === "unsupported"
        ),
        agentId
      ).toBe(true);
      expect(registeredIds.has(agentId as never), agentId).toBe(
        integrationState !== "not-integrated"
      );
    }
    for (const agentId of ["aider", "kiro"] as const) {
      const integration = AGENT_HOOK_INTEGRATIONS.find(
        (entry) => entry.id === agentId
      );
      expect(integration?.runtime, agentId).toEqual({
        emittedMappings: [],
        stopAuthority: "none",
      });
    }
  });

  it("does not expose the retired binary capability tier", () => {
    for (const integration of AGENT_HOOK_INTEGRATIONS) {
      expect("capability" in integration, integration.id).toBe(false);
    }
  });
});
