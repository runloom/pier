import { randomUUID } from "node:crypto";
import { isAbsolute, resolve } from "node:path";

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function usage() {
  return [
    "Usage:",
    "  pier open <path> [--window <windowId>] [--split <direction>] [--no-focus] --json",
    "  pier terminal open [--cwd <path>] [--profile <profileId>] [--env KEY=VALUE] [--command <command> | -- <command...>] [--window <windowId>] [--split <direction>] [--no-focus] --json",
    "  pier terminal list [--window <windowId>] --json",
    "  pier terminal get --panel <panelId> [--window <windowId>] --json",
    "  pier terminal send --panel <panelId> --text <s> [--window <windowId>] --json",
    "  pier terminal key --panel <panelId> --key <name> [--window <windowId>] --json",
    "  pier terminal profiles list --json",
    "  pier terminal profiles get <profileId> --json",
    "  pier terminal profiles set <profileId> [--cwd <path>] [--env KEY=VALUE] [--command <command> | -- <command...>] --json",
    "  pier terminal profiles delete <profileId> --json",
    "  pier tasks list [--path <path>] --json",
    "  pier tasks run <taskId> [--path <path>] [--input id=value] [--window <windowId>] [--split <direction>] [--no-focus] --json",
    "  pier tasks status|get <runId> --json",
    "  pier tasks output <runId> [--task <taskId>] --json",
    "  pier tasks stop <runId> [--force] --json",
    "  pier tasks cancel <runId> [--window <windowId>] --json",
    "  pier tasks rerun <runId> --json",
    "  pier status --json",
    "  pier snapshot --json",
    "  pier watch [--after <revision>] [--timeout <ms>] [--poll-ms <ms>] --json",
    "  pier windows list --json",
    "  pier windows focus <windowId> --json",
    "  pier panels list [--window <windowId>] --json",
    "  pier panels focus <panelId> [--window <windowId>] [--no-focus] --json",
    "  pier worktrees list --path <path> --json",
    "  pier worktrees get --path <path> --json",
    "  pier worktrees check --path <path> --json",
    "  pier worktrees create --path <repo> --name <dir> --branch <branch> --base <ref> --json",
    "  pier worktrees open <path> --json",
    "  pier worktrees remove --path <path> [--delete-branch] --json",
    "  pier plugins list --json",
    "  pier plugins inspect <id> --json",
    "  pier plugins enable <id> --json",
    "  pier plugins disable <id> --json",
    "  pier preferences read --json",
    "  pier agents catalog --json",
    "  pier agents list --json",
    "  pier agents get --agent-ref <ref> | --agent-id <id> | --panel <panelId> --json",
    "  pier agents start --agent <id> [--cwd <path>] [--window <windowId>] --json",
    "  pier agents turn --boot <id> --runtime <id> --generation <n> [--text <s>|--text-file <path>|--stdin] --json",
    "  pier agents screen --boot <id> --runtime <id> --generation <n> [--max-lines <n>] [--max-bytes <n>] --json",
    "  pier agents wait --boot <id> --runtime <id> --generation <n> --until ready|waiting|exited|attention [--timeout <ms>] --json",
    "  pier agents watch --boot <id> --runtime <id> --generation <n> [--timeout <ms>] [--poll-ms <ms>] --json",
    "  pier agents focus|interrupt|terminate --boot <id> --runtime <id> --generation <n> --json",
  ].join("\n");
}

function requireValue(value) {
  if (!value) {
    throw new Error("missing required pier CLI argument");
  }
  return value;
}

function optionValue(args, name) {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--") {
      return;
    }
    if (arg !== name) {
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`missing required value for ${name}`);
    }
    return value;
  }
}

function optionValues(args, name) {
  const values = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--") {
      break;
    }
    if (arg !== name) {
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`missing required value for ${name}`);
    }
    values.push(value);
    index++;
  }
  return values;
}

export function hasPierCliOption(args, name) {
  for (const arg of args) {
    if (arg === "--") {
      return false;
    }
    if (arg === name) {
      return true;
    }
  }
  return false;
}

function stripOptions(args) {
  const result = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--") {
      break;
    }
    if (
      arg === "--json" ||
      arg === "--print-envelope" ||
      arg === "--window" ||
      arg === "--split" ||
      arg === "--no-focus" ||
      arg === "--path" ||
      arg === "--name" ||
      arg === "--branch" ||
      arg === "--base" ||
      arg === "--cwd" ||
      arg === "--profile" ||
      arg === "--env" ||
      arg === "--input" ||
      arg === "--command" ||
      arg === "--agent-ref" ||
      arg === "--agent-id" ||
      arg === "--agent" ||
      arg === "--panel" ||
      arg === "--boot" ||
      arg === "--boot-id" ||
      arg === "--runtime" ||
      arg === "--runtime-id" ||
      arg === "--generation" ||
      arg === "--gen" ||
      arg === "--text" ||
      arg === "--text-file" ||
      arg === "--stdin" ||
      arg === "--operation-id" ||
      arg === "--worktree-key" ||
      arg === "--incarnation-id" ||
      arg === "--max-lines" ||
      arg === "--max-bytes" ||
      arg === "--until" ||
      arg === "--timeout" ||
      arg === "--poll-ms" ||
      arg === "--key" ||
      arg === "--delete-branch" ||
      arg === "--task" ||
      arg === "--force" ||
      arg === "--after" ||
      arg === "--scope"
    ) {
      if (
        arg === "--window" ||
        arg === "--split" ||
        arg === "--path" ||
        arg === "--name" ||
        arg === "--branch" ||
        arg === "--base" ||
        arg === "--cwd" ||
        arg === "--profile" ||
        arg === "--env" ||
        arg === "--input" ||
        arg === "--command" ||
        arg === "--agent-ref" ||
        arg === "--agent-id" ||
        arg === "--agent" ||
        arg === "--panel" ||
        arg === "--boot" ||
        arg === "--boot-id" ||
        arg === "--runtime" ||
        arg === "--runtime-id" ||
        arg === "--generation" ||
        arg === "--gen" ||
        arg === "--text" ||
        arg === "--text-file" ||
        arg === "--operation-id" ||
        arg === "--worktree-key" ||
        arg === "--incarnation-id" ||
        arg === "--max-lines" ||
        arg === "--max-bytes" ||
        arg === "--until" ||
        arg === "--timeout" ||
        arg === "--poll-ms" ||
        arg === "--key" ||
        arg === "--task" ||
        arg === "--after" ||
        arg === "--scope"
      ) {
        index++;
      }
      // --delete-branch / --force / --stdin / --json 等布尔 flag 不吃下一参数
      continue;
    }
    if (arg) {
      result.push(arg);
    }
  }
  return result;
}

function parsePlacement(args) {
  const split = optionValue(args, "--split");
  if (!split) {
    return;
  }
  switch (split) {
    case "right":
      return "split-right";
    case "below":
    case "down":
      return "split-below";
    case "left":
      return "split-left";
    case "above":
    case "up":
      return "split-above";
    default:
      throw new Error("invalid --split value");
  }
}

function routeOptions(args) {
  const placement = parsePlacement(args);
  const windowId = optionValue(args, "--window");
  const focus = hasPierCliOption(args, "--no-focus") ? false : undefined;
  return {
    ...(focus !== undefined && { focus }),
    ...(placement && { placement }),
    ...(windowId && { windowId }),
  };
}

function absolutePath(path, cwd) {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

function commandAfterTerminator(args) {
  const terminator = args.indexOf("--");
  if (terminator < 0) {
    return;
  }
  const command = args
    .slice(terminator + 1)
    .filter((part) => part.length > 0)
    .join(" ")
    .trim();
  return command.length > 0 ? command : undefined;
}

function parseEnv(args) {
  const entries = optionValues(args, "--env");
  if (entries.length === 0) {
    return;
  }
  const env = {};
  for (const entry of entries) {
    const separator = entry.indexOf("=");
    const key = separator >= 0 ? entry.slice(0, separator) : entry;
    if (!ENV_KEY_PATTERN.test(key) || separator < 0) {
      throw new Error("invalid --env value");
    }
    env[key] = entry.slice(separator + 1);
  }
  return env;
}

function parseTaskInputs(args) {
  const entries = optionValues(args, "--input");
  if (entries.length === 0) {
    return;
  }
  const inputs = {};
  for (const entry of entries) {
    const separator = entry.indexOf("=");
    const key = separator >= 0 ? entry.slice(0, separator) : entry;
    if (!key || separator < 0) {
      throw new Error("invalid --input value");
    }
    inputs[key] = entry.slice(separator + 1);
  }
  return inputs;
}

function parseOpen(action, unexpected, cwd, route) {
  if (unexpected) {
    throw new Error(`unexpected pier CLI argument: ${unexpected}`);
  }
  return {
    path: absolutePath(requireValue(action), cwd),
    type: "panel.open",
    ...route,
  };
}

function parseTerminalOpen(action, unexpected, args, cwd, route) {
  if (action !== "open") {
    throw new Error("unknown pier CLI command");
  }
  if (unexpected) {
    throw new Error(`unexpected pier CLI argument: ${unexpected}`);
  }
  const explicitCommand = optionValue(args, "--command");
  const command = commandAfterTerminator(args);
  if (explicitCommand && command) {
    throw new Error("cannot combine --command with -- command");
  }
  const rawCwd = optionValue(args, "--cwd");
  const env = parseEnv(args);
  const profileId = optionValue(args, "--profile");
  return {
    launch: {
      ...(explicitCommand || command
        ? { command: explicitCommand ?? command }
        : {}),
      cwd: rawCwd ? absolutePath(rawCwd, cwd) : cwd,
      ...(env && { env }),
      ...(profileId && { profileId }),
    },
    type: "terminal.open",
    ...route,
  };
}

function parseProfileLaunch(args, cwd) {
  const explicitCommand = optionValue(args, "--command");
  const command = commandAfterTerminator(args);
  if (explicitCommand && command) {
    throw new Error("cannot combine --command with -- command");
  }
  const rawCwd = optionValue(args, "--cwd");
  const env = parseEnv(args);
  return {
    ...(explicitCommand || command
      ? { command: explicitCommand ?? command }
      : {}),
    ...(rawCwd ? { cwd: absolutePath(rawCwd, cwd) } : {}),
    ...(env && { env }),
  };
}

function parseTerminalProfiles(action, profileId, unexpected, args, cwd) {
  if (unexpected) {
    throw new Error(`unexpected pier CLI argument: ${unexpected}`);
  }
  if (action === "list") {
    if (profileId) {
      throw new Error(`unexpected pier CLI argument: ${profileId}`);
    }
    return { type: "terminal.profile.list" };
  }
  if (action === "get" || action === "read") {
    return {
      profileId: requireValue(profileId),
      type: "terminal.profile.read",
    };
  }
  if (action === "set" || action === "upsert") {
    return {
      profile: parseProfileLaunch(args, cwd),
      profileId: requireValue(profileId),
      type: "terminal.profile.upsert",
    };
  }
  if (action === "delete" || action === "remove" || action === "rm") {
    return {
      profileId: requireValue(profileId),
      type: "terminal.profile.delete",
    };
  }
  throw new Error("unknown pier CLI command");
}

function rejectUnexpectedArg(value, unexpected) {
  if (value || unexpected) {
    throw new Error(`unexpected pier CLI argument: ${value ?? unexpected}`);
  }
}

function parseTerminalWrite(action, value, unexpected, args, route) {
  rejectUnexpectedArg(value, unexpected);
  const panelId = requireValue(optionValue(args, "--panel"));
  if (action === "send") {
    return {
      type: "terminal.send",
      panelId,
      text: requireValue(optionValue(args, "--text")),
      ...(route.windowId && { windowId: route.windowId }),
    };
  }
  return {
    type: "terminal.key",
    panelId,
    key: requireValue(optionValue(args, "--key")),
    ...(route.windowId && { windowId: route.windowId }),
  };
}

function parseTerminal(action, value, extra, unexpected, args, cwd, route) {
  if (action === "profiles") {
    return parseTerminalProfiles(value, extra, unexpected, args, cwd);
  }
  if (action === "list") {
    rejectUnexpectedArg(value, unexpected);
    return {
      type: "terminal.list",
      ...(route.windowId && { windowId: route.windowId }),
    };
  }
  if (action === "get") {
    if (unexpected) {
      throw new Error(`unexpected pier CLI argument: ${unexpected}`);
    }
    return {
      type: "terminal.get",
      panelId: requireValue(optionValue(args, "--panel") ?? value),
      ...(route.windowId && { windowId: route.windowId }),
    };
  }
  if (action === "send" || action === "key") {
    return parseTerminalWrite(action, value, unexpected, args, route);
  }
  if (unexpected) {
    throw new Error(`unexpected pier CLI argument: ${unexpected}`);
  }
  return parseTerminalOpen(action, value, args, cwd, route);
}

function parseWindows(action, value) {
  if (action === "list") {
    return { type: "window.list" };
  }
  if (action === "focus") {
    return { type: "window.focus", windowId: requireValue(value) };
  }
  throw new Error("unknown pier CLI command");
}

function parsePanels(action, value, route) {
  if (action === "list") {
    return {
      type: "panel.list",
      ...(route.windowId && { windowId: route.windowId }),
    };
  }
  if (action === "focus") {
    return {
      ...(route.focus !== undefined && { focus: route.focus }),
      panelId: requireValue(value),
      type: "panel.focus",
      ...(route.windowId && { windowId: route.windowId }),
    };
  }
  throw new Error("unknown pier CLI command");
}

function parseWorktrees(action, value, unexpected, args, cwd, route) {
  if (action === "list" || action === "check" || action === "get") {
    rejectUnexpectedArg(value, unexpected);
    return {
      path: absolutePath(requireValue(optionValue(args, "--path")), cwd),
      type: `worktree.${action}`,
    };
  }
  if (action === "create") {
    rejectUnexpectedArg(value, unexpected);
    const base = optionValue(args, "--base");
    return {
      ...(base && { base }),
      branch: requireValue(optionValue(args, "--branch")),
      name: requireValue(optionValue(args, "--name")),
      path: absolutePath(requireValue(optionValue(args, "--path")), cwd),
      type: "worktree.create",
    };
  }
  if (action === "open") {
    if (unexpected) {
      throw new Error(`unexpected pier CLI argument: ${unexpected}`);
    }
    return {
      path: absolutePath(requireValue(value), cwd),
      type: "worktree.open",
      ...route,
    };
  }
  if (action === "remove") {
    rejectUnexpectedArg(value, unexpected);
    return {
      path: absolutePath(requireValue(optionValue(args, "--path")), cwd),
      type: "worktree.remove",
      ...(hasPierCliOption(args, "--delete-branch")
        ? { deleteBranch: true }
        : {}),
    };
  }
  throw new Error(
    "unknown pier worktrees command (list|get|check|create|open|remove)"
  );
}

function projectRootOption(args, cwd) {
  const path = optionValue(args, "--path");
  return path ? absolutePath(path, cwd) : cwd;
}

function rejectUnexpectedOnly(unexpected) {
  if (unexpected) {
    throw new Error(`unexpected pier CLI argument: ${unexpected}`);
  }
}

function parseTasks(action, value, unexpected, args, cwd, route) {
  if (action === "list") {
    rejectUnexpectedArg(value, unexpected);
    return {
      projectRootPath: projectRootOption(args, cwd),
      type: "run.list",
    };
  }
  if (action === "run") {
    rejectUnexpectedOnly(unexpected);
    const inputs = parseTaskInputs(args);
    return {
      ...(route.focus !== undefined && { focus: route.focus }),
      ...(inputs && { inputs }),
      ...(route.placement && { placement: route.placement }),
      ...(route.windowId && { windowId: route.windowId }),
      projectRootPath: projectRootOption(args, cwd),
      taskId: requireValue(value),
      type: "run.spawn",
    };
  }
  if (action === "status" || action === "get") {
    rejectUnexpectedOnly(unexpected);
    return { runId: requireValue(value), type: "run.status" };
  }
  if (action === "output") {
    rejectUnexpectedOnly(unexpected);
    const taskId = optionValue(args, "--task");
    return {
      runId: requireValue(value),
      type: "run.output",
      ...(taskId ? { taskId } : {}),
    };
  }
  if (action === "stop") {
    rejectUnexpectedOnly(unexpected);
    return {
      runId: requireValue(value),
      type: "run.stop",
      ...(hasPierCliOption(args, "--force") ? { force: true } : {}),
    };
  }
  if (action === "rerun") {
    rejectUnexpectedOnly(unexpected);
    return {
      runId: requireValue(value),
      type: "run.rerun",
      ...(route.focus !== undefined && { focus: route.focus }),
      ...(route.windowId && { windowId: route.windowId }),
    };
  }
  if (action === "cancel") {
    rejectUnexpectedOnly(unexpected);
    return {
      runId: requireValue(value),
      type: "run.cancel",
      ...(route.windowId && { windowId: route.windowId }),
    };
  }
  throw new Error("unknown pier CLI command");
}

function parsePlugins(action, value, unexpected) {
  if (action === "list") {
    if (value || unexpected) {
      throw new Error(`unexpected pier CLI argument: ${value ?? unexpected}`);
    }
    return { type: "plugin.list" };
  }
  if (action === "inspect") {
    if (unexpected) {
      throw new Error(`unexpected pier CLI argument: ${unexpected}`);
    }
    return {
      id: requireValue(value),
      type: "plugin.inspect",
    };
  }
  if (action === "enable" || action === "disable") {
    if (unexpected) {
      throw new Error(`unexpected pier CLI argument: ${unexpected}`);
    }
    return {
      id: requireValue(value),
      type: `plugin.${action}`,
    };
  }
  throw new Error("unknown pier CLI command");
}

function parseAgentsGet(value, args) {
  const agentRef = optionValue(args, "--agent-ref");
  const agentId = optionValue(args, "--agent-id");
  const panelId = optionValue(args, "--panel");
  if (value && !agentRef && !agentId && !panelId) {
    return {
      protocol: "v2",
      op: "agents.get",
      params: { agentId: requireValue(value) },
    };
  }
  if (!(agentRef || agentId || panelId)) {
    throw new Error(
      "agents get requires --agent-ref, --agent-id, --panel, or <agentId>"
    );
  }
  return {
    protocol: "v2",
    op: "agents.get",
    params: {
      ...(agentRef ? { agentRef } : {}),
      ...(agentId ? { agentId } : {}),
      ...(panelId ? { panelId } : {}),
    },
  };
}

function parseAgentsStart(value, args) {
  const agentId =
    optionValue(args, "--agent") ?? optionValue(args, "--agent-id") ?? value;
  if (!agentId) {
    throw new Error("agents start requires --agent <id>");
  }
  const cwdOpt = optionValue(args, "--cwd");
  const windowId = optionValue(args, "--window");
  const worktreeKey = optionValue(args, "--worktree-key");
  const incarnationId = optionValue(args, "--incarnation-id");
  const effectKey = optionValue(args, "--operation-id") ?? randomUUID();
  return {
    protocol: "v2",
    op: "agents.start",
    effectKey,
    params: {
      agentId,
      ...(cwdOpt
        ? { cwd: isAbsolute(cwdOpt) ? cwdOpt : resolve(process.cwd(), cwdOpt) }
        : {}),
      ...(windowId ? { windowId } : {}),
      ...(worktreeKey ? { worktreeKey } : {}),
      ...(incarnationId ? { incarnationId } : {}),
    },
  };
}

function parseAgentsRuntimeBase(action, args) {
  const bootId = optionValue(args, "--boot") ?? optionValue(args, "--boot-id");
  const runtimeId =
    optionValue(args, "--runtime") ?? optionValue(args, "--runtime-id");
  const generationRaw =
    optionValue(args, "--generation") ?? optionValue(args, "--gen");
  if (!(bootId && runtimeId && generationRaw !== undefined)) {
    throw new Error(
      `agents ${action} requires --boot, --runtime, and --generation`
    );
  }
  const generation = Number(generationRaw);
  if (!Number.isInteger(generation) || generation < 0) {
    throw new Error("--generation must be a non-negative integer");
  }
  return { bootId, runtimeId, generation };
}

function parseAgentsTurn(base, args) {
  const textInline = optionValue(args, "--text");
  const textFile = optionValue(args, "--text-file");
  const useStdin = hasPierCliOption(args, "--stdin");
  if ([textInline, textFile, useStdin].filter(Boolean).length > 1) {
    throw new Error("use only one of --text, --text-file, or --stdin");
  }
  let textSource = { kind: "stdin" };
  if (textInline) {
    textSource = { kind: "inline", text: textInline };
  } else if (textFile) {
    textSource = { kind: "file", path: textFile };
  }
  return {
    protocol: "v2",
    op: "agents.turn",
    effectKey: optionValue(args, "--operation-id") ?? randomUUID(),
    textSource,
    params: base,
  };
}

function parseAgentsRuntimeOp(action, args) {
  const base = parseAgentsRuntimeBase(action, args);
  if (action === "turn") {
    return parseAgentsTurn(base, args);
  }
  if (action === "screen") {
    const maxLines = optionValue(args, "--max-lines");
    const maxBytes = optionValue(args, "--max-bytes");
    return {
      protocol: "v2",
      op: "agents.screen",
      params: {
        ...base,
        ...(maxLines ? { maxLines: Number(maxLines) } : {}),
        ...(maxBytes ? { maxBytes: Number(maxBytes) } : {}),
      },
    };
  }
  if (action === "wait") {
    const until = optionValue(args, "--until") ?? "ready";
    const timeoutMs = optionValue(args, "--timeout");
    return {
      protocol: "v2",
      op: "agents.wait",
      params: {
        ...base,
        until,
        ...(timeoutMs ? { timeoutMs: Number(timeoutMs) } : {}),
      },
    };
  }
  if (action === "watch") {
    const timeoutMs = optionValue(args, "--timeout");
    const pollMs = optionValue(args, "--poll-ms");
    return {
      protocol: "v2",
      op: "agents.watch",
      params: {
        ...base,
        ...(timeoutMs ? { timeoutMs: Number(timeoutMs) } : {}),
        ...(pollMs ? { pollMs: Number(pollMs) } : {}),
      },
    };
  }
  const effectKey =
    action === "focus"
      ? undefined
      : (optionValue(args, "--operation-id") ?? randomUUID());
  return {
    protocol: "v2",
    op: `agents.${action}`,
    ...(effectKey ? { effectKey } : {}),
    params: base,
  };
}

function parseAgents(action, value, unexpected, args) {
  if (unexpected) {
    throw new Error(`unexpected pier CLI argument: ${unexpected}`);
  }
  // Product CLI is always cli-human; agents.self needs an agent principal.
  if (action === "self") {
    throw new Error(
      "pier agents self is not available from the human CLI (requires agent principal / binding). Use agents catalog|list|get instead."
    );
  }
  if (action === "invoke") {
    throw new Error(
      "pier agents invoke is not a product command; use the agent native CLI for one-shot (e.g. codex exec). Pier agents: catalog|list|get|start|turn|screen|…"
    );
  }
  if (action === "catalog" || action === "list") {
    if (value) {
      throw new Error(`unexpected pier CLI argument: ${value}`);
    }
    return {
      protocol: "v2",
      op: `agents.${action}`,
      params: {},
    };
  }
  if (action === "get") {
    return parseAgentsGet(value, args);
  }
  if (action === "start") {
    return parseAgentsStart(value, args);
  }
  if (
    action === "turn" ||
    action === "screen" ||
    action === "wait" ||
    action === "watch" ||
    action === "focus" ||
    action === "interrupt" ||
    action === "terminate"
  ) {
    return parseAgentsRuntimeOp(action, args);
  }
  throw new Error(
    "unknown pier agents command (catalog|list|get|start|turn|screen|wait|watch|focus|interrupt|terminate)"
  );
}

function parseControlTopLevel(domain, args) {
  if (domain === "status") {
    return { type: "app.status" };
  }
  if (domain === "snapshot") {
    const scope = optionValue(args, "--scope");
    return {
      protocol: "v2",
      op: "control.snapshot",
      params: scope ? { scope } : {},
    };
  }
  if (domain === "watch") {
    const afterRaw = optionValue(args, "--after");
    const timeoutRaw = optionValue(args, "--timeout");
    const pollRaw = optionValue(args, "--poll-ms");
    const params = {};
    if (afterRaw !== undefined) {
      params.after = Number(afterRaw);
    }
    if (timeoutRaw !== undefined) {
      params.timeoutMs = Number(timeoutRaw);
    }
    if (pollRaw !== undefined) {
      params.pollMs = Number(pollRaw);
    }
    return { protocol: "v2", op: "control.watch", params };
  }
  return null;
}

function parseCommand(args, cwd) {
  const [domain, action, value, extra, unexpected] = stripOptions(args);
  const route = routeOptions(args);
  const top = parseControlTopLevel(domain, args);
  if (top) {
    return top;
  }
  if (domain === "open") {
    return parseOpen(action, value, cwd, route);
  }
  if (domain === "terminal") {
    return parseTerminal(action, value, extra, unexpected, args, cwd, route);
  }
  if (domain === "windows") {
    return parseWindows(action, value);
  }
  if (domain === "panels") {
    return parsePanels(action, value, route);
  }
  if (domain === "worktrees") {
    return parseWorktrees(action, value, unexpected, args, cwd, route);
  }
  if (domain === "tasks") {
    return parseTasks(action, value, unexpected, args, cwd, route);
  }
  if (domain === "plugins") {
    return parsePlugins(action, value, unexpected);
  }
  if (domain === "preferences" && action === "read") {
    return { type: "preferences.read" };
  }
  if (domain === "agents") {
    return parseAgents(action, value, unexpected, args);
  }
  throw new Error("unknown pier CLI command");
}

export function parsePierCliArgs(
  argv,
  {
    clientEnv,
    clientId = "cli-local",
    cwd = process.cwd(),
    requestId = randomUUID(),
  } = {}
) {
  const commandOrV2 = parseCommand(argv, cwd);
  const json = hasPierCliOption(argv, "--json");
  if (commandOrV2 && commandOrV2.protocol === "v2") {
    return {
      protocol: "v2",
      requestId,
      op: commandOrV2.op,
      params: commandOrV2.params ?? {},
      json,
      ...(commandOrV2.effectKey ? { effectKey: commandOrV2.effectKey } : {}),
      ...(commandOrV2.expectedBootId
        ? { expectedBootId: commandOrV2.expectedBootId }
        : {}),
      ...(commandOrV2.textSource ? { textSource: commandOrV2.textSource } : {}),
    };
  }
  return {
    protocol: "v1",
    envelope: {
      ...(clientEnv && Object.keys(clientEnv).length > 0 ? { clientEnv } : {}),
      clientId,
      command: commandOrV2,
      protocolVersion: 1,
      requestId,
    },
    json,
  };
}
