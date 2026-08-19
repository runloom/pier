import { readFileSync } from "node:fs";
import { join } from "node:path";
import { agentKindSchema } from "@shared/contracts/agent.ts";
import { describe, expect, it } from "vitest";
import { OMP_FA_ERROR_REACHABILITY } from "../../../../src/main/services/agents/integrations/omp.ts";
import {
  AGENT_HOOK_INTEGRATIONS,
  getAgentHookIntegration,
} from "../../../../src/main/services/agents/integrations/registry.ts";

interface AuditMapping {
  nativeEvent: string;
  pierEvent: string;
}

function sortedMappings(mappings: readonly AuditMapping[]): AuditMapping[] {
  return [...mappings].sort((left, right) =>
    `${left.nativeEvent}\0${left.pierEvent}`.localeCompare(
      `${right.nativeEvent}\0${right.pierEvent}`
    )
  );
}

function expandAuditMapping(token: string): AuditMapping[] {
  const [nativeSource, pierSource, extra] = token.split("→");
  if (!(nativeSource && pierSource) || extra !== undefined) {
    throw new Error(`无法精确展开审计映射：${token}`);
  }
  const nativeEvents = nativeSource.split("/");
  if (pierSource === "同名") {
    return nativeEvents.map((nativeEvent) => ({
      nativeEvent,
      pierEvent: nativeEvent,
    }));
  }
  const pierEvents = pierSource.split("/");
  if (nativeEvents.length === 1) {
    return pierEvents.map((pierEvent) => ({
      nativeEvent: nativeEvents[0] ?? "",
      pierEvent,
    }));
  }
  if (pierEvents.length === 1) {
    return nativeEvents.map((nativeEvent) => ({
      nativeEvent,
      pierEvent: pierEvents[0] ?? "",
    }));
  }
  if (nativeEvents.length === pierEvents.length) {
    return nativeEvents.map((nativeEvent, index) => ({
      nativeEvent,
      pierEvent: pierEvents[index] ?? "",
    }));
  }
  throw new Error(`无法精确展开审计映射：${token}`);
}

function auditSection(source: string, start: string, end: string): string {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt + start.length);
  if (startAt === -1 || endAt === -1) {
    throw new Error(`审计章节缺失：${start} → ${end}`);
  }
  return source.slice(startAt, endAt);
}

function auditRows(section: string, cellCount: number): Map<string, string[]> {
  const parseRow = (line: string): string[] => {
    let source = line.trim();
    if (source.startsWith("|")) {
      source = source.slice(1);
    }
    if (source.endsWith("|")) {
      source = source.slice(0, -1);
    }
    if (!source.includes("|")) {
      throw new Error(`审计表格行格式错误：${line}`);
    }
    const cells: string[] = [];
    let cell = "";
    for (let index = 0; index < source.length; index += 1) {
      const character = source[index];
      if (character === "\\" && source[index + 1] === "|") {
        cell += "\\|";
        index += 1;
      } else if (character === "|") {
        cells.push(cell.trim());
        cell = "";
      } else {
        cell += character;
      }
    }
    cells.push(cell.trim());
    if (cells.length !== cellCount) {
      throw new Error(`审计表格列数错误：${line}`);
    }
    return cells;
  };
  const lines = section.split("\n");
  const headerIndex = lines.findIndex((line) => {
    try {
      return ["Agent", "Provider"].includes(parseRow(line)[0] ?? "");
    } catch {
      return false;
    }
  });
  if (headerIndex === -1) {
    throw new Error("审计表格缺少表头");
  }
  const parsedRows: string[][] = [];
  for (let index = headerIndex; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (index > headerIndex && line.trim() === "") {
      break;
    }
    parsedRows.push(parseRow(line));
  }
  if (!parsedRows[1]?.every((cell) => /^:?-{3,}:?$/.test(cell))) {
    throw new Error("审计表格缺少合法分隔行");
  }
  const entries = parsedRows
    .slice(2)
    .map((cells) => [cells[0] ?? "", cells] as const);
  const rows = new Map(entries);
  if (rows.size !== entries.length) {
    throw new Error("审计矩阵存在重复行");
  }
  return rows;
}

function mappingsFromAuditCell(cell: string): AuditMapping[] {
  if (cell === "无") {
    return [];
  }
  return sortedMappings(
    cell.split("；").flatMap((entry) => {
      const match = /^`([^`\n]+→[^`\n]+)`$/.exec(entry);
      if (!match?.[1]) {
        throw new Error(`审计映射单元格格式错误：${cell}`);
      }
      return expandAuditMapping(match[1]);
    })
  );
}

function authoritativeStartsFromAuditCell(cell: string): string[] {
  if (cell === "无") {
    return [];
  }
  return cell
    .split("；")
    .map((entry) => {
      const match = /^`([^`:\s]+): authoritative`$/.exec(entry);
      if (!match?.[1]) {
        throw new Error(`审计回合起点权威声明格式错误：${cell}`);
      }
      return match[1];
    })
    .sort();
}

describe("agent hook runtime semantics", () => {
  it("每个 hook 集成都显式声明 Stop 权威等级，且注册表无重复", () => {
    expect(
      new Set(AGENT_HOOK_INTEGRATIONS.map((integration) => integration.id)).size
    ).toBe(AGENT_HOOK_INTEGRATIONS.length);
    expect(
      AGENT_HOOK_INTEGRATIONS.every(
        (integration) => integration.runtime.stopAuthority !== undefined
      )
    ).toBe(true);
  });

  it("锁定经原生事件审计后的 30 个集成分类", () => {
    const expected = {
      advisory: [
        "antigravity",
        "aug",
        "claude",
        "codebuddy",
        "command-code",
        "copilot",
        "cursor",
        "devin",
        "droid",
        "gemini",
        "goose",
        "grok",
        "kimi",
        "mistral-vibe",
        "opencode",
        "openclaude",
        "qodercli",
        "qwen-code",
      ],
      authoritative: ["autohand", "kilo", "mimo-code", "omp", "pi"],
      none: ["aider", "amp", "cline", "crush", "hermes", "kiro"],
    } as const;

    for (const [authority, agentIds] of Object.entries(expected)) {
      expect(
        agentIds.map((agentId) => ({
          agentId,
          authority: getAgentHookIntegration(agentId)?.runtime.stopAuthority,
        }))
      ).toEqual(agentIds.map((agentId) => ({ agentId, authority })));
    }
  });

  it("只有审计过的原生活动起点拥有无关联重开权威", () => {
    const actual = AGENT_HOOK_INTEGRATIONS.flatMap((integration) =>
      integration.runtime.emittedMappings
        .filter((mapping) => mapping.turnStartAuthority === "authoritative")
        .map((mapping) => ({
          agentId: integration.id,
          nativeEvent: mapping.nativeEvent,
          pierEvent: mapping.pierEvent,
        }))
    );

    expect(actual).toEqual([
      {
        agentId: "antigravity",
        nativeEvent: "PreInvocation",
        pierEvent: "processing",
      },
      {
        agentId: "cline",
        nativeEvent: "TaskResume",
        pierEvent: "running",
      },
    ]);
    expect(
      actual.every(({ pierEvent }) =>
        ["processing", "running"].includes(pierEvent)
      )
    ).toBe(true);
  });

  it("审计矩阵与运行时映射及两类 authority 精确一致", () => {
    const audit = readFileSync(
      join(
        process.cwd(),
        "docs/superpowers/specs/2026-07-13-agent-status-adapter-contract-audit.md"
      ),
      "utf8"
    );
    const rows = auditRows(
      auditSection(audit, "## 逐 Agent 事件映射矩阵", "### 仅启动识别"),
      6
    );

    expect([...rows.keys()].sort()).toEqual(
      AGENT_HOOK_INTEGRATIONS.map((integration) => integration.id).sort()
    );

    for (const integration of AGENT_HOOK_INTEGRATIONS) {
      const cells = rows.get(integration.id);
      expect(cells, integration.id).toBeDefined();
      expect(mappingsFromAuditCell(cells?.[3] ?? ""), integration.id).toEqual(
        sortedMappings(
          integration.runtime.emittedMappings.map(
            ({ nativeEvent, pierEvent }) => ({ nativeEvent, pierEvent })
          )
        )
      );
      expect(cells?.[4], `${integration.id}:stopAuthority`).toBe(
        `\`${integration.runtime.stopAuthority}\``
      );
      const documentedStarts = authoritativeStartsFromAuditCell(
        cells?.[5] ?? ""
      );
      const authoritativeStarts = integration.runtime.emittedMappings
        .filter((mapping) => mapping.turnStartAuthority === "authoritative")
        .map((mapping) => mapping.nativeEvent)
        .sort();
      expect(documentedStarts, `${integration.id}:turnStartAuthority`).toEqual(
        authoritativeStarts
      );
    }

    const errorRows = auditRows(
      auditSection(audit, "## FA `error` 可达性", "## 兼容输入边界"),
      4
    );
    expect([...errorRows.keys()].sort()).toEqual([
      "claude（对照）",
      "codex",
      "cursor（2026-07-20）",
      "omp",
    ]);
    const ompErrorRow = errorRows.get("omp");
    expect(ompErrorRow?.[1]).toBe(
      `**A — \`error: ${OMP_FA_ERROR_REACHABILITY}\`**`
    );
    expect(ompErrorRow?.[2]).toBe(
      "`agent_end` 读取最后一条 `assistant` 消息的 `stopReason`；`agent_end.error→error`，`aborted` 仍只映射 `TurnInterrupted`"
    );
    expect(ompErrorRow?.[3]).toBe(
      "`OMP_FA_ERROR_REACHABILITY`；`omp.test.ts` 锁定 `error` / `aborted` / `completed` 分流"
    );
    expect(audit).toContain("| `SessionStart` | 缺席 | `idle` |");
  });

  it("审计解析不忽略表格行、裸映射或额外权威声明", () => {
    const compactRows = auditRows(
      [
        "| Agent | 输入机制 | 档位 | 映射 | Stop | Start |",
        "|---|---|---|---|---|---|",
        "| visible | input | full | `A→x` | none | 无 |",
        "hidden|input|full|`B→y`|none|无|",
      ].join("\n"),
      6
    );
    expect([...compactRows.keys()]).toEqual(["visible", "hidden"]);
    expect(() => mappingsFromAuditCell("`A→x`；B→y")).toThrow();
    expect(() => mappingsFromAuditCell("`A→x`；EXTRA_GARBAGE")).toThrow();
    expect(() =>
      mappingsFromAuditCell("`A→x`；`Stop.active: ready`")
    ).toThrow();
    expect(() => mappingsFromAuditCell("`A→x`；Stop.active->ready")).toThrow();
    expect(() =>
      authoritativeStartsFromAuditCell("`A: authoritative`；`B: advisory`")
    ).toThrow();
  });

  it("通知事件设计记录 omp 与 codex 的现役 Ev5 结论", () => {
    const design = readFileSync(
      join(
        process.cwd(),
        "docs/superpowers/specs/2026-07-19-agent-notification-events-design.md"
      ),
      "utf8"
    );

    expect(design).toContain(
      "| omp → `error` | `agent_end.error→error`，原生可达 |"
    );
    expect(design).toContain(
      "| codex → `error` | 无原生失败映射，明确不支持 |"
    );
    expect(design).not.toContain("omp / codex 实际无效");
    expect(design).not.toContain("omp/codex → `error`");
    expect(design).not.toContain("omp / codex 当前无原生");
  });

  it("launch-only agent 不伪造 hook 运行语义", () => {
    const launchOnly = ["ante", "codebuff", "continue", "rovo", "openclaw"];
    expect(
      agentKindSchema.options.filter(
        (agentId) => getAgentHookIntegration(agentId) === null
      )
    ).toEqual(launchOnly);
  });
});
