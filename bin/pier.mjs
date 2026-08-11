#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  hasPierCliOption,
  parsePierCliArgs,
  usage,
} from "./pier-cli-parser.js";
import { invokePierControlV2 } from "./pier-control-v2-client.js";

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SOCKET_FILENAME = "pier-control.sock";
const UNIX_SOCKET_PATH_MAX_BYTES = 103;

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
  const socketPath = join(userDataDir, SOCKET_FILENAME);
  if (Buffer.byteLength(socketPath) <= UNIX_SOCKET_PATH_MAX_BYTES) {
    return socketPath;
  }
  return join(tmpdir(), `pier-control-${shortHash(userDataDir)}.sock`);
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

function safeClientEnv(env) {
  return Object.fromEntries(
    Object.entries(env).filter(
      ([key, value]) => ENV_KEY_PATTERN.test(key) && typeof value === "string"
    )
  );
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

function parseArgs(argv, { includeClientEnv = true } = {}) {
  return {
    ...parsePierCliArgs(argv, {
      ...(includeClientEnv ? { clientEnv: safeClientEnv(process.env) } : {}),
    }),
    printEnvelope: hasPierCliOption(argv, "--print-envelope"),
  };
}

function formatAgentsCatalog(data) {
  const agents = data?.agents;
  if (!Array.isArray(agents) || agents.length === 0) {
    return "(no agents in catalog)\n";
  }
  return `${agents
    .map((a) => `${a.agentId}\t${a.label}\t${a.availability ?? "?"}`)
    .join("\n")}\n`;
}

function formatAgentsList(data) {
  const entries = data?.entries;
  if (!Array.isArray(entries) || entries.length === 0) {
    return "(no running agents)\n";
  }
  return `${entries
    .map(
      (e) =>
        `${e.agentId}\tpanel=${e.panelId}\twindow=${e.windowId}\tstatus=${e.status ?? "?"}`
    )
    .join("\n")}\n`;
}

function exitCodeForV2Response(response) {
  if (response.ok) {
    return 0;
  }
  const code = response.error?.code;
  if (code === "observation_timeout") {
    return 124;
  }
  return 1;
}

try {
  const rawArgv = process.argv.slice(2);
  const argv = rawArgv[0] === "--" ? rawArgv.slice(1) : rawArgv;
  const printEnvelope = hasPierCliOption(argv, "--print-envelope");
  const parsed = parseArgs(argv, { includeClientEnv: !printEnvelope });
  if (parsed.printEnvelope) {
    if (parsed.protocol === "v2") {
      console.log(
        JSON.stringify(
          {
            protocol: "v2",
            requestId: parsed.requestId,
            op: parsed.op,
            params: parsed.params,
            effectKey: parsed.effectKey,
            expectedBootId: parsed.expectedBootId,
            json: parsed.json,
          },
          null,
          2
        )
      );
    } else {
      console.log(
        JSON.stringify(
          { envelope: parsed.envelope, json: parsed.json },
          null,
          2
        )
      );
    }
    process.exit(0);
  }

  if (parsed.protocol === "v2") {
    const params = parsed.params ?? {};
    // 本机 CLI 一律按本机用户调用，不注入 / 不解析 agent binding 或凭证。
    const { response } = await invokePierControlV2({
      socketPath: resolveSocketPath(),
      requestId: parsed.requestId,
      op: parsed.op,
      params,
      clientKind: "cli-human",
      effectKey: parsed.effectKey,
      expectedBootId: parsed.expectedBootId,
      timeoutMs: 15_000,
    });
    if (parsed.json) {
      console.log(JSON.stringify(response, null, 2));
    } else if (response.ok && parsed.op === "agents.catalog") {
      process.stdout.write(formatAgentsCatalog(response.data));
    } else if (response.ok && parsed.op === "agents.list") {
      process.stdout.write(formatAgentsList(response.data));
    } else if (response.ok && parsed.op === "agents.get") {
      const agent = response.data?.agent;
      if (agent) {
        process.stdout.write(
          `${agent.agentId}\tpanel=${agent.panelId}\twindow=${agent.windowId}\n`
        );
      }
    } else if (!response.ok) {
      const code = response.error?.code ?? "error";
      const message = response.error?.message ?? "command failed";
      console.error(`${code}: ${message}`);
    }
    process.exit(exitCodeForV2Response(response));
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
