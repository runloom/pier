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
  const index = args.indexOf(name);
  if (index < 0) {
    return;
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`missing required value for ${name}`);
  }
  return value;
}

function stripOptions(args: readonly string[]): string[] {
  const result: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (
      arg === "--json" ||
      arg === "--print-envelope" ||
      arg === "--window" ||
      arg === "--split" ||
      arg === "--no-focus"
    ) {
      if (arg === "--window" || arg === "--split") {
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
  const focus = args.includes("--no-focus") ? false : undefined;
  return {
    ...(focus !== undefined && { focus }),
    ...(placement && { placement }),
    ...(windowId && { windowId }),
  };
}

function absolutePath(path: string, cwd: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
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

function parseCommand(args: readonly string[], cwd: string): PierCommand {
  const [domain, action, value] = stripOptions(args);
  const route = routeOptions(args);
  if (domain === "open") {
    return parseOpen(action, value, cwd, route);
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
    json: argv.includes("--json"),
  };
}
