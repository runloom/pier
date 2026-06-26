#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

function usage() {
  return [
    "Usage:",
    "  pier open <path> [--window <windowId>] [--split <direction>] [--no-focus] --json",
    "  pier status --json",
    "  pier windows list --json",
    "  pier windows focus <windowId> --json",
    "  pier panels list [--window <windowId>] --json",
    "  pier panels focus <panelId> [--window <windowId>] [--no-focus] --json",
    "  pier worktrees list --path <path> --json",
    "  pier worktrees create --path <repo> --name <dir> --branch <branch> --base <ref> --json",
    "  pier worktrees open <path> --json",
    "  pier plugins list --json",
    "  pier plugins inspect <id> --json",
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
  if (index < 0) {
    return;
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`missing required value for ${name}`);
  }
  return value;
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
      arg === "--no-focus" ||
      arg === "--path" ||
      arg === "--name" ||
      arg === "--branch" ||
      arg === "--base"
    ) {
      if (
        arg === "--window" ||
        arg === "--split" ||
        arg === "--path" ||
        arg === "--name" ||
        arg === "--branch" ||
        arg === "--base"
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

function absolutePath(path, cwd) {
  return isAbsolute(path) ? path : resolve(cwd, path);
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
  throw new Error("unknown pier CLI command");
}

function parseCommand(args, cwd) {
  const [domain, action, value, unexpected] = stripOptions(args);
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

function parseArgs(argv) {
  const printEnvelope = argv.includes("--print-envelope");
  const json = argv.includes("--json");
  const args = argv.filter(
    (arg) => arg !== "--json" && arg !== "--print-envelope"
  );
  return {
    envelope: {
      clientId: "cli-local",
      command: parseCommand(args, process.cwd()),
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

function asObject(value) {
  return value && typeof value === "object" ? value : null;
}

function panelWindowOrdinals(panels) {
  const windowOrdinalById = new Map();
  for (const panel of panels) {
    if (!panel?.windowId || windowOrdinalById.has(panel.windowId)) {
      continue;
    }
    windowOrdinalById.set(panel.windowId, windowOrdinalById.size + 1);
  }
  return windowOrdinalById;
}

function panelGroupHeading(panel, groupIndex, windowOrdinalById) {
  const headingParts = [`窗口 ${windowOrdinalById.get(panel.windowId) ?? 1}`];
  if (panel.windowFocused) {
    headingParts.push("当前窗口");
  }
  headingParts.push(`第 ${groupIndex + 1} 组`);
  return headingParts.join(" · ");
}

function formatPanelLines(panels) {
  const lines = [];
  const windowOrdinalById = panelWindowOrdinals(panels);
  let currentGroupKey = "";
  for (const panel of panels) {
    if (!panel?.windowId) {
      continue;
    }
    const groupIndex = Number.isFinite(panel.groupIndex) ? panel.groupIndex : 0;
    const groupKey = `${panel.windowId}:${groupIndex}`;
    if (groupKey !== currentGroupKey) {
      currentGroupKey = groupKey;
      if (lines.length > 0) {
        lines.push("");
      }
      lines.push(panelGroupHeading(panel, groupIndex, windowOrdinalById));
    }
    const tabIndex = Number.isFinite(panel.tabIndex) ? panel.tabIndex : 0;
    const tabCount = Number.isFinite(panel.tabCount) ? panel.tabCount : 1;
    const marker = panel.windowFocused && panel.active ? "✓" : " ";
    const title = panel.display?.short || panel.id || "Panel";
    lines.push(
      `  ${marker} ${title}  标签 ${tabIndex + 1}/${tabCount}  panel ${panel.id}  window ${panel.windowId}`
    );
    if (panel.context?.cwd) {
      lines.push(`    ${panel.context.cwd}`);
    }
  }
  return lines;
}

function formatPanelErrorLines(errors) {
  const lines = [];
  if (errors.length > 0) {
    lines.push("错误");
    for (const error of errors) {
      const message = error?.message || String(error);
      const windowId = error?.windowId ? `${error.windowId}: ` : "";
      lines.push(`  ${windowId}${message}`);
    }
  }
  return lines;
}

function appendSection(lines, section) {
  if (section.length === 0) {
    return;
  }
  if (lines.length > 0) {
    lines.push("");
  }
  lines.push(...section);
}

function formatPanelList(data) {
  const snapshot = asObject(data);
  let panels = [];
  if (Array.isArray(data)) {
    panels = data;
  } else if (Array.isArray(snapshot?.panels)) {
    panels = snapshot.panels;
  }
  const errors = Array.isArray(snapshot?.errors) ? snapshot.errors : [];
  const lines = [];
  appendSection(lines, formatPanelLines(panels));
  appendSection(lines, formatPanelErrorLines(errors));
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
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
  } else if (parsed.envelope.command.type === "panel.list" && result.ok) {
    const output = formatPanelList(result.data);
    if (output) {
      process.stdout.write(output);
    }
  } else if (!result.ok) {
    const code = result.error?.code ?? "error";
    const message = result.error?.message ?? "command failed";
    console.error(`${code}: ${message}`);
  }
  process.exit(result.ok ? 0 : 1);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(usage());
  process.exit(1);
}
