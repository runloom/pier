#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  hasPierCliOption,
  parsePierCliArgs,
  usage,
} from "./pier-cli-parser.js";

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

function profileDetailLines(profile) {
  const record = asObject(profile);
  if (!record) {
    return ["  (empty)"];
  }
  const lines = [];
  if (record.command) {
    lines.push(`  command: ${record.command}`);
  }
  if (record.cwd) {
    lines.push(`  cwd: ${record.cwd}`);
  }
  const env = asObject(record.env);
  if (env) {
    const keys = Object.keys(env).sort();
    if (keys.length > 0) {
      lines.push(`  env: ${keys.join(", ")}`);
    }
  }
  return lines.length > 0 ? lines : ["  (empty)"];
}

function formatTerminalProfileList(data) {
  const profiles = asObject(data);
  if (!profiles) {
    return "";
  }
  const lines = [];
  for (const profileId of Object.keys(profiles).sort()) {
    lines.push(profileId, ...profileDetailLines(profiles[profileId]));
  }
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

function formatTerminalProfile(profileId, data) {
  return `${profileId}\n${profileDetailLines(data).join("\n")}\n`;
}

function parseArgs(argv) {
  return {
    ...parsePierCliArgs(argv),
    printEnvelope: hasPierCliOption(argv, "--print-envelope"),
  };
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
  } else if (
    parsed.envelope.command.type === "terminal.profile.list" &&
    result.ok
  ) {
    const output = formatTerminalProfileList(result.data);
    if (output) {
      process.stdout.write(output);
    }
  } else if (
    (parsed.envelope.command.type === "terminal.profile.read" ||
      parsed.envelope.command.type === "terminal.profile.upsert") &&
    result.ok
  ) {
    process.stdout.write(
      formatTerminalProfile(parsed.envelope.command.profileId, result.data)
    );
  } else if (
    parsed.envelope.command.type === "terminal.profile.delete" &&
    result.ok
  ) {
    process.stdout.write(
      result.data
        ? `deleted ${parsed.envelope.command.profileId}\n`
        : `not found ${parsed.envelope.command.profileId}\n`
    );
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
