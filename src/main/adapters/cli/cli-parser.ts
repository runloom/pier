import { randomUUID } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import type {
  PierCommand,
  PierCommandEnvelope,
  PierCommandPlacement,
} from "@shared/contracts/commands.ts";

export interface ParsePierCliArgsOptions {
  clientId?: string;
  cwd?: string;
  requestId?: string;
}

export interface ParsedPierCliCommand {
  envelope: PierCommandEnvelope;
  json: boolean;
}

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function requireValue(value: string | undefined): string {
  if (!value) {
    throw new Error("missing required pier CLI argument");
  }
  return value;
}

function optionValue(
  args: readonly string[],
  name: string
): string | undefined {
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

function optionValues(args: readonly string[], name: string): string[] {
  const values: string[] = [];
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

function hasOption(args: readonly string[], name: string): boolean {
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

function stripOptions(args: readonly string[]): string[] {
  const result: string[] = [];
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
      arg === "--command"
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
        arg === "--command"
      ) {
        index++;
      }
      continue;
    }
    if (arg) {
      result.push(arg);
    }
  }
  return result;
}

function parsePlacement(
  args: readonly string[]
): PierCommandPlacement | undefined {
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

function routeOptions(args: readonly string[]): {
  focus?: boolean;
  placement?: PierCommandPlacement;
  windowId?: string;
} {
  const placement = parsePlacement(args);
  const windowId = optionValue(args, "--window");
  const focus = hasOption(args, "--no-focus") ? false : undefined;
  return {
    ...(focus !== undefined && { focus }),
    ...(placement && { placement }),
    ...(windowId && { windowId }),
  };
}

function absolutePath(path: string, cwd: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

function commandAfterTerminator(args: readonly string[]): string | undefined {
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

function parseEnv(args: readonly string[]): Record<string, string> | undefined {
  const entries = optionValues(args, "--env");
  if (entries.length === 0) {
    return;
  }
  const env: Record<string, string> = {};
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

function parseOpen(
  action: string | undefined,
  unexpected: string | undefined,
  cwd: string,
  route: ReturnType<typeof routeOptions>
): PierCommand {
  if (unexpected) {
    throw new Error(`unexpected pier CLI argument: ${unexpected}`);
  }
  return {
    path: absolutePath(requireValue(action), cwd),
    type: "panel.open",
    ...route,
  };
}

function parseTerminalOpen(
  action: string | undefined,
  unexpected: string | undefined,
  args: readonly string[],
  cwd: string,
  route: ReturnType<typeof routeOptions>
): PierCommand {
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
  const launch = {
    ...(explicitCommand || command
      ? { command: explicitCommand ?? command }
      : {}),
    cwd: rawCwd ? absolutePath(rawCwd, cwd) : cwd,
    ...(env ? { env } : {}),
    ...(profileId ? { profileId } : {}),
  };
  return {
    launch,
    type: "terminal.open",
    ...route,
  };
}

function parseProfileLaunch(
  args: readonly string[],
  cwd: string
): Exclude<
  Extract<PierCommand, { type: "terminal.profile.upsert" }>["profile"],
  undefined
> {
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
    ...(env ? { env } : {}),
  };
}

function parseTerminalProfiles(
  action: string | undefined,
  profileId: string | undefined,
  unexpected: string | undefined,
  args: readonly string[],
  cwd: string
): PierCommand {
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

function parseTerminal(
  action: string | undefined,
  value: string | undefined,
  extra: string | undefined,
  unexpected: string | undefined,
  args: readonly string[],
  cwd: string,
  route: ReturnType<typeof routeOptions>
): PierCommand {
  if (action === "profiles") {
    return parseTerminalProfiles(value, extra, unexpected, args, cwd);
  }
  if (unexpected) {
    throw new Error(`unexpected pier CLI argument: ${unexpected}`);
  }
  return parseTerminalOpen(action, value, args, cwd, route);
}

function parseWindows(
  action: string | undefined,
  value: string | undefined
): PierCommand {
  if (action === "list") {
    return { type: "window.list" };
  }
  if (action === "focus") {
    return { type: "window.focus", windowId: requireValue(value) };
  }
  throw new Error("unknown pier CLI command");
}

function parsePanels(
  action: string | undefined,
  value: string | undefined,
  route: ReturnType<typeof routeOptions>
): PierCommand {
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

function parseWorktrees(
  action: string | undefined,
  value: string | undefined,
  unexpected: string | undefined,
  args: readonly string[],
  cwd: string,
  route: ReturnType<typeof routeOptions>
): PierCommand {
  if (action === "list") {
    if (value || unexpected) {
      throw new Error(`unexpected pier CLI argument: ${value ?? unexpected}`);
    }
    return {
      path: absolutePath(requireValue(optionValue(args, "--path")), cwd),
      type: "worktree.list",
    };
  }
  if (action === "create") {
    if (value || unexpected) {
      throw new Error(`unexpected pier CLI argument: ${value ?? unexpected}`);
    }
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
  throw new Error("unknown pier CLI command");
}

function parsePlugins(
  action: string | undefined,
  value: string | undefined,
  unexpected: string | undefined
): PierCommand {
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
  throw new Error("unknown pier CLI command");
}

function parseCommand(args: readonly string[], cwd: string): PierCommand {
  const [domain, action, value, extra, unexpected] = stripOptions(args);
  const route = routeOptions(args);
  if (domain === "open") {
    return parseOpen(action, value, cwd, route);
  }
  if (domain === "terminal") {
    return parseTerminal(action, value, extra, unexpected, args, cwd, route);
  }
  if (domain === "status") {
    return { type: "app.status" };
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
  if (domain === "plugins") {
    return parsePlugins(action, value, unexpected);
  }
  if (domain === "preferences" && action === "read") {
    return { type: "preferences.read" };
  }
  throw new Error("unknown pier CLI command");
}

export function parsePierCliArgs(
  argv: readonly string[],
  {
    clientId = "cli-local",
    cwd = process.cwd(),
    requestId = randomUUID(),
  }: ParsePierCliArgsOptions = {}
): ParsedPierCliCommand {
  return {
    envelope: {
      clientId,
      command: parseCommand(argv, cwd),
      protocolVersion: 1,
      requestId,
    },
    json: hasOption(argv, "--json"),
  };
}
