import { join } from "node:path";
import type { TaskCandidate } from "@shared/contracts/tasks.ts";
import { taskCandidate as candidate } from "./candidate.ts";
import { commandWithArgs, pathExists, readTextIfExists } from "./utils.ts";

export interface PyprojectSourceOptions {
  projectRootPath: string;
}

const LINE_SPLIT_RE = /\r?\n/;
const SAFE_TOML_SECTION_RE = /^\[([^\]]+)\]$/;
const SAFE_TOML_ENTRY_RE = /^([A-Za-z0-9_.-]+)\s*=\s*"([^"]+)"\s*$/;
const PYTEST_TABLE_RE = /^\[tool\.pytest(?:\.[^\]]*)?\]$/;
const RUFF_TABLE_RE = /^\[tool\.ruff(?:\.[^\]]*)?\]$/;

function uncommentedLines(text: string): string[] {
  return text.split(LINE_SPLIT_RE).flatMap((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith("#") ? [trimmed] : [];
  });
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

function pyprojectTask(
  projectRootPath: string,
  extraId: string,
  label: string,
  command: string,
  description?: string
): TaskCandidate {
  return candidate({
    commandSpec: { command, kind: "shell" },
    cwd: projectRootPath,
    ...(description ? { description } : {}),
    idParts: ["pyproject", extraId],
    label,
    source: "pyproject",
    tags: ["python"],
  });
}

async function wantsPytest(
  projectRootPath: string,
  text: string
): Promise<boolean> {
  if (uncommentedLines(text).some((line) => PYTEST_TABLE_RE.test(line))) {
    return true;
  }
  return (
    (await pathExists(join(projectRootPath, "tests"))) ||
    (await pathExists(join(projectRootPath, "test")))
  );
}

function wantsRuff(text: string): boolean {
  return uncommentedLines(text).some((line) => RUFF_TABLE_RE.test(line));
}

export async function pyprojectSource({
  projectRootPath,
}: PyprojectSourceOptions): Promise<TaskCandidate[]> {
  const text = await readTextIfExists(join(projectRootPath, "pyproject.toml"));
  if (!text) {
    return [];
  }
  const scripts = {
    ...tomlSectionEntries(text, "project.scripts"),
    ...tomlSectionEntries(text, "tool.poetry.scripts"),
    ...tomlSectionEntries(text, "tool.pdm.scripts"),
  };
  const scriptNames = new Set(Object.keys(scripts));
  const tasks = Object.entries(scripts).map(([name, target]) =>
    pyprojectTask(projectRootPath, name, name, name, target)
  );
  const useUv = await pathExists(join(projectRootPath, "uv.lock"));
  if (
    (await wantsPytest(projectRootPath, text)) &&
    !scriptNames.has("pytest") &&
    !scriptNames.has("test")
  ) {
    const spec = useUv
      ? {
          command: commandWithArgs("uv", ["run", "pytest"]),
          label: "uv run pytest",
        }
      : {
          command: commandWithArgs("python", ["-m", "pytest"]),
          label: "python -m pytest",
        };
    tasks.push(
      pyprojectTask(projectRootPath, "pytest", spec.label, spec.command)
    );
  }
  if (wantsRuff(text) && !scriptNames.has("ruff")) {
    const check = useUv
      ? {
          command: commandWithArgs("uv", ["run", "ruff", "check", "."]),
          label: "uv run ruff check .",
        }
      : {
          command: commandWithArgs("ruff", ["check", "."]),
          label: "ruff check .",
        };
    const format = useUv
      ? {
          command: commandWithArgs("uv", ["run", "ruff", "format", "."]),
          label: "uv run ruff format .",
        }
      : {
          command: commandWithArgs("ruff", ["format", "."]),
          label: "ruff format .",
        };
    tasks.push(
      pyprojectTask(projectRootPath, "ruff-check", check.label, check.command),
      pyprojectTask(
        projectRootPath,
        "ruff-format",
        format.label,
        format.command
      )
    );
  }
  return tasks;
}
