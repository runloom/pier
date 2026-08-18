import {
  bindLeaderSession,
  loadSessionMap,
  parseTmuxValue,
  type SessionMap,
  sessionFileExpired,
} from "../main/session-map.ts";
import { parseTmuxArgv } from "./parse.ts";
import type {
  ControlResult,
  JsonCommand,
  RunTmuxResult,
  TmuxRuntime,
} from "./types.ts";
import type { VerbContext, VerbOutcome } from "./verb-context.ts";
import { capturePane, killPane, selectPane, sendKeys } from "./verbs-io.ts";
import { resizePane, selectLayout } from "./verbs-layout.ts";
import { displayMessage, listPanes, listWindows } from "./verbs-list.ts";
import { newWindow, respawnPane, splitWindow } from "./verbs-open.ts";
import { runWaitFor } from "./wait-for.ts";

export const TMUX_VERSION_LINE = "tmux 3.4\n";

const REJECTED = new Set([
  "attach",
  "attach-session",
  "bind-key",
  "source-file",
]);

const LOCAL_NOOP = new Set([
  "rename-window",
  "set",
  "set-option",
  "set-window-option",
  "setw",
]);

const HOST_VERBS = new Set([
  "capture-pane",
  "display-message",
  "kill-pane",
  "kill-window",
  "list-panes",
  "list-windows",
  "new-session",
  "new-window",
  "respawn-pane",
  "resize-pane",
  "select-layout",
  "select-pane",
  "select-window",
  "send-keys",
  "split-window",
]);

async function leaderAlive(
  invoke: (command: JsonCommand) => Promise<ControlResult>,
  commands: JsonCommand[],
  map: SessionMap
): Promise<boolean> {
  const leader = map.panes[map.leaderPaneId];
  if (!leader) {
    return false;
  }
  const command: JsonCommand = {
    type: "terminal.get",
    panelId: leader.panelId,
    windowId: leader.windowId,
  };
  commands.push(command);
  const result = await invoke(command);
  return result.ok;
}

async function resolveMap(
  runtime: TmuxRuntime,
  commands: JsonCommand[]
): Promise<{ map: SessionMap; workDir: string } | RunTmuxResult> {
  const parsed = runtime.env.TMUX ? parseTmuxValue(runtime.env.TMUX) : null;
  if (!parsed) {
    return {
      commands,
      exitCode: 1,
      stderr: "session environment missing\n",
      stdout: "",
    };
  }
  const { sessionId, workDir } = parsed;
  const now = runtime.now ?? Date.now();
  const existing = loadSessionMap(workDir, sessionId);
  const expired = sessionFileExpired(workDir, sessionId, now);
  const alive =
    existing && !expired
      ? await leaderAlive(runtime.invoke, commands, existing)
      : false;
  if (existing && !expired && alive) {
    return { map: existing, workDir };
  }
  const panelId = runtime.env.PIER_PANEL_ID;
  const windowId = runtime.env.PIER_WINDOW_ID;
  if (!(panelId && windowId)) {
    return {
      commands,
      exitCode: 1,
      stderr: "session environment missing\n",
      stdout: "",
    };
  }
  const bound = bindLeaderSession({ panelId, windowId, workDir });
  return { map: bound.map, workDir };
}

async function dispatchVerb(
  verb: string,
  ctx: VerbContext
): Promise<VerbOutcome> {
  if (REJECTED.has(verb)) {
    return {
      exitCode: 1,
      stderr: `unsupported command: ${verb}\n`,
      stdout: "",
    };
  }
  switch (verb) {
    case "split-window":
      return await splitWindow(ctx);
    case "new-window":
    case "new-session":
      return await newWindow(ctx);
    case "respawn-pane":
      return await respawnPane(ctx);
    case "send-keys":
      return await sendKeys(ctx);
    case "capture-pane":
      return await capturePane(ctx);
    case "select-pane":
    case "select-window":
      return await selectPane(ctx);
    case "kill-pane":
    case "kill-window":
      return await killPane(ctx);
    case "list-panes":
      return await listPanes(ctx);
    case "list-windows":
      return await listWindows(ctx);
    case "resize-pane":
      return await resizePane(ctx);
    case "select-layout":
      return await selectLayout(ctx);
    case "display-message":
      return await displayMessage(ctx);
    default:
      return {
        exitCode: 1,
        stderr: `unknown command: ${verb}\n`,
        stdout: "",
      };
  }
}

export async function runTmux(
  argv: string[],
  runtime: TmuxRuntime
): Promise<RunTmuxResult> {
  const commands: JsonCommand[] = [];
  const parsed = parseTmuxArgv(argv);
  if (parsed.kind === "version") {
    return { commands, exitCode: 0, stderr: "", stdout: TMUX_VERSION_LINE };
  }
  if (parsed.kind === "error") {
    return {
      commands,
      exitCode: parsed.exitCode,
      stderr: `${parsed.message}\n`,
      stdout: "",
    };
  }
  if (!(runtime.env.TMUX && runtime.env.PIER_CONTROL_SOCKET)) {
    return {
      commands,
      exitCode: 1,
      stderr: "session environment missing\n",
      stdout: "",
    };
  }
  if (LOCAL_NOOP.has(parsed.verb)) {
    return { commands, exitCode: 0, stderr: "", stdout: "" };
  }
  if (parsed.verb === "has-session") {
    return { commands, exitCode: 0, stderr: "", stdout: "" };
  }
  if (parsed.verb === "list-sessions") {
    const session = parseTmuxValue(runtime.env.TMUX ?? "");
    const name = session?.sessionId ?? "default";
    return {
      commands,
      exitCode: 0,
      stderr: "",
      stdout: `${name}: 1 windows\n`,
    };
  }
  if (parsed.verb === "wait-for") {
    return await runWaitFor(parsed, runtime, commands);
  }
  if (REJECTED.has(parsed.verb)) {
    return {
      commands,
      exitCode: 1,
      stderr: `unsupported command: ${parsed.verb}\n`,
      stdout: "",
    };
  }
  if (!HOST_VERBS.has(parsed.verb)) {
    return {
      commands,
      exitCode: 1,
      stderr: `unknown command: ${parsed.verb}\n`,
      stdout: "",
    };
  }
  const resolved = await resolveMap(runtime, commands);
  if ("exitCode" in resolved) {
    return resolved;
  }
  const ctx: VerbContext = {
    commands,
    env: runtime.env,
    flags: parsed.flags,
    invoke: runtime.invoke,
    map: resolved.map,
    rest: parsed.rest,
    workDir: resolved.workDir,
  };
  try {
    const outcome = await dispatchVerb(parsed.verb, ctx);
    return {
      commands,
      exitCode: outcome.exitCode,
      stderr: outcome.stderr,
      stdout: outcome.stdout,
    };
  } catch (err) {
    return {
      commands,
      exitCode: 1,
      stderr: `${err instanceof Error ? err.message : String(err)}\n`,
      stdout: "",
    };
  }
}
