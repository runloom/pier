#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

function usage() {
  return [
    "Usage:",
    "  pier open <path> --json",
    "  pier status --json",
    "  pier windows list --json",
    "  pier windows focus <windowId> --json",
    "  pier panels list [--window <windowId>] --json",
    "  pier panels focus <panelId> [--window <windowId>] --json",
    "  pier terminals list [--window <windowId>] --json",
    "  pier terminals open --json",
    "  pier terminals focus <panelId> [--window <windowId>] --json",
    "  pier preferences read --json",
  ].join("\n");
}

function requireValue(value) {
  if (!value) {
    throw new Error("missing required pier CLI argument");
  }
  return value;
}

function optionValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function stripOptions(args) {
  const result = [];
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
  const focus = args.includes("--no-focus") ? false : undefined;
  return {
    ...(focus !== undefined && { focus }),
    ...(placement && { placement }),
    ...(windowId && { windowId }),
  };
}

function parseOpen(action, route) {
  return { path: requireValue(action), type: "workspace.open", ...route };
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

function parseTerminals(action, value, route) {
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

function parseCommand(args) {
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

function parseArgs(argv) {
  const printEnvelope = argv.includes("--print-envelope");
  const json = argv.includes("--json");
  const args = argv.filter(
    (arg) => arg !== "--json" && arg !== "--print-envelope"
  );
  return {
    envelope: {
      clientId: "cli-local",
      command: parseCommand(args),
      protocolVersion: 1,
      requestId: randomUUID(),
    },
    json,
    printEnvelope,
  };
}

function shortHash(input) {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

function defaultUserDataDir() {
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "Pier");
  }
  if (process.platform === "win32") {
    return join(
      process.env.APPDATA || join(homedir(), "AppData", "Roaming"),
      "Pier"
    );
  }
  return join(
    process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
    "Pier"
  );
}

function socketPathForUserData(userDataDir) {
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\pier-control-${shortHash(userDataDir)}`;
  }
  return join(userDataDir, "pier-control.sock");
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function resolveWorktreeDevUserData() {
  let dir = process.cwd();
  while (dir !== dirname(dir)) {
    const profile = readJson(join(dir, ".pier-dev", "profile.json"));
    if (typeof profile?.electronUserDataDir === "string") {
      return profile.electronUserDataDir;
    }
    dir = dirname(dir);
  }
  return null;
}

function resolveSocketPath() {
  if (process.env.PIER_CONTROL_SOCKET_PATH) {
    return process.env.PIER_CONTROL_SOCKET_PATH;
  }
  if (process.env.PIER_USER_DATA_DIR) {
    return socketPathForUserData(process.env.PIER_USER_DATA_DIR);
  }
  const devUserData = resolveWorktreeDevUserData();
  if (devUserData) {
    return socketPathForUserData(devUserData);
  }
  return socketPathForUserData(defaultUserDataDir());
}

function request(socketPath, envelope, timeoutMs = 5000) {
  return new Promise((resolveResult, reject) => {
    const socket = createConnection(socketPath);
    let body = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`timed out connecting to Pier at ${socketPath}`));
    }, timeoutMs);

    socket.setEncoding("utf8");
    socket.on("connect", () => {
      socket.write(`${JSON.stringify(envelope)}\n`);
    });
    socket.on("data", (chunk) => {
      body += chunk;
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.on("end", () => {
      clearTimeout(timer);
      try {
        resolveResult(JSON.parse(body.trim()));
      } catch (error) {
        reject(error);
      }
    });
  });
}

try {
  const rawArgv = process.argv.slice(2);
  const parsed = parseArgs(rawArgv[0] === "--" ? rawArgv.slice(1) : rawArgv);
  if (parsed.printEnvelope) {
    console.log(
      JSON.stringify({ envelope: parsed.envelope, json: parsed.json }, null, 2)
    );
    process.exit(0);
  }
  const result = await request(resolveSocketPath(), parsed.envelope);
  if (parsed.json) {
    console.log(JSON.stringify(result, null, 2));
  }
  process.exit(result.ok ? 0 : 1);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(usage());
  process.exit(1);
}
