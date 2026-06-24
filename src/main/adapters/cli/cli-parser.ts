import { randomUUID } from "node:crypto";
import type {
  PierCommand,
  PierCommandEnvelope,
  PierCommandPlacement,
} from "@shared/contracts/commands.ts";

export interface ParsePierCliArgsOptions {
  clientId?: string;
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
  return index >= 0 ? args[index + 1] : undefined;
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

function parseOpen(
  action: string | undefined,
  route: ReturnType<typeof routeOptions>
): PierCommand {
  return { path: requireValue(action), type: "workspace.open", ...route };
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

function parseTerminals(
  action: string | undefined,
  value: string | undefined,
  route: ReturnType<typeof routeOptions>
): PierCommand {
  if (action === "list") {
    return {
      type: "terminal.list",
      ...(route.windowId && { windowId: route.windowId }),
    };
  }
  if (action === "open") {
    return { type: "terminal.open", ...route };
  }
  if (action === "focus") {
    return {
      ...(route.focus !== undefined && { focus: route.focus }),
      panelId: requireValue(value),
      type: "terminal.focus",
      ...(route.windowId && { windowId: route.windowId }),
    };
  }
  throw new Error("unknown pier CLI command");
}

function parseCommand(args: readonly string[]): PierCommand {
  const [domain, action, value] = stripOptions(args);
  const route = routeOptions(args);
  if (domain === "open") {
    return parseOpen(action, route);
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
  if (domain === "terminals") {
    return parseTerminals(action, value, route);
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
    requestId = randomUUID(),
  }: ParsePierCliArgsOptions = {}
): ParsedPierCliCommand {
  return {
    envelope: {
      clientId,
      command: parseCommand(argv),
      protocolVersion: 1,
      requestId,
    },
    json: argv.includes("--json"),
  };
}
