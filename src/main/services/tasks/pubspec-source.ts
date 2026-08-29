import { join } from "node:path";
import type { TaskCandidate } from "@shared/contracts/tasks.ts";
import { FVM_PROJECT_MARKERS } from "@shared/language-matrix/fvm.ts";
import { taskCandidate as candidate } from "./candidate.ts";
import { commandWithArgs, pathExists, readTextIfExists } from "./utils.ts";

export interface PubspecSourceOptions {
  projectRootPath: string;
}

const FLUTTER_SDK_RE = /^sdk:\s*flutter\b/;
const BUILD_RUNNER_RE = /^build_runner\s*:/;

function uncommentedLines(text: string): string[] {
  return text.split(/\r?\n/u).flatMap((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith("#") ? [trimmed] : [];
  });
}

function pubspecHasFlutterSdk(text: string): boolean {
  return uncommentedLines(text).some((line) => FLUTTER_SDK_RE.test(line));
}

function pubspecHasBuildRunner(text: string): boolean {
  return uncommentedLines(text).some((line) => BUILD_RUNNER_RE.test(line));
}

async function usesFvm(projectRootPath: string): Promise<boolean> {
  for (const marker of FVM_PROJECT_MARKERS) {
    if (await pathExists(join(projectRootPath, marker))) {
      return true;
    }
  }
  return false;
}

function flutterCommand(
  fvm: boolean,
  args: readonly string[]
): { command: string; label: string } {
  if (fvm) {
    return {
      command: commandWithArgs("fvm", ["flutter", ...args]),
      label: `fvm flutter ${args.join(" ")}`,
    };
  }
  return {
    command: commandWithArgs("flutter", args),
    label: `flutter ${args.join(" ")}`,
  };
}

function dartCommand(
  fvm: boolean,
  args: readonly string[]
): { command: string; label: string } {
  if (fvm) {
    return {
      command: commandWithArgs("fvm", ["dart", ...args]),
      label: `fvm dart ${args.join(" ")}`,
    };
  }
  return {
    command: commandWithArgs("dart", args),
    label: `dart ${args.join(" ")}`,
  };
}

function pubspecTask(
  projectRootPath: string,
  spec: { command: string; label: string },
  extraId: string,
  tags: readonly string[]
): TaskCandidate {
  return candidate({
    commandSpec: { command: spec.command, kind: "shell" },
    cwd: projectRootPath,
    idParts: ["pubspec", extraId],
    label: spec.label,
    source: "pubspec",
    tags: [...tags],
  });
}

export async function pubspecSource({
  projectRootPath,
}: PubspecSourceOptions): Promise<TaskCandidate[]> {
  const text = await readTextIfExists(join(projectRootPath, "pubspec.yaml"));
  if (!text) {
    return [];
  }
  const fvm = await usesFvm(projectRootPath);
  const flutter = pubspecHasFlutterSdk(text);
  const tags = flutter ? ["flutter"] : ["dart"];
  const tasks: TaskCandidate[] = [];
  if (flutter) {
    tasks.push(
      pubspecTask(
        projectRootPath,
        flutterCommand(fvm, ["pub", "get"]),
        "pub-get",
        tags
      ),
      pubspecTask(projectRootPath, flutterCommand(fvm, ["run"]), "run", tags),
      pubspecTask(projectRootPath, flutterCommand(fvm, ["test"]), "test", tags),
      pubspecTask(
        projectRootPath,
        flutterCommand(fvm, ["analyze"]),
        "analyze",
        tags
      )
    );
  } else {
    tasks.push(
      pubspecTask(
        projectRootPath,
        dartCommand(fvm, ["pub", "get"]),
        "pub-get",
        tags
      ),
      pubspecTask(projectRootPath, dartCommand(fvm, ["test"]), "test", tags),
      pubspecTask(
        projectRootPath,
        dartCommand(fvm, ["analyze"]),
        "analyze",
        tags
      )
    );
  }
  tasks.push(
    pubspecTask(
      projectRootPath,
      dartCommand(fvm, ["format", "."]),
      "format",
      tags
    )
  );
  if (pubspecHasBuildRunner(text)) {
    tasks.push(
      pubspecTask(
        projectRootPath,
        dartCommand(fvm, [
          "run",
          "build_runner",
          "build",
          "--delete-conflicting-outputs",
        ]),
        "build-runner",
        ["dart"]
      )
    );
  }
  return tasks;
}
