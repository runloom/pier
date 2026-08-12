#!/usr/bin/env node
/**
 * W6-S2 假协调智能体剧本（文档化步骤；需 Pier 已启动 + local-control socket）。
 *
 * 协调者不经 Pier one-shot：
 *  1) 可选：原生 agent CLI（本脚本不调用，仅注释）
 *  2) pier agents catalog → start → turn → screen（v2）
 *
 * 用法：
 *   node scripts/w6-fake-coordinator.mjs [--agent-id codex] [--cwd /path]
 *
 * 环境：PIER_CONTROL_SOCKET 或默认 userData socket。
 */
import { randomBytes } from "node:crypto";
import { parsePierCliArgs } from "../bin/pier-cli-parser.js";

function effectKey() {
  return randomBytes(24).toString("base64url");
}

function usage() {
  console.log(`W6-S2 fake coordinator checklist

1. Start Pier (dev) so local-control socket is up.
2. Optional one-shot outside Pier, e.g.: codex exec "summarize repo"
3. Run durable control via pier CLI:

   pier agents catalog --json
   pier agents start --agent <id> --cwd <project> --operation-id <ek> --json
   pier agents turn --boot <boot> --runtime <rid> --generation <g> --text 'hi' --operation-id <ek2> --json
   pier agents screen --boot <boot> --runtime <rid> --generation <g> --json

This script only validates CLI parse surface for the above ops.
`);
}

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  usage();
  process.exit(0);
}

const agentId = (() => {
  const i = argv.indexOf("--agent-id");
  return i >= 0 ? argv[i + 1] : "codex";
})();
const cwd = (() => {
  const i = argv.indexOf("--cwd");
  return i >= 0 ? argv[i + 1] : process.cwd();
})();

const steps = [
  ["agents", "catalog", "--json"],
  [
    "agents",
    "start",
    "--agent",
    agentId,
    "--cwd",
    cwd,
    "--operation-id",
    effectKey(),
    "--json",
  ],
];

for (const args of steps) {
  const parsed = parsePierCliArgs(args);
  console.log(JSON.stringify({ step: args.join(" "), parsed }, null, 2));
}

console.log(
  "\nOK: CLI surface parse for coordinator steps. Run live pier commands against a running host for full I-coord-1."
);
