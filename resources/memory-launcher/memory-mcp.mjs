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
 * `MEMORY_FILE_PATH` 指向该项目 store,stdio 直连、退出码跟随。
 *
 * 零 npm 依赖(Node ≥18 标准库)。空工具应答是「引擎零自研」原则的唯一
 * 显式豁免(见 v3 spec 风险表):newline-delimited JSON-RPC,只应答
 * initialize / tools/list / ping,其余方法返回 -32601。
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
    stdio: "inherit",
  });
  child.on("error", (err) => {
    process.stderr.write(`[pier-memory] engine spawn failed: ${String(err)}\n`);
    process.exit(1);
  });
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
