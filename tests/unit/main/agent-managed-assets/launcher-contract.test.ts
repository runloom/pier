/**
 * biome-ignore-all lint/correctness/useImportExtensions: 启动器是随包资源
 * (零依赖纯 Node .mjs,类型见同目录 .d.mts);真实扩展名就是 .mjs,自动修复
 * 会误改成 .mjs.mts。多行 import 上的行级抑制不生效,只能文件级。
 */
import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { resolveProjectIdentity } from "@main/services/agent-managed-assets/project-identity.ts";
import { ENGINE_PACKAGE } from "@main/services/agent-managed-assets/serializers.ts";
import { afterEach, describe, expect, it } from "vitest";
// 启动器是随包资源(零依赖纯 Node),契约测试直接驱动源文件(类型见同目录 .d.mts)。
import {
  deriveStorePathFromCwd,
  ENGINE_COMMAND,
  engineCommand,
  isStoreEnabled,
  resolveStorePath,
  stubResponse,
} from "../../../../resources/memory-launcher/memory-mcp.mjs";

const LAUNCHER = join(
  process.cwd(),
  "resources/memory-launcher/memory-mcp.mjs"
);

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return realpathSync(dir);
}

interface LauncherRun {
  exitCode: number | null;
  stdout: string;
}

/** 起启动器子进程,喂 stdin 行,收满 expectLines 行后关 stdin。 */
function runLauncher(args: {
  cwd: string;
  env: Record<string, string>;
  expectLines: number;
  stdinLines: string[];
}): Promise<LauncherRun> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [LAUNCHER], {
      cwd: args.cwd,
      env: { ...process.env, ...args.env },
      stdio: ["pipe", "pipe", "inherit"],
    });
    let stdout = "";
    let closed = false;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      rejectPromise(new Error(`launcher timed out; stdout so far: ${stdout}`));
    }, 15_000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      const lines = stdout.split("\n").filter(Boolean);
      if (!closed && lines.length >= args.expectLines) {
        closed = true;
        child.stdin.end();
      }
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      rejectPromise(err);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolvePromise({ exitCode: code, stdout });
    });
    for (const line of args.stdinLines) {
      child.stdin.write(`${line}\n`);
    }
    if (args.expectLines === 0) {
      child.stdin.end();
    }
  });
}

describe("memory launcher: engine pin parity", () => {
  it("keeps the launcher engine command in lockstep with the host constant", () => {
    // 启动器是零依赖资源脚本,无法 import 宿主常量;用契约测试锁两份定义一致。
    expect([...ENGINE_COMMAND]).toEqual(["npx", "-y", ENGINE_PACKAGE]);
  });

  it("pins a real calendar version (0.6.x-era semver was never published)", () => {
    // 该包 0.6.2 之后改用 CalVer;"0.6.3" 只是包内部 serverInfo 串,npm 上不存在。
    expect(ENGINE_PACKAGE).toMatch(
      /^@modelcontextprotocol\/server-memory@\d{4}\.\d{1,2}\.\d{1,2}$/
    );
  });

  it("honors the engine override only under the test gate and never crashes on bad input", () => {
    const good = JSON.stringify(["node", "/x.mjs"]);
    expect([
      ...engineCommand({
        PIER_MEMORY_ENGINE: good,
        PIER_MEMORY_ENGINE_TEST: "1",
      }),
    ]).toEqual(["node", "/x.mjs"]);
    // 未开门闩:覆盖被忽略(生产不接受任意命令注入面)。
    expect([...engineCommand({ PIER_MEMORY_ENGINE: good })]).toEqual([
      ...ENGINE_COMMAND,
    ]);
    // 非法 JSON / 空数组 / 非字符串数组:一律回退默认,不抛。
    for (const bad of ["not json", "[]", '["ok", 5]']) {
      expect([
        ...engineCommand({
          PIER_MEMORY_ENGINE: bad,
          PIER_MEMORY_ENGINE_TEST: "1",
        }),
      ]).toEqual([...ENGINE_COMMAND]);
    }
  });
});

describe("memory launcher: project resolution", () => {
  it("derives the same project key as the host resolver", async () => {
    const repo = tmp("pier-launcher-repo-");
    execFileSync("git", ["init", "-q"], { cwd: repo });
    const home = tmp("pier-launcher-home-");
    const identity = await resolveProjectIdentity(repo);
    const derived = deriveStorePathFromCwd(repo, home) as string | null;
    expect(derived).toBe(
      join(home, ".pier", "memory", identity.key, "memory.jsonl")
    );
  });

  it("refuses to guess identity outside a git repo", () => {
    const plain = tmp("pier-launcher-plain-");
    const home = tmp("pier-launcher-home2-");
    expect(deriveStorePathFromCwd(plain, home)).toBeNull();
  });

  it("prefers the injected absolute store path over cwd", () => {
    const injected = "/abs/store/memory.jsonl";
    expect(
      resolveStorePath({ PIER_MEMORY_STORE: injected }, "/anywhere", "/home")
    ).toBe(injected);
    expect(
      resolveStorePath({ PIER_MEMORY_STORE: "relative/x" }, tmp("p-"), "/home")
    ).toBeNull();
  });

  it("treats a missing ledger as enabled and disabled state as off", () => {
    const dir = tmp("pier-launcher-ledger-");
    const store = join(dir, "k1", "memory.jsonl");
    expect(isStoreEnabled(store)).toBe(true);
    mkdirSync(dirname(store), { recursive: true });
    writeFileSync(
      join(dirname(store), "ledger.json"),
      JSON.stringify({ desiredState: "disabled" })
    );
    expect(isStoreEnabled(store)).toBe(false);
  });
});

describe("memory launcher: stub protocol", () => {
  it("answers initialize/tools/list and rejects unknown methods", () => {
    const init = stubResponse({
      id: 1,
      jsonrpc: "2.0",
      method: "initialize",
      params: { protocolVersion: "2026-01-01" },
    });
    expect(init?.result?.serverInfo?.name).toBe("pier-memory");
    expect(init?.result?.protocolVersion).toBe("2026-01-01");
    expect(
      stubResponse({ id: 2, jsonrpc: "2.0", method: "tools/list" })?.result
    ).toEqual({ tools: [] });
    expect(
      stubResponse({ id: 3, jsonrpc: "2.0", method: "resources/list" })?.error
        ?.code
    ).toBe(-32_601);
    expect(
      stubResponse({ jsonrpc: "2.0", method: "notifications/initialized" })
    ).toBeNull();
  });

  it("serves the stub over stdio for a disabled project and exits cleanly", async () => {
    const dir = tmp("pier-launcher-stub-");
    const store = join(dir, "key", "memory.jsonl");
    mkdirSync(dirname(store), { recursive: true });
    writeFileSync(
      join(dirname(store), "ledger.json"),
      JSON.stringify({ desiredState: "disabled" })
    );
    const run = await runLauncher({
      cwd: dir,
      env: { PIER_MEMORY_STORE: store },
      expectLines: 2,
      stdinLines: [
        JSON.stringify({
          id: 1,
          jsonrpc: "2.0",
          method: "initialize",
          params: { protocolVersion: "2026-01-01" },
        }),
        JSON.stringify({ id: 2, jsonrpc: "2.0", method: "tools/list" }),
      ],
    });
    expect(run.exitCode).toBe(0);
    const lines = run.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines).toHaveLength(2);
    expect(
      (lines[0]?.result as { serverInfo?: { name?: string } })?.serverInfo?.name
    ).toBe("pier-memory");
    expect((lines[1]?.result as { tools?: unknown[] })?.tools).toEqual([]);
  });
});

describe("memory launcher: engine passthrough", () => {
  it("creates the store dir, spawns the engine with MEMORY_FILE_PATH and follows its exit", async () => {
    const dir = tmp("pier-launcher-engine-");
    const store = join(dir, "key", "memory.jsonl");
    // 账本缺失 = 默认启用。引擎经测试钩子换成回显脚本。
    const echoScript = join(dir, "echo-engine.mjs");
    writeFileSync(
      echoScript,
      'process.stdout.write(String(process.env.MEMORY_FILE_PATH) + "\\n");\n'
    );
    const run = await runLauncher({
      cwd: dir,
      env: {
        PIER_MEMORY_ENGINE: JSON.stringify([process.execPath, echoScript]),
        PIER_MEMORY_ENGINE_TEST: "1",
        PIER_MEMORY_STORE: store,
      },
      expectLines: 0,
      stdinLines: [],
    });
    expect(run.exitCode).toBe(0);
    expect(run.stdout.trim()).toBe(store);
    // 引擎 saveGraph 不建父目录:启动器必须先把 store 目录兜底建出来。
    expect(existsSync(dirname(store))).toBe(true);
  });

  it("terminates (no zombie) when the client sends SIGTERM to a running engine", async () => {
    const dir = tmp("pier-launcher-signal-");
    const store = join(dir, "key", "memory.jsonl");
    // 长驻假引擎:只挂着不退出,等信号。
    const sleeper = join(dir, "sleep-engine.mjs");
    writeFileSync(sleeper, "setInterval(() => {}, 1000);\n");
    const exit = await new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolvePromise, rejectPromise) => {
      const child = spawn(process.execPath, [LAUNCHER], {
        cwd: dir,
        env: {
          ...process.env,
          PIER_MEMORY_ENGINE: JSON.stringify([process.execPath, sleeper]),
          PIER_MEMORY_ENGINE_TEST: "1",
          PIER_MEMORY_STORE: store,
        },
        stdio: ["pipe", "ignore", "inherit"],
      });
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        rejectPromise(new Error("launcher leaked as a zombie after SIGTERM"));
      }, 10_000);
      child.on("exit", (code, signal) => {
        clearTimeout(timer);
        resolvePromise({ code, signal });
      });
      // 等引擎起来再发信号。
      setTimeout(() => {
        child.kill("SIGTERM");
      }, 600);
    });
    // 信号透传引擎 → 引擎按信号退出 → 启动器摘监听器后 re-raise,自身按信号终止。
    expect(exit.signal).toBe("SIGTERM");
  });
});
