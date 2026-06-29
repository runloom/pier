import { join } from "node:path";
import type {
  TaskCandidate,
  TaskCommandSpec,
  TaskInputRequest,
} from "@shared/contracts/tasks.ts";
import { taskCandidate as candidate, optionalEnv } from "./task-candidate.ts";
import {
  asRecord,
  asString,
  asStringArray,
  commandWithArgs,
  parseJsonc,
  readTextIfExists,
} from "./utils.ts";

export interface VscodeSourceOptions {
  projectRoot: string;
}

function normalizeDependsOn(value: unknown): string[] | undefined {
  if (typeof value === "string") {
    return [value];
  }
  if (!Array.isArray(value)) {
    return;
  }
  const values = value.flatMap((item) => {
    if (typeof item === "string") {
      return [item];
    }
    const record = asRecord(item);
    const task = asString(record?.task);
    return task ? [task] : [];
  });
  return values.length > 0 ? values : undefined;
}

function vscodeInputFromRecord(
  record: Record<string, unknown> | null
): TaskInputRequest | null {
  const id = asString(record?.id);
  const type = asString(record?.type);
  if (!(record && id)) {
    return null;
  }
  const defaultValue = asString(record.default);
  const description = asString(record.description);
  if (type === "promptString") {
    return {
      id,
      type,
      ...(defaultValue ? { default: defaultValue } : {}),
      ...(description ? { description } : {}),
    };
  }
  if (type !== "pickString") {
    return null;
  }
  const options = asStringArray(record.options);
  if (options.length === 0) {
    return null;
  }
  return {
    id,
    options,
    type,
    ...(defaultValue ? { default: defaultValue } : {}),
    ...(description ? { description } : {}),
  };
}

function vscodeInputs(raw: unknown): TaskInputRequest[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap((item) => {
    const input = vscodeInputFromRecord(asRecord(item));
    return input ? [input] : [];
  });
}

function presentationFromVscode(value: unknown): TaskCandidate["presentation"] {
  const record = asRecord(value);
  if (!record) {
    return;
  }
  const reveal = asString(record.reveal);
  return {
    ...(typeof record.clear === "boolean" ? { clear: record.clear } : {}),
    ...(typeof record.echo === "boolean" ? { showCommand: record.echo } : {}),
    ...(reveal === "always" || reveal === "silent" || reveal === "never"
      ? { reveal }
      : {}),
    ...(reveal === "never" ? { focus: false } : {}),
  };
}

function groupFromVscode(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  return asString(asRecord(value)?.kind);
}

function vscodeCommandSpec(
  command: string | undefined,
  type: string,
  args: readonly string[]
): TaskCommandSpec | null {
  if (!command) {
    return null;
  }
  if (type === "process") {
    return { args: [...args], command, kind: "process" };
  }
  return { command: commandWithArgs(command, args), kind: "shell" };
}

function unsupportedVscodeReason(
  commandSpec: TaskCommandSpec | null,
  type: string
): string | undefined {
  if (!commandSpec) {
    return "任务缺少 command";
  }
  if (type === "shell" || type === "process") {
    return;
  }
  return `不支持 VS Code 扩展任务类型: ${type}`;
}

function vscodeTaskFromRecord(
  item: unknown,
  projectRoot: string,
  inputs: readonly TaskInputRequest[]
): TaskCandidate | null {
  const record = asRecord(item);
  const label = asString(record?.label);
  if (!(record && label)) {
    return null;
  }
  const type = asString(record.type) ?? "shell";
  const args = asStringArray(record.args);
  const options = asRecord(record.options);
  const commandSpec = vscodeCommandSpec(asString(record.command), type, args);
  const dependsOn = normalizeDependsOn(record.dependsOn);
  const description = asString(record.detail);
  const env = optionalEnv(options?.env);
  const group = groupFromVscode(record.group);
  const presentation = presentationFromVscode(record.presentation);
  const unsupportedReason = unsupportedVscodeReason(commandSpec, type);
  return candidate({
    commandSpec: commandSpec ?? { command: label, kind: "shell" },
    cwd: asString(options?.cwd) ?? projectRoot,
    ...(dependsOn ? { dependsOn } : {}),
    dependsOrder: record.dependsOrder === "parallel" ? "parallel" : "sequence",
    ...(description ? { description } : {}),
    ...(env ? { env } : {}),
    ...(group ? { group } : {}),
    idParts: ["vscode", label],
    inputs: [...inputs],
    label,
    ...(presentation ? { presentation } : {}),
    source: "vscode",
    ...(unsupportedReason ? { unsupportedReason } : {}),
  });
}

export async function vscodeSource({
  projectRoot,
}: VscodeSourceOptions): Promise<TaskCandidate[]> {
  const text = await readTextIfExists(
    join(projectRoot, ".vscode", "tasks.json")
  );
  if (!text) {
    return [];
  }
  const root = asRecord(parseJsonc(text));
  const tasks = Array.isArray(root?.tasks) ? root.tasks : [];
  const inputs = vscodeInputs(root?.inputs);
  return tasks.flatMap((item) => {
    const task = vscodeTaskFromRecord(item, projectRoot, inputs);
    return task ? [task] : [];
  });
}
