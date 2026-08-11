/**
 * CLI 用户手册辅助：以 Canvas `.pier/canvases/pier-cli-user-manual/data.json`
 * 为唯一真源；unit 与 multi-agent Canvas 契约共用，避免双写漂移。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

export const CLI_USER_MANUAL_DATA_PATH = join(
  ROOT,
  ".pier/canvases/pier-cli-user-manual/data.json"
);

/** shipped 表面禁止出现的规划/无写权/已撤回命令。 */
const AVAILABLE_VIOLATION_PATTERNS: ReadonlyArray<{ id: string; re: RegExp }> =
  [
    {
      id: "agents.unimplemented",
      re: /^\s*pier\s+agents\s+(self|invoke)\b/mu,
    },
    { id: "access", re: /^\s*pier\s+access\b/mu },
    { id: "snapshot", re: /^\s*pier\s+snapshot\b/mu },
    { id: "watch", re: /^\s*pier\s+watch\b/mu },
    { id: "activity", re: /^\s*pier\s+activity\b/mu },
    { id: "notifications", re: /^\s*pier\s+notifications\b/mu },
    { id: "plugins enable", re: /^\s*pier\s+plugins\s+enable\b/mu },
    { id: "plugins disable", re: /^\s*pier\s+plugins\s+disable\b/mu },
  ];

/**
 * 产品 shipped 必现清单（与 multi-agent gold「当前可用」对齐）。
 * 名称与 Canvas `command.name` 完全一致。
 */
export const REQUIRED_SHIPPED_COMMAND_NAMES = [
  "status",
  "open",
  "windows list",
  "windows focus",
  "panels list",
  "panels focus",
  "terminal open",
  "terminal profiles list|get|set|delete",
  "worktrees list",
  "worktrees create",
  "worktrees open",
  "tasks list",
  "tasks run",
  "tasks status",
  "tasks cancel",
  "preferences read",
  "plugins list",
  "plugins inspect",
  "agents catalog",
  "agents list",
  "agents get",
  "agents start",
  "agents turn",
  "agents screen",
  "agents wait",
  "agents watch",
  "agents focus",
  "agents interrupt",
  "agents terminate",
] as const;

/**
 * 规划 / 实验必现清单（删 md 后防止 Canvas 静默丢命令）。
 * 名称与 Canvas `command.name` 完全一致。
 */
export const REQUIRED_PLANNED_COMMAND_NAMES = [
  "version",
  "capabilities",
  "doctor",
  "snapshot",
  "watch",
  "terminal list",
  "terminal get",
  "terminal send",
  "terminal key",
  "terminal interrupt",
  "terminal terminate",
  "terminal wait",
  "terminal watch",
  "worktrees check",
  "worktrees get",
  "worktrees register",
  "worktrees remove",
  "tasks get",
  "tasks watch",
  "tasks output",
  "tasks stop / rerun",
  "notifications list",
  "notifications get/watch/focus/mark-read",
  "access keygen/status/request/wait/revoke",
  "agents self",
] as const;

export const REQUIRED_BLOCKED_COMMAND_NAMES = [
  "plugins enable",
  "plugins disable",
  "agents invoke",
] as const;

export interface CliManualCommand {
  description: string;
  examples?: string[] | undefined;
  id: string;
  name: string;
  output?: string | undefined;
  status: string;
  synopsis: string;
}

export interface CliManualData {
  agents: {
    intro: string;
    shipped: CliManualCommand[];
    planned: CliManualCommand[];
    blocked?: CliManualCommand[];
  };
  blocked?: { commands: CliManualCommand[] };
  bluf: string;
  context: string;
  domains: {
    id: string;
    label?: string;
    commands: CliManualCommand[];
  }[];
  faq: { q: string; a: string }[];
  goals: string[];
  meta: { title: string; subtitle: string; status: string; version: string };
  nonGoals: string[];
  quickStart: {
    prerequisite: string;
    firstCommands: { title: string; cmd: string; note: string }[];
    binPaths: string[];
  };
  tasks: { id: string; title: string; steps: string[] }[];
}

export interface CliManualPayload {
  data: CliManualData;
  schemaVersion: number;
}

export function readCliUserManualPayload(): CliManualPayload {
  const raw = readFileSync(CLI_USER_MANUAL_DATA_PATH, "utf8");
  const parsed = JSON.parse(raw) as CliManualPayload;
  if (parsed.schemaVersion !== 1 || !parsed.data?.bluf) {
    throw new Error("invalid pier-cli-user-manual data.json");
  }
  return parsed;
}

export function readCliUserManualData(): CliManualData {
  return readCliUserManualPayload().data;
}

/** 所有命令条目（domains + agents shipped/planned/blocked + 顶层 blocked）。 */
export function listCliManualCommands(data: CliManualData): CliManualCommand[] {
  return [
    ...data.domains.flatMap((domain) => domain.commands),
    ...data.agents.shipped,
    ...data.agents.planned,
    ...(data.agents.blocked ?? []),
    ...(data.blocked?.commands ?? []),
  ];
}

export function commandsByName(
  data: CliManualData
): Map<string, CliManualCommand> {
  return new Map(
    listCliManualCommands(data).map((command) => [command.name, command])
  );
}

/**
 * shipped 表面可抄写文本：synopsis / examples / quickStart / task steps。
 * 用于扫描「已实现区不得出现规划命令可执行示例」。
 */
export function collectCliManualShippedSurfaceText(
  data: CliManualData
): string {
  const chunks: string[] = [];
  const pushCommand = (command: CliManualCommand): void => {
    if (command.status !== "shipped") {
      return;
    }
    chunks.push(command.synopsis);
    for (const example of command.examples ?? []) {
      chunks.push(example);
    }
  };
  for (const domain of data.domains) {
    for (const command of domain.commands) {
      pushCommand(command);
    }
  }
  for (const command of data.agents.shipped) {
    pushCommand(command);
  }
  for (const first of data.quickStart.firstCommands) {
    chunks.push(first.cmd);
  }
  for (const task of data.tasks) {
    for (const step of task.steps) {
      chunks.push(step);
    }
  }
  return chunks.join("\n");
}

/** 返回用户手册 shipped 表面中违规命令 id 列表（去重、稳定顺序）。 */
export function collectCliDocsAvailableViolations(
  availableSection: string
): string[] {
  const violations: string[] = [];
  for (const { id, re } of AVAILABLE_VIOLATION_PATTERNS) {
    if (re.test(availableSection)) {
      violations.push(id);
    }
  }
  return violations;
}

/** 校验必现清单：名称存在且 status 匹配；planned/shipped 行须有 synopsis。 */
export function collectInventoryMismatches(data: CliManualData): string[] {
  const byName = commandsByName(data);
  const mismatches: string[] = [];

  for (const name of REQUIRED_SHIPPED_COMMAND_NAMES) {
    const command = byName.get(name);
    if (!command) {
      mismatches.push(`missing shipped: ${name}`);
      continue;
    }
    if (command.status !== "shipped") {
      mismatches.push(`expected shipped, got ${command.status}: ${name}`);
    }
    if (!command.synopsis?.trim()) {
      mismatches.push(`empty synopsis (shipped): ${name}`);
    }
  }

  for (const name of REQUIRED_PLANNED_COMMAND_NAMES) {
    const command = byName.get(name);
    if (!command) {
      mismatches.push(`missing planned: ${name}`);
      continue;
    }
    if (command.status !== "planned") {
      mismatches.push(`expected planned, got ${command.status}: ${name}`);
    }
    if (!command.synopsis?.trim()) {
      mismatches.push(`empty synopsis (planned): ${name}`);
    }
    if (!command.output?.trim()) {
      mismatches.push(`empty output (planned): ${name}`);
    }
  }

  for (const name of REQUIRED_BLOCKED_COMMAND_NAMES) {
    const command = byName.get(name);
    if (!command) {
      mismatches.push(`missing blocked: ${name}`);
      continue;
    }
    if (command.status !== "blocked") {
      mismatches.push(`expected blocked, got ${command.status}: ${name}`);
    }
  }

  return mismatches;
}
