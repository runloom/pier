import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { TaskCandidate, TaskSource } from "@shared/contracts/tasks.ts";
import { taskCandidate as candidate } from "./candidate.ts";
import { commandWithArgs, pathExists } from "./utils.ts";

export interface ToolchainSourceOptions {
  projectRootPath: string;
}

function toolchainTask(
  projectRootPath: string,
  source: TaskSource,
  tags: readonly string[],
  extraId: string,
  label: string,
  command: string
): TaskCandidate {
  return candidate({
    commandSpec: { command, kind: "shell" },
    cwd: projectRootPath,
    idParts: [source, extraId],
    label,
    source,
    tags: [...tags],
  });
}

function builtins(
  projectRootPath: string,
  source: TaskSource,
  tags: readonly string[],
  rows: ReadonlyArray<{ extraId: string; label: string; command: string }>
): TaskCandidate[] {
  return rows.map((row) =>
    toolchainTask(
      projectRootPath,
      source,
      tags,
      row.extraId,
      row.label,
      row.command
    )
  );
}

async function goTasks(projectRootPath: string): Promise<TaskCandidate[]> {
  const hasGo =
    (await pathExists(join(projectRootPath, "go.mod"))) ||
    (await pathExists(join(projectRootPath, "go.work")));
  if (!hasGo) {
    return [];
  }
  return builtins(
    projectRootPath,
    "go",
    ["go"],
    [
      {
        command: commandWithArgs("go", ["build"]),
        extraId: "build",
        label: "go build",
      },
      {
        command: commandWithArgs("go", ["test", "./..."]),
        extraId: "test",
        label: "go test ./...",
      },
      {
        command: commandWithArgs("go", ["vet", "./..."]),
        extraId: "vet",
        label: "go vet ./...",
      },
      {
        command: commandWithArgs("go", ["run", "."]),
        extraId: "run",
        label: "go run .",
      },
    ]
  );
}

async function mavenCommand(
  projectRootPath: string
): Promise<{ command: string; prefix: string }> {
  if (await pathExists(join(projectRootPath, "mvnw"))) {
    return { command: "./mvnw", prefix: "./mvnw" };
  }
  if (await pathExists(join(projectRootPath, "mvnw.cmd"))) {
    return { command: "mvnw.cmd", prefix: "mvnw.cmd" };
  }
  return { command: "mvn", prefix: "mvn" };
}

async function mavenTasks(projectRootPath: string): Promise<TaskCandidate[]> {
  if (!(await pathExists(join(projectRootPath, "pom.xml")))) {
    return [];
  }
  const { command, prefix } = await mavenCommand(projectRootPath);
  return builtins(
    projectRootPath,
    "maven",
    ["java"],
    [
      {
        command: commandWithArgs(command, ["test"]),
        extraId: "test",
        label: `${prefix} test`,
      },
      {
        command: commandWithArgs(command, ["package"]),
        extraId: "package",
        label: `${prefix} package`,
      },
    ]
  );
}

async function gradleCommand(
  projectRootPath: string
): Promise<{ command: string; prefix: string }> {
  if (await pathExists(join(projectRootPath, "gradlew"))) {
    return { command: "./gradlew", prefix: "./gradlew" };
  }
  if (await pathExists(join(projectRootPath, "gradlew.bat"))) {
    return { command: "gradlew.bat", prefix: "gradlew.bat" };
  }
  return { command: "gradle", prefix: "gradle" };
}

async function gradleTasks(projectRootPath: string): Promise<TaskCandidate[]> {
  const hasGradle =
    (await pathExists(join(projectRootPath, "build.gradle"))) ||
    (await pathExists(join(projectRootPath, "build.gradle.kts"))) ||
    (await pathExists(join(projectRootPath, "settings.gradle"))) ||
    (await pathExists(join(projectRootPath, "settings.gradle.kts")));
  if (!hasGradle) {
    return [];
  }
  const { command, prefix } = await gradleCommand(projectRootPath);
  return builtins(
    projectRootPath,
    "gradle",
    ["java"],
    [
      {
        command: commandWithArgs(command, ["test"]),
        extraId: "test",
        label: `${prefix} test`,
      },
      {
        command: commandWithArgs(command, ["build"]),
        extraId: "build",
        label: `${prefix} build`,
      },
    ]
  );
}

async function mixTasks(projectRootPath: string): Promise<TaskCandidate[]> {
  if (!(await pathExists(join(projectRootPath, "mix.exs")))) {
    return [];
  }
  return builtins(
    projectRootPath,
    "mix",
    ["elixir"],
    [
      {
        command: commandWithArgs("mix", ["deps.get"]),
        extraId: "deps-get",
        label: "mix deps.get",
      },
      {
        command: commandWithArgs("mix", ["compile"]),
        extraId: "compile",
        label: "mix compile",
      },
      {
        command: commandWithArgs("mix", ["test"]),
        extraId: "test",
        label: "mix test",
      },
    ]
  );
}

async function swiftPmTasks(projectRootPath: string): Promise<TaskCandidate[]> {
  if (!(await pathExists(join(projectRootPath, "Package.swift")))) {
    return [];
  }
  return builtins(
    projectRootPath,
    "swiftpm",
    ["swift"],
    [
      {
        command: commandWithArgs("swift", ["build"]),
        extraId: "build",
        label: "swift build",
      },
      {
        command: commandWithArgs("swift", ["test"]),
        extraId: "test",
        label: "swift test",
      },
    ]
  );
}

async function zigTasks(projectRootPath: string): Promise<TaskCandidate[]> {
  if (!(await pathExists(join(projectRootPath, "build.zig")))) {
    return [];
  }
  return builtins(
    projectRootPath,
    "zig",
    ["zig"],
    [
      {
        command: commandWithArgs("zig", ["build"]),
        extraId: "build",
        label: "zig build",
      },
      {
        command: commandWithArgs("zig", ["build", "test"]),
        extraId: "test",
        label: "zig build test",
      },
    ]
  );
}

async function cmakeTasks(projectRootPath: string): Promise<TaskCandidate[]> {
  if (!(await pathExists(join(projectRootPath, "CMakeLists.txt")))) {
    return [];
  }
  return builtins(
    projectRootPath,
    "cmake",
    ["cpp"],
    [
      {
        command: commandWithArgs("cmake", ["-S", ".", "-B", "build"]),
        extraId: "configure",
        label: "cmake -S . -B build",
      },
      {
        command: commandWithArgs("cmake", ["--build", "build"]),
        extraId: "build",
        label: "cmake --build build",
      },
      {
        command: commandWithArgs("ctest", ["--test-dir", "build"]),
        extraId: "test",
        label: "ctest --test-dir build",
      },
    ]
  );
}

async function sbtTasks(projectRootPath: string): Promise<TaskCandidate[]> {
  if (!(await pathExists(join(projectRootPath, "build.sbt")))) {
    return [];
  }
  return builtins(
    projectRootPath,
    "sbt",
    ["scala"],
    [
      {
        command: commandWithArgs("sbt", ["compile"]),
        extraId: "compile",
        label: "sbt compile",
      },
      {
        command: commandWithArgs("sbt", ["test"]),
        extraId: "test",
        label: "sbt test",
      },
    ]
  );
}

function isDotnetProjectFile(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".sln") || lower.endsWith(".csproj");
}

async function rootHasDotnetProject(projectRootPath: string): Promise<boolean> {
  try {
    const names = await readdir(projectRootPath);
    return names.some((name) => isDotnetProjectFile(name));
  } catch {
    return false;
  }
}

async function dotnetTasks(projectRootPath: string): Promise<TaskCandidate[]> {
  if (!(await rootHasDotnetProject(projectRootPath))) {
    return [];
  }
  return builtins(
    projectRootPath,
    "dotnet",
    ["csharp"],
    [
      {
        command: commandWithArgs("dotnet", ["build"]),
        extraId: "build",
        label: "dotnet build",
      },
      {
        command: commandWithArgs("dotnet", ["test"]),
        extraId: "test",
        label: "dotnet test",
      },
    ]
  );
}

export const goSource = ({
  projectRootPath,
}: ToolchainSourceOptions): Promise<TaskCandidate[]> =>
  goTasks(projectRootPath);

export const mavenSource = ({
  projectRootPath,
}: ToolchainSourceOptions): Promise<TaskCandidate[]> =>
  mavenTasks(projectRootPath);

export const gradleSource = ({
  projectRootPath,
}: ToolchainSourceOptions): Promise<TaskCandidate[]> =>
  gradleTasks(projectRootPath);

export const mixSource = ({
  projectRootPath,
}: ToolchainSourceOptions): Promise<TaskCandidate[]> =>
  mixTasks(projectRootPath);

export const swiftPmSource = ({
  projectRootPath,
}: ToolchainSourceOptions): Promise<TaskCandidate[]> =>
  swiftPmTasks(projectRootPath);

export const zigSource = ({
  projectRootPath,
}: ToolchainSourceOptions): Promise<TaskCandidate[]> =>
  zigTasks(projectRootPath);

export const dotnetSource = ({
  projectRootPath,
}: ToolchainSourceOptions): Promise<TaskCandidate[]> =>
  dotnetTasks(projectRootPath);

export const sbtSource = ({
  projectRootPath,
}: ToolchainSourceOptions): Promise<TaskCandidate[]> =>
  sbtTasks(projectRootPath);

export const cmakeSource = ({
  projectRootPath,
}: ToolchainSourceOptions): Promise<TaskCandidate[]> =>
  cmakeTasks(projectRootPath);

export const TOOLCHAIN_TASK_SOURCE_PROVIDERS = [
  { id: "go" as const, list: goSource },
  { id: "maven" as const, list: mavenSource },
  { id: "gradle" as const, list: gradleSource },
  { id: "mix" as const, list: mixSource },
  { id: "swiftpm" as const, list: swiftPmSource },
  { id: "zig" as const, list: zigSource },
  { id: "dotnet" as const, list: dotnetSource },
  { id: "sbt" as const, list: sbtSource },
  { id: "cmake" as const, list: cmakeSource },
];
