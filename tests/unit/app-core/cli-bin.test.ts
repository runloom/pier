import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  createPierLocalControlServer,
  resolveLocalControlSocketPath,
} from "@main/adapters/cli/local-control-server.ts";
import { pierCommandEnvelopeSchema } from "@shared/contracts/commands.ts";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pier-cli-bin-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

describe("bin/pier.mjs", () => {
  it("解析 status 并输出命令信封", async () => {
    const { stdout } = await execFileAsync("node", [
      "bin/pier.mjs",
      "status",
      "--json",
      "--print-envelope",
    ]);

    const parsed = JSON.parse(stdout);
    expect(parsed).toMatchObject({
      envelope: {
        clientId: "cli-local",
        command: { type: "app.status" },
        protocolVersion: 1,
      },
      json: true,
    });
    expect(parsed.envelope.requestId).toEqual(expect.any(String));
  });

  it("忽略 pnpm 传入的前导 -- 分隔符", async () => {
    const { stdout } = await execFileAsync("node", [
      "bin/pier.mjs",
      "--",
      "open",
      ".",
      "--json",
      "--print-envelope",
    ]);

    expect(JSON.parse(stdout)).toMatchObject({
      envelope: {
        command: { path: ".", type: "workspace.open" },
      },
      json: true,
    });
  });

  it("解析窗口和分屏参数", async () => {
    const { stdout } = await execFileAsync("node", [
      "bin/pier.mjs",
      "open",
      ".",
      "--window",
      "main",
      "--split",
      "below",
      "--json",
      "--print-envelope",
    ]);

    expect(JSON.parse(stdout)).toMatchObject({
      envelope: {
        command: {
          path: ".",
          placement: "split-below",
          type: "workspace.open",
          windowId: "main",
        },
      },
      json: true,
    });
  });

  it("拒绝缺少值的窗口参数", async () => {
    await expect(
      execFileAsync("node", [
        "bin/pier.mjs",
        "terminals",
        "list",
        "--window",
        "--json",
        "--print-envelope",
      ])
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("missing required value for --window"),
    });
  });

  it("解析 --no-focus", async () => {
    const { stdout } = await execFileAsync("node", [
      "bin/pier.mjs",
      "open",
      ".",
      "--no-focus",
      "--json",
      "--print-envelope",
    ]);

    expect(JSON.parse(stdout)).toMatchObject({
      envelope: {
        command: {
          focus: false,
          path: ".",
          type: "workspace.open",
        },
      },
      json: true,
    });
  });

  it("usage lists focus commands with --no-focus", async () => {
    await expect(
      execFileAsync("node", ["bin/pier.mjs", "unknown-command"])
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "pier panels focus <panelId> [--window <windowId>] [--no-focus] --json"
      ),
    });
    await expect(
      execFileAsync("node", ["bin/pier.mjs", "unknown-command"])
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "pier terminals focus <panelId> [--window <windowId>] [--no-focus] --json"
      ),
    });
  });

  it("没有 --json 时成功不输出内容", async () => {
    const userDataDir = await makeTempDir();
    const socketPath = resolveLocalControlSocketPath(userDataDir, "darwin");
    const server = createPierLocalControlServer({
      handleRequest: (envelope) => {
        const parsed = pierCommandEnvelopeSchema.parse(envelope);
        return Promise.resolve({
          data: null,
          ok: true,
          requestId: parsed.requestId,
        });
      },
      socketPath,
    });
    await server.start();

    const { stdout } = await execFileAsync("node", ["bin/pier.mjs", "status"], {
      env: { ...process.env, PIER_CONTROL_SOCKET_PATH: socketPath },
    });

    expect(stdout).toBe("");
    await server.close();
  });

  it("terminals list 没有 --json 时输出窗口和组分段", async () => {
    const userDataDir = await makeTempDir();
    const socketPath = resolveLocalControlSocketPath(userDataDir, "darwin");
    const server = createPierLocalControlServer({
      handleRequest: (envelope) => {
        const parsed = pierCommandEnvelopeSchema.parse(envelope);
        return Promise.resolve({
          data: {
            errors: [],
            open: [
              {
                active: true,
                cwd: "/Users/xyz/ABC/pier",
                groupIndex: 0,
                panelId: "terminal-1",
                recordId: "record-main",
                tabCount: 2,
                tabIndex: 0,
                title: "pier",
                windowFocused: true,
                windowId: "main",
              },
              {
                active: true,
                cwd: "/Users/xyz/ABC/bay",
                groupIndex: 0,
                panelId: "terminal-2",
                recordId: "record-secondary",
                tabCount: 1,
                tabIndex: 0,
                title: "bay",
                windowFocused: false,
                windowId: "secondary",
              },
            ],
            recentClosed: [],
          },
          ok: true,
          requestId: parsed.requestId,
        });
      },
      socketPath,
    });
    await server.start();

    const { stdout } = await execFileAsync(
      "node",
      ["bin/pier.mjs", "terminals", "list"],
      {
        env: { ...process.env, PIER_CONTROL_SOCKET_PATH: socketPath },
      }
    );

    expect(stdout).toContain("窗口 1 · 当前窗口 · 第 1 组");
    expect(stdout).toContain("✓ pier");
    expect(stdout).toContain("panel terminal-1");
    expect(stdout).toContain("window main");
    expect(stdout).toContain("窗口 2 · 第 1 组");
    expect(stdout).toContain("bay");
    expect(stdout).toContain("panel terminal-2");
    expect(stdout).toContain("window secondary");
    expect(stdout).not.toContain("✓ bay");
    expect(stdout).toContain("/Users/xyz/ABC/pier");
    await server.close();
  });

  it("prints non-json command failures to stderr", async () => {
    const userDataDir = await makeTempDir();
    const socketPath = resolveLocalControlSocketPath(userDataDir, "darwin");
    const server = createPierLocalControlServer({
      handleRequest: (envelope) => {
        const parsed = pierCommandEnvelopeSchema.parse(envelope);
        return Promise.resolve({
          error: {
            code: "not_found",
            message: "terminal not found: missing",
          },
          ok: false,
          requestId: parsed.requestId,
        });
      },
      socketPath,
    });
    await server.start();

    await expect(
      execFileAsync("node", ["bin/pier.mjs", "terminals", "focus", "missing"], {
        env: { ...process.env, PIER_CONTROL_SOCKET_PATH: socketPath },
      })
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("not_found: terminal not found: missing"),
    });

    await server.close();
  });
});
