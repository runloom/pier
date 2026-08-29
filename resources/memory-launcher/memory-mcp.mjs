#!/usr/bin/env node
/**
 * pier-memory MCP 启动器(v3 全局注册架构的运行时解析层)。
 *
 * 各智能体的用户级全局配置固定指向本脚本;本脚本在被拉起时决定服务哪个项目:
 *   1. `PIER_MEMORY_STORE`(memory.jsonl 绝对路径;Pier 的 PTY/任务环境注入)
 *   2. 兜底:cwd 的 `git rev-parse --git-common-dir` → projectKey(与宿主
 *      `resolveProjectIdentity` 同算法);非 git 目录不猜,走空工具应答
 *   3. 项目被用户关闭(账本 desiredState=disabled)或无法解析 → 空工具应答
 *
 * 启用时透传官方引擎:`npx -y @modelcontextprotocol/server-memory@2026.7.4`,
 * `MEMORY_FILE_PATH` 指向该项目 store;stdout 握手期注入 instructions,随后 splice。
 *
 * 零 npm 依赖(Node ≥18 标准库)。「引擎零自研」的显式豁免:空工具应答,以及
 * stdout 握手期注入 instructions(见 2026-08-28 spec)。
 *
 * 测试钩子:`PIER_MEMORY_ENGINE`(JSON 数组命令行)覆盖引擎命令。
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// 引擎走日历版本(npm 从未发布过 0.6.x 之后的 semver;0.6.3 只是包内部
// serverInfo 串)。与宿主 serializers.ENGINE_PACKAGE 由契约测试锁定一致。
export const ENGINE_COMMAND = [
  "npx",
  "-y",
  "@modelcontextprotocol/server-memory@2026.7.4",
];

/**
 * 面向智能体的用法引导。真源在本文件;宿主 AGENTS.md 托管段必须字节相等
 * (launcher-contract 锁)。经 initialize.result.instructions 注入,默认启用
 * 不写仓库。
 */
export const MEMORY_INSTRUCTIONS = [
  "# Project memory (managed by Pier)",
  "",
  'You have persistent project memory tools from the "pier-memory" MCP server.',
  "Use them to make future sessions in this repository more effective:",
  "",
  "- Before starting a non-trivial task, call search_nodes with keywords of the task domain.",
  "- When you learn a durable fact, record it as an observation on the matching entity",
  "  (create the entity when absent). entityType MUST be one of:",
  "  convention | pitfall | decision | environment.",
  "- Do NOT record anything derivable from the codebase (file layout, dependency lists,",
  "  command --help output), transient task state, or secrets/tokens.",
  "- When you notice an observation is outdated, delete it (delete_observations).",
  "  This store has no automatic decay; pruning is your responsibility.",
  "- Keep observations atomic: one fact per observation, self-contained wording.",
].join("\n");

const MAX_STDOUT_BUFFER = 1024 * 1024;
const CONTENT_LENGTH_PREFIX = "content-length:";
const CONTENT_LENGTH_HEADER = /^Content-Length:\s*(\d+)\s*$/im;
const TRAILING_CR = /\r$/;

function ignorePipeError(stream) {
  stream.on("error", () => {
    // 对端关掉管道时的 EPIPE 不是启动失败,跟随子进程退出。
  });
}

export function applyMemoryInstructions(result) {
  if (result === null || typeof result !== "object" || Array.isArray(result)) {
    return result;
  }
  const existing = result.instructions;
  if (typeof existing === "string" && existing.includes(MEMORY_INSTRUCTIONS)) {
    return result;
  }
  const prefix =
    typeof existing === "string" && existing.trim().length > 0
      ? `${existing}\n\n`
      : "";
  return { ...result, instructions: `${prefix}${MEMORY_INSTRUCTIONS}` };
}

export function isInitializeSuccess(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return false;
  }
  if (message.jsonrpc !== "2.0" || message.error) {
    return false;
  }
  const result = message.result;
  if (result === null || typeof result !== "object" || Array.isArray(result)) {
    return false;
  }
  return (
    typeof result.protocolVersion === "string" &&
    result.serverInfo !== null &&
    typeof result.serverInfo === "object" &&
    result.capabilities !== null &&
    typeof result.capabilities === "object"
  );
}

function encodeContentLengthFrame(message) {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.from(
    `Content-Length: ${payload.length}\r\n\r\n`,
    "utf8"
  );
  return Buffer.concat([header, payload]);
}

function leadingWsLength(buffer) {
  let index = 0;
  while (index < buffer.length) {
    const byte = buffer[index];
    if (byte !== 0x09 && byte !== 0x0a && byte !== 0x0d && byte !== 0x20) {
      break;
    }
    index += 1;
  }
  return index;
}

function contentLengthPrefixState(buffer) {
  const take = Math.min(buffer.length, CONTENT_LENGTH_PREFIX.length);
  const available = buffer.toString("utf8", 0, take).toLowerCase();
  if (CONTENT_LENGTH_PREFIX.startsWith(available)) {
    return available.length < CONTENT_LENGTH_PREFIX.length ? "maybe" : "yes";
  }
  return "no";
}

function consumeContentLength(buffer) {
  const sep = buffer.indexOf("\r\n\r\n");
  if (sep < 0) {
    return buffer.length > MAX_STDOUT_BUFFER
      ? { action: "raw" }
      : { action: "need-more" };
  }
  const header = buffer.subarray(0, sep).toString("utf8");
  const match = CONTENT_LENGTH_HEADER.exec(header);
  if (!match) {
    return { action: "raw" };
  }
  const size = Number(match[1]);
  if (!Number.isFinite(size) || size < 0 || size > MAX_STDOUT_BUFFER) {
    return { action: "raw" };
  }
  const bodyStart = sep + 4;
  if (buffer.length < bodyStart + size) {
    return { action: "need-more" };
  }
  const original = buffer.subarray(0, bodyStart + size);
  const rest = buffer.subarray(bodyStart + size);
  let message;
  try {
    message = JSON.parse(
      buffer.subarray(bodyStart, bodyStart + size).toString("utf8")
    );
  } catch {
    return { action: "pass", frame: original, rest };
  }
  if (!isInitializeSuccess(message)) {
    return { action: "pass", frame: original, rest };
  }
  return {
    action: "rewrite",
    frame: encodeContentLengthFrame({
      ...message,
      result: applyMemoryInstructions(message.result),
    }),
    rest,
  };
}

function consumeNdjson(buffer) {
  const nl = buffer.indexOf(0x0a);
  if (nl < 0) {
    return buffer.length > MAX_STDOUT_BUFFER
      ? { action: "raw" }
      : { action: "need-more" };
  }
  const original = buffer.subarray(0, nl + 1);
  const rest = buffer.subarray(nl + 1);
  const line = buffer.subarray(0, nl).toString("utf8").replace(TRAILING_CR, "");
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return { action: "pass", frame: original, rest };
  }
  if (!isInitializeSuccess(message)) {
    return { action: "pass", frame: original, rest };
  }
  return {
    action: "rewrite",
    frame: Buffer.from(
      `${JSON.stringify({
        ...message,
        result: applyMemoryInstructions(message.result),
      })}\n`,
      "utf8"
    ),
    rest,
  };
}

function consumeStdout(buffer) {
  if (buffer.length === 0) {
    return { action: "need-more" };
  }
  if (leadingWsLength(buffer) > 0) {
    return leadingWsLength(buffer) === buffer.length &&
      buffer.length <= MAX_STDOUT_BUFFER
      ? { action: "need-more" }
      : { action: "raw" };
  }
  if (buffer[0] === 0x7b) {
    return consumeNdjson(buffer);
  }
  const prefix = contentLengthPrefixState(buffer);
  if (prefix === "maybe") {
    return buffer.length > MAX_STDOUT_BUFFER
      ? { action: "raw" }
      : { action: "need-more" };
  }
  if (prefix === "yes") {
    return consumeContentLength(buffer);
  }
  return { action: "raw" };
}

/** 握手期拦引擎 stdout:改写 initialize 成功应答后 splice 回原始管道。 */
export function attachEngineStdoutIntercept(src, dest) {
  let buffer = Buffer.alloc(0);
  let done = false;

  function splice(rest) {
    if (done) {
      return;
    }
    done = true;
    src.pause();
    src.off("data", onData);
    src.off("end", onEnd);
    if (rest.length > 0) {
      dest.write(rest);
    }
    src.pipe(dest, { end: false });
    src.resume();
  }

  function onEnd() {
    if (done) {
      return;
    }
    done = true;
    if (buffer.length > 0) {
      dest.write(buffer);
    }
  }

  function onData(chunk) {
    if (done) {
      return;
    }
    buffer = Buffer.concat([buffer, chunk]);
    while (!done && buffer.length > 0) {
      const outcome = consumeStdout(buffer);
      if (outcome.action === "need-more") {
        if (buffer.length > MAX_STDOUT_BUFFER) {
          splice(buffer);
          buffer = Buffer.alloc(0);
        }
        return;
      }
      if (outcome.action === "raw") {
        splice(buffer);
        buffer = Buffer.alloc(0);
        return;
      }
      dest.write(outcome.frame);
      buffer = Buffer.from(outcome.rest);
      if (outcome.action === "rewrite") {
        splice(buffer);
        buffer = Buffer.alloc(0);
        return;
      }
    }
  }

  ignorePipeError(src);
  ignorePipeError(dest);
  src.on("data", onData);
  src.on("end", onEnd);
}

/** 与宿主 resolveProjectIdentity 一致:sha256(realpath(commonDir)) 前 16 位。 */
export function projectKeyForCommonDir(commonDirRealPath) {
  return createHash("sha256")
    .update(commonDirRealPath)
    .digest("hex")
    .slice(0, 16);
}

/** cwd 兜底解析:仅 git 目录(commonDir 收敛主仓/worktree);非 git 返回 null。 */
export function deriveStorePathFromCwd(cwd, home = homedir()) {
  let root;
  try {
    root = realpathSync(cwd);
  } catch {
    return null;
  }
  const probe = spawnSync("git", ["rev-parse", "--git-common-dir"], {
    cwd: root,
    encoding: "utf8",
  });
  if (probe.status !== 0 || typeof probe.stdout !== "string") {
    return null;
  }
  const line = probe.stdout
    .split("\n")
    .map((item) => item.trim())
    .find(Boolean);
  if (!line) {
    return null;
  }
  let commonDir;
  try {
    commonDir = realpathSync(resolve(root, line));
  } catch {
    return null;
  }
  const key = projectKeyForCommonDir(commonDir);
  return join(home, ".pier", "memory", key, "memory.jsonl");
}

/** env 优先,cwd 兜底;返回 null = 无法解析。 */
export function resolveStorePath(env, cwd, home = homedir()) {
  const injected = (env.PIER_MEMORY_STORE ?? "").trim();
  if (injected && isAbsolute(injected)) {
    return injected;
  }
  return deriveStorePathFromCwd(cwd, home);
}

/** 账本缺失 = 默认启用;仅 desiredState=disabled 停用。 */
export function isStoreEnabled(storePath) {
  try {
    const raw = readFileSync(join(dirname(storePath), "ledger.json"), "utf8");
    const parsed = JSON.parse(raw);
    return parsed?.desiredState !== "disabled";
  } catch {
    return true;
  }
}

/** 测试钩子:仅当 PIER_MEMORY_ENGINE_TEST=1 时生效;非法 JSON/空数组一律回退默认。 */
export function engineCommand(env) {
  if (env.PIER_MEMORY_ENGINE_TEST !== "1") {
    return ENGINE_COMMAND;
  }
  const override = (env.PIER_MEMORY_ENGINE ?? "").trim();
  if (!override) {
    return ENGINE_COMMAND;
  }
  try {
    const parsed = JSON.parse(override);
    if (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every((p) => typeof p === "string" && p.length > 0)
    ) {
      return parsed;
    }
  } catch {
    // 非法 JSON:忽略,回退默认引擎。
  }
  return ENGINE_COMMAND;
}

function runEngine(storePath) {
  // 引擎的 saveGraph 不建父目录(已核实上游源码):默认启用的项目在此兜底建目录,
  // 否则首次写工具即 ENOENT。
  try {
    mkdirSync(dirname(storePath), { mode: 0o700, recursive: true });
  } catch {
    // 建目录失败(如只读盘)交给引擎自身报错,不在此吞掉启动。
  }
  const [bin, ...args] = engineCommand(process.env);
  const child = spawn(bin, args, {
    env: { ...process.env, MEMORY_FILE_PATH: storePath },
    stdio: ["pipe", "pipe", "inherit"],
  });
  child.on("error", (err) => {
    process.stderr.write(`[pier-memory] engine spawn failed: ${String(err)}\n`);
    process.exit(1);
  });
  ignorePipeError(child.stdin);
  ignorePipeError(process.stdin);
  process.stdin.pipe(child.stdin);
  attachEngineStdoutIntercept(child.stdout, process.stdout);
  const forward = (signal) => {
    child.kill(signal);
  };
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, forward);
  }
  child.on("exit", (code, signal) => {
    if (signal) {
      // re-raise 前必须摘掉自己的监听器,否则信号被自身 handler 吞掉、
      // 事件循环也被监听器钉住 → 每个会话泄漏一个僵尸启动器。
      for (const name of ["SIGINT", "SIGTERM"]) {
        process.removeListener(name, forward);
      }
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

/** 空工具 MCP 应答:关闭/无法解析时保持协议健康,智能体侧零错误噪声。 */
export function stubResponse(message) {
  if (typeof message?.id === "undefined") {
    return null;
  }
  const base = { id: message.id, jsonrpc: "2.0" };
  if (message.method === "initialize") {
    const requested = message.params?.protocolVersion;
    return {
      ...base,
      result: {
        capabilities: { tools: {} },
        protocolVersion:
          typeof requested === "string" ? requested : "2025-06-18",
        serverInfo: { name: "pier-memory", version: "0.0.0-disabled" },
      },
    };
  }
  if (message.method === "tools/list") {
    return { ...base, result: { tools: [] } };
  }
  if (message.method === "ping") {
    return { ...base, result: {} };
  }
  return {
    ...base,
    error: {
      code: -32_601,
      message: `method not available: ${message.method}`,
    },
  };
}

function runStub() {
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let idx = buffer.indexOf("\n");
    while (idx >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      idx = buffer.indexOf("\n");
      if (!line) {
        continue;
      }
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      const response = stubResponse(message);
      if (response) {
        process.stdout.write(`${JSON.stringify(response)}\n`);
      }
    }
  });
  process.stdin.on("end", () => {
    process.exit(0);
  });
}

function main() {
  const storePath = resolveStorePath(process.env, process.cwd());
  if (storePath && isStoreEnabled(storePath)) {
    runEngine(storePath);
    return;
  }
  runStub();
}

const isDirectRun = (() => {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  main();
}
