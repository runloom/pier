import { homedir } from "node:os";
import { join } from "node:path";
import type {
  TaskCandidate,
  TaskListResult,
  TaskRecentEntry,
  TaskSource,
  TaskSourceError,
} from "@shared/contracts/tasks.ts";
import { composerSource } from "./composer-source.ts";
import { denoSource } from "./deno-source.ts";
import {
  taskCandidate as candidate,
  optionalEnv,
  optionalTags,
} from "./task-candidate.ts";
import {
  asRecord,
  asString,
  asStringArray,
  commandWithArgs,
  packageManagerFor,
  parseJsonc,
  pathExists,
  readTextIfExists,
} from "./utils.ts";
import { vscodeSource } from "./vscode-source.ts";

export interface CollectTaskCandidatesOptions {
  homeDir?: string;
  projectId: string;
  /** filesystem path of the project root (was `projectRoot`). */
  projectRoot: string;
  recentTasks?: readonly TaskRecentEntry[];
}

export interface TaskSourceProvider {
  id: TaskSource;
  list(
    options: CollectTaskCandidatesOptions
  ): Promise<TaskCandidate[]> | TaskCandidate[];
}

const LINE_SPLIT_RE = /\r?\n/;
const SAFE_TOML_SECTION_RE = /^\[([^\]]+)\]$/;
const SAFE_TOML_ENTRY_RE = /^([A-Za-z0-9_.-]+)\s*=\s*"([^"]+)"\s*$/;
const TASKFILE_ROOT_RE = /^tasks:\s*$/;
// 任务名允许命名空间冒号 (docs:build), 缩进宽度以块内首个任务为准。
const TASKFILE_NAME_RE =
  /^(\s+)([A-Za-z0-9_.-]+(?::[A-Za-z0-9_.-]+)*):\s*(?:#.*)?$/;
const LEADING_WHITESPACE_RE = /^\s/;
const JUST_PRIVATE_ATTR_RE = /^\[[^\]]*private[^\]]*\]$/;
const JUST_RECIPE_RE = /^([A-Za-z0-9_.-]+)(?:\s+[^:=]+)?\s*:(?!=)/;

async function packageScriptSource({
  projectRoot,
}: CollectTaskCandidatesOptions): Promise<TaskCandidate[]> {
  const packageJson = await readTextIfExists(join(projectRoot, "package.json"));
  if (!packageJson) {
    return [];
  }
  const parsed = asRecord(JSON.parse(packageJson));
  const scripts = asRecord(parsed?.scripts);
  if (!scripts) {
    return [];
  }
  const manager = await packageManagerFor(projectRoot);
  return Object.entries(scripts)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([name, script]) =>
      candidate({
        commandSpec: {
          command: commandWithArgs(manager, ["run", name]),
          kind: "shell",
        },
        cwd: projectRoot,
        description: script,
        idParts: ["package-script", name],
        label: name,
        source: "package-script",
        tags: ["package", manager],
      })
    );
}

function zedTaskFromRecord(
  record: Record<string, unknown>,
  projectRoot: string,
  sourceKey: string
): TaskCandidate | null {
  const label = asString(record.label);
  const command = asString(record.command);
  if (!(label && command)) {
    return null;
  }
  const args = asStringArray(record.args);
  const cwd = asString(record.cwd) ?? projectRoot;
  const reveal = asString(record.reveal);
  const hide = record.hide === true;
  const allowConcurrent = record.allow_concurrent_runs === true;
  const env = optionalEnv(record.env);
  const tags = optionalTags(record.tags);
  return candidate({
    commandSpec: { command: commandWithArgs(command, args), kind: "shell" },
    concurrencyPolicy: allowConcurrent ? "allow-concurrent" : "dedupe",
    cwd,
    ...(env ? { env } : {}),
    hidden: hide,
    idParts: ["zed", sourceKey, label],
    label,
    presentation: {
      ...(record.show_command === true ? { showCommand: true } : {}),
      ...(record.show_summary === true ? { showSummary: true } : {}),
      ...(hide ? { focus: false } : {}),
      ...(reveal === "always" || reveal === "silent" || reveal === "never"
        ? { reveal }
        : {}),
    },
    source: "zed",
    ...(tags ? { tags } : {}),
  });
}

async function zedFileTasks(
  filePath: string,
  projectRoot: string,
  sourceKey: string
): Promise<TaskCandidate[]> {
  const text = await readTextIfExists(filePath);
  if (!text) {
    return [];
  }
  const parsed = parseJsonc(text);
  const list = Array.isArray(parsed) ? parsed : asRecord(parsed)?.tasks;
  if (!Array.isArray(list)) {
    return [];
  }
  return list.flatMap((item) => {
    const record = asRecord(item);
    const task = record
      ? zedTaskFromRecord(record, projectRoot, sourceKey)
      : null;
    return task ? [task] : [];
  });
}

async function zedSource(
  options: CollectTaskCandidatesOptions
): Promise<TaskCandidate[]> {
  const home = options.homeDir ?? homedir();
  const projectTasks = await zedFileTasks(
    join(options.projectRoot, ".zed", "tasks.json"),
    options.projectRoot,
    "project"
  );
  const globalTasks = await zedFileTasks(
    join(home, ".config", "zed", "tasks.json"),
    options.projectRoot,
    "global"
  );
  return [...projectTasks, ...globalTasks];
}

async function cargoSource({
  projectRoot,
}: CollectTaskCandidatesOptions): Promise<TaskCandidate[]> {
  if (!(await pathExists(join(projectRoot, "Cargo.toml")))) {
    return [];
  }
  const builtin = ["build", "test", "check", "run"].map((name) =>
    candidate({
      commandSpec: { command: `cargo ${name}`, kind: "shell" },
      cwd: projectRoot,
      idParts: ["cargo", name],
      label: `cargo ${name}`,
      source: "cargo",
      tags: ["rust"],
    })
  );
  // .cargo/config.toml 的 [alias] 自定义子命令 (cargo <alias>)。
  const config =
    (await readTextIfExists(join(projectRoot, ".cargo", "config.toml"))) ??
    (await readTextIfExists(join(projectRoot, ".cargo", "config")));
  const aliases = config ? tomlSectionEntries(config, "alias") : {};
  const aliasTasks = Object.entries(aliases).map(([name, expansion]) =>
    candidate({
      commandSpec: { command: `cargo ${name}`, kind: "shell" },
      cwd: projectRoot,
      description: `cargo ${expansion}`,
      idParts: ["cargo", "alias", name],
      label: `cargo ${name}`,
      source: "cargo",
      tags: ["rust"],
    })
  );
  return [...builtin, ...aliasTasks];
}

async function makeSource({
  projectRoot,
}: CollectTaskCandidatesOptions): Promise<TaskCandidate[]> {
  const names = ["Makefile", "makefile", "GNUmakefile"];
  const file = (
    await Promise.all(
      names.map((name) => readTextIfExists(join(projectRoot, name)))
    )
  ).find((text): text is string => typeof text === "string");
  if (!file) {
    return [];
  }
  const targets = [...file.matchAll(/^([A-Za-z0-9_.-]+)\s*:(?![=])/gm)]
    .map((match) => match[1])
    .filter(
      (name): name is string =>
        typeof name === "string" && !name.startsWith(".")
    );
  return [...new Set(targets)].map((name) =>
    candidate({
      commandSpec: { command: commandWithArgs("make", [name]), kind: "shell" },
      cwd: projectRoot,
      idParts: ["make", name],
      label: name,
      source: "make",
    })
  );
}

function tomlSectionEntries(
  text: string,
  section: string
): Record<string, string> {
  const lines = text.split(LINE_SPLIT_RE);
  const entries: Record<string, string> = {};
  let active = false;
  for (const line of lines) {
    const trimmed = line.trim();
    const sectionMatch = trimmed.match(SAFE_TOML_SECTION_RE);
    if (sectionMatch) {
      active = sectionMatch[1] === section;
      continue;
    }
    if (!active || trimmed.startsWith("#")) {
      continue;
    }
    const entryMatch = trimmed.match(SAFE_TOML_ENTRY_RE);
    if (entryMatch?.[1] && entryMatch[2]) {
      entries[entryMatch[1]] = entryMatch[2];
    }
  }
  return entries;
}

async function pyprojectSource({
  projectRoot,
}: CollectTaskCandidatesOptions): Promise<TaskCandidate[]> {
  const text = await readTextIfExists(join(projectRoot, "pyproject.toml"));
  if (!text) {
    return [];
  }
  const scripts = {
    ...tomlSectionEntries(text, "project.scripts"),
    ...tomlSectionEntries(text, "tool.poetry.scripts"),
    ...tomlSectionEntries(text, "tool.pdm.scripts"),
  };
  return Object.entries(scripts).map(([name, target]) =>
    candidate({
      commandSpec: { command: name, kind: "shell" },
      cwd: projectRoot,
      description: target,
      idParts: ["pyproject", name],
      label: name,
      source: "pyproject",
      tags: ["python"],
    })
  );
}

async function miseSource({
  projectRoot,
}: CollectTaskCandidatesOptions): Promise<TaskCandidate[]> {
  const text =
    (await readTextIfExists(join(projectRoot, ".mise.toml"))) ??
    (await readTextIfExists(join(projectRoot, "mise.toml")));
  if (!text) {
    return [];
  }
  // 段名任务两种写法: [tasks.build] 与带引号的 [tasks."docs:build"]。
  const names = [
    ...text.matchAll(/^\[tasks\.([A-Za-z0-9_.-]+)\]\s*$/gm),
    ...text.matchAll(/^\[tasks\."([^"]+)"\]\s*$/gm),
  ].flatMap((match) => (match[1] ? [match[1]] : []));
  const inlineTasks = Object.keys(tomlSectionEntries(text, "tasks"));
  return [...new Set([...names, ...inlineTasks])]
    .filter((name): name is string => typeof name === "string")
    .map((name) =>
      candidate({
        commandSpec: {
          command: commandWithArgs("mise", ["run", name]),
          kind: "shell",
        },
        cwd: projectRoot,
        idParts: ["mise", name],
        label: name,
        source: "mise",
      })
    );
}

async function justSource({
  projectRoot,
}: CollectTaskCandidatesOptions): Promise<TaskCandidate[]> {
  const text =
    (await readTextIfExists(join(projectRoot, "Justfile"))) ??
    (await readTextIfExists(join(projectRoot, "justfile")));
  if (!text) {
    return [];
  }
  // 逐行扫描而非全文 matchAll: 需要排除赋值行 (alias/set/export 的 `:=`)
  // 和被 [private] 属性标记的 recipe。
  const recipes: string[] = [];
  let privatePending = false;
  for (const line of text.split(LINE_SPLIT_RE)) {
    const trimmed = line.trim();
    if (JUST_PRIVATE_ATTR_RE.test(trimmed)) {
      privatePending = true;
      continue;
    }
    const match = line.match(JUST_RECIPE_RE);
    if (!match?.[1] || line.includes(":=")) {
      if (trimmed.length > 0 && !trimmed.startsWith("#")) {
        privatePending = false;
      }
      continue;
    }
    if (privatePending || match[1].startsWith("_")) {
      privatePending = false;
      continue;
    }
    recipes.push(match[1]);
  }
  return [...new Set(recipes)]
    .filter((name): name is string => typeof name === "string")
    .map((name) =>
      candidate({
        commandSpec: {
          command: commandWithArgs("just", [name]),
          kind: "shell",
        },
        cwd: projectRoot,
        idParts: ["just", name],
        label: name,
        source: "just",
      })
    );
}

function taskfileNames(text: string): string[] {
  const lines = text.split(LINE_SPLIT_RE);
  const names: string[] = [];
  let inTasks = false;
  // 块内首个任务的缩进作为该层级基准 (兼容 2/4 空格或 tab)。
  let taskIndent: null | string = null;
  for (const line of lines) {
    if (TASKFILE_ROOT_RE.test(line)) {
      inTasks = true;
      taskIndent = null;
      continue;
    }
    if (!inTasks) {
      continue;
    }
    // 顶格出现其他 root key (vars:/env:/includes: 等) 即离开 tasks 块,
    // 否则后续块的二级键会被误当成任务。
    if (
      line.length > 0 &&
      !(LEADING_WHITESPACE_RE.test(line) || line.startsWith("#"))
    ) {
      inTasks = false;
      continue;
    }
    const match = line.match(TASKFILE_NAME_RE);
    if (!(match?.[1] && match[2])) {
      continue;
    }
    taskIndent ??= match[1];
    if (match[1] === taskIndent) {
      names.push(match[2]);
    }
  }
  return names;
}

async function taskfileSource({
  projectRoot,
}: CollectTaskCandidatesOptions): Promise<TaskCandidate[]> {
  const text =
    (await readTextIfExists(join(projectRoot, "Taskfile.yml"))) ??
    (await readTextIfExists(join(projectRoot, "Taskfile.yaml")));
  if (!text) {
    return [];
  }
  return taskfileNames(text).map((name) =>
    candidate({
      commandSpec: { command: commandWithArgs("task", [name]), kind: "shell" },
      cwd: projectRoot,
      idParts: ["taskfile", name],
      label: name,
      source: "taskfile",
    })
  );
}

function historySource({
  projectRoot,
  recentTasks = [],
}: CollectTaskCandidatesOptions): Promise<TaskCandidate[]> {
  const tasks = recentTasks
    .filter((entry) => entry.cwd === projectRoot)
    .map((entry) =>
      candidate({
        commandSpec: { command: entry.command, kind: "shell" },
        concurrencyPolicy: "allow-concurrent",
        cwd: entry.cwd,
        idParts: ["history", entry.command],
        label: entry.label,
        source: "history",
      })
    );
  return Promise.resolve(tasks);
}

export const taskSourceProviders: readonly TaskSourceProvider[] = [
  { id: "package-script", list: packageScriptSource },
  { id: "deno", list: denoSource },
  { id: "composer", list: composerSource },
  { id: "vscode", list: vscodeSource },
  { id: "zed", list: zedSource },
  { id: "cargo", list: cargoSource },
  { id: "make", list: makeSource },
  { id: "pyproject", list: pyprojectSource },
  { id: "mise", list: miseSource },
  { id: "just", list: justSource },
  { id: "taskfile", list: taskfileSource },
  { id: "history", list: historySource },
];

export async function collectTaskCandidates(
  options: CollectTaskCandidatesOptions
): Promise<TaskListResult> {
  const results = await Promise.all(
    taskSourceProviders.map(async (provider) => {
      try {
        return {
          provider,
          tasks: await provider.list(options),
        };
      } catch (error) {
        return {
          error: {
            message: error instanceof Error ? error.message : String(error),
            source: provider.id,
          } satisfies TaskSourceError,
          provider,
          tasks: [],
        };
      }
    })
  );
  return {
    errors: results.flatMap((result) => (result.error ? [result.error] : [])),
    projectId: options.projectId,
    projectRootPath: options.projectRoot,
    tasks: results.flatMap((result) => result.tasks),
  };
}
