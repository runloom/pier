import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import {
  type CanvasCommandInvokeResult,
  canvasCommandCanonical,
  parseCanvasInstanceCommands,
} from "@shared/contracts/canvas-command.ts";
import type { PierCommandErrorCode } from "@shared/contracts/commands.ts";
import type { TaskLaunchPlan } from "@shared/contracts/tasks.ts";
import {
  canvasDirectoryFromProjectPath,
  canvasSiblingProjectPath,
  isProjectCanvasPath,
} from "@shared/live-module-canvas-path.ts";
import type { CanvasTrustService } from "../canvas-trust/service.ts";
import { isPathWithinRoot } from "../live-modules/fence.ts";

export const CANVAS_COMMAND_CONFIRM_TIMEOUT_MS = 300_000;

export type CanvasCommandInvokeOutcome =
  | CanvasCommandInvokeResult
  | { code: PierCommandErrorCode; kind: "error"; message: string };

export interface CanvasCommandInvokeDeps {
  confirm(command: string, windowId: string): Promise<boolean>;
  isHomeRoot(projectRootPath: string): Promise<boolean>;
  /** Class A: delegates to the tasks system, which resolves env via PES. */
  spawn(input: {
    launches: readonly TaskLaunchPlan[];
    projectRootPath: string;
    rootTaskId: string;
    windowId: string;
  }): Promise<{ runId: string }>;
  trust: CanvasTrustService;
}

export function hashCanvasCommand(canonical: string): string {
  return createHash("sha256").update(canonical).digest("hex");
}

export function canvasCommandTaskId(canvasPath: string, key: string): string {
  const digest = createHash("sha256")
    .update(`${canvasPath}\0${key}`)
    .digest("hex")
    .slice(0, 16);
  return `canvas-command:${digest}`;
}

async function readInstanceCommands(
  projectRootPath: string,
  canvasPath: string
): Promise<ReturnType<typeof parseCanvasInstanceCommands>> {
  const sibling = canvasSiblingProjectPath(canvasPath, "instance.json");
  if (!sibling) {
    return { message: "canvas path is not a project canvas", ok: false };
  }
  const absolute = join(projectRootPath, sibling);
  let text: string;
  try {
    text = await readFile(absolute, "utf8");
  } catch {
    return { commands: new Map(), ok: true };
  }
  let realProject: string;
  let realFile: string;
  try {
    realProject = await realpath(projectRootPath);
    realFile = await realpath(absolute);
  } catch {
    return { message: "could not resolve canvas instance.json", ok: false };
  }
  if (!isPathWithinRoot(realFile, realProject)) {
    return { message: "instance.json is outside the project", ok: false };
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text) as unknown;
  } catch {
    return { message: "instance.json is not valid JSON", ok: false };
  }
  return parseCanvasInstanceCommands(parsedJson);
}

async function resolveCommandCwd(input: {
  canvasPath: string;
  cwd: "canvasDir" | "projectRoot";
  projectRootPath: string;
}): Promise<string | null> {
  const realProject = await realpath(input.projectRootPath);
  if (input.cwd === "projectRoot") {
    return realProject;
  }
  const directory = canvasDirectoryFromProjectPath(input.canvasPath);
  if (directory === null) {
    return null;
  }
  const absolute =
    directory.length > 0 ? join(realProject, directory) : realProject;
  try {
    const realCwd = await realpath(absolute);
    return isPathWithinRoot(realCwd, realProject) ? realCwd : null;
  } catch {
    return null;
  }
}

export async function invokeDeclaredCanvasCommand(input: {
  canvasPath: string;
  deps: CanvasCommandInvokeDeps;
  key: string;
  projectRootPath: string;
  windowId: string;
}): Promise<CanvasCommandInvokeOutcome> {
  const { canvasPath, deps, key, projectRootPath, windowId } = input;
  if (!isProjectCanvasPath(canvasPath)) {
    return {
      code: "invalid_command",
      kind: "error",
      message: "canvas path is not a project canvas",
    };
  }
  const trusted = (await deps.trust.status(projectRootPath)).trusted;
  if (!(trusted || (await deps.isHomeRoot(projectRootPath)))) {
    return {
      code: "permission_denied",
      kind: "error",
      message: "This project’s canvases aren’t trusted.",
    };
  }
  const loaded = await readInstanceCommands(projectRootPath, canvasPath);
  if (!loaded.ok) {
    return { code: "invalid_command", kind: "error", message: loaded.message };
  }
  const declared = loaded.commands.get(key);
  if (!declared) {
    return {
      code: "not_found",
      kind: "error",
      message: "This canvas didn’t declare that command.",
    };
  }
  const commandHash = hashCanvasCommand(
    canvasCommandCanonical({
      command: declared.command,
      ...(declared.cwd ? { cwd: declared.cwd } : {}),
    })
  );
  const already = await deps.trust.commandGrantMatches({
    canvasPath,
    commandHash,
    key,
    projectRootPath,
  });
  if (!already) {
    const confirmed = await deps.confirm(declared.command, windowId);
    if (!confirmed) {
      return { kind: "cancelled" };
    }
    await deps.trust.rememberCommandGrant({
      canvasPath,
      commandHash,
      key,
      projectRootPath,
    });
  }
  const cwd = await resolveCommandCwd({
    canvasPath,
    cwd: declared.cwd ?? "projectRoot",
    projectRootPath,
  });
  if (!cwd) {
    return {
      code: "invalid_command",
      kind: "error",
      message: "Couldn’t resolve the working directory for this command.",
    };
  }
  const realProject = await realpath(projectRootPath);
  const taskId = canvasCommandTaskId(canvasPath, key);
  const launch: TaskLaunchPlan = {
    command: declared.command,
    cwd,
    focus: false,
    label: declared.key,
    presentation: {},
    projectRootPath: realProject,
    rawCommand: declared.command,
    source: "history",
    tab: {},
    taskId,
  };
  const started = await deps.spawn({
    launches: [launch],
    projectRootPath: realProject,
    rootTaskId: taskId,
    windowId,
  });
  return { kind: "started", runId: started.runId };
}
