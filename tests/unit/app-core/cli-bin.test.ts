import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
        command: { path: resolve("."), type: "panel.open" },
      },
      json: true,
    });
  });

  it("解析窗口、分屏和 focus 参数", async () => {
    const { stdout } = await execFileAsync("node", [
      "bin/pier.mjs",
      "open",
      ".",
      "--window",
      "main",
      "--split",
      "below",
      "--no-focus",
      "--json",
      "--print-envelope",
    ]);

    expect(JSON.parse(stdout)).toMatchObject({
      envelope: {
        command: {
          focus: false,
          path: resolve("."),
          placement: "split-below",
          type: "panel.open",
          windowId: "main",
        },
      },
      json: true,
    });
  });

  it("解析 worktrees 命令并输出命令信封", async () => {
    const list = await execFileAsync("node", [
      "bin/pier.mjs",
      "worktrees",
      "list",
      "--path",
      ".",
      "--json",
      "--print-envelope",
    ]);
    expect(JSON.parse(list.stdout)).toMatchObject({
      envelope: {
        command: { path: resolve("."), type: "worktree.list" },
      },
      json: true,
    });

    const create = await execFileAsync("node", [
      "bin/pier.mjs",
      "worktrees",
      "create",
      "--path",
      ".",
      "--name",
      "feature-a",
      "--branch",
      "feature/a",
      "--base",
      "origin/main",
      "--json",
      "--print-envelope",
    ]);
    expect(JSON.parse(create.stdout)).toMatchObject({
      envelope: {
        command: {
          base: "origin/main",
          branch: "feature/a",
          name: "feature-a",
          path: resolve("."),
          type: "worktree.create",
        },
      },
      json: true,
    });

    const open = await execFileAsync("node", [
      "bin/pier.mjs",
      "worktrees",
      "open",
      ".",
      "--no-focus",
      "--json",
      "--print-envelope",
    ]);
    expect(JSON.parse(open.stdout)).toMatchObject({
      envelope: {
        command: { focus: false, path: resolve("."), type: "worktree.open" },
      },
      json: true,
    });
  });

  it("usage 包含 worktrees 命令", async () => {
    await expect(
      execFileAsync("node", ["bin/pier.mjs", "unknown-command"])
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "pier worktrees create --path <repo> --name <dir> --branch <branch> --base <ref> --json"
      ),
    });
  });

  it("拒绝 terminals open --cwd 旧入口", async () => {
    await expect(
      execFileAsync("node", [
        "bin/pier.mjs",
        "terminals",
        "open",
        "--cwd",
        ".",
        "--json",
        "--print-envelope",
      ])
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("unknown pier CLI command"),
    });
  });

  it("usage 不再包含 terminal open/list/focus", async () => {
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
      stderr: expect.not.stringContaining("pier terminals open"),
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

  it("panels list 没有 --json 时输出窗口和组分段", async () => {
    const userDataDir = await makeTempDir();
    const socketPath = resolveLocalControlSocketPath(userDataDir, "darwin");
    const server = createPierLocalControlServer({
      handleRequest: (envelope) => {
        const parsed = pierCommandEnvelopeSchema.parse(envelope);
        return Promise.resolve({
          data: {
            errors: [],
            panels: [
              {
                active: true,
                context: {
                  contextId: "ctx-pier",
                  cwd: "/Users/xyz/ABC/pier",
                  openedPath: "/Users/xyz/ABC/pier",
                  projectRoot: "/Users/xyz/ABC/pier",
                  source: "panel",
                  updatedAt: 1,
                  worktreeKey: "/Users/xyz/ABC/pier",
                },
                display: { short: "pier" },
                groupIndex: 0,
                id: "terminal-1",
                kind: "terminal",
                recordId: "record-main",
                tabCount: 2,
                tabIndex: 0,
                windowFocused: true,
                windowId: "main",
              },
              {
                active: true,
                context: {
                  contextId: "ctx-bay",
                  cwd: "/Users/xyz/ABC/bay",
                  openedPath: "/Users/xyz/ABC/bay",
                  projectRoot: "/Users/xyz/ABC/bay",
                  source: "panel",
                  updatedAt: 1,
                  worktreeKey: "/Users/xyz/ABC/bay",
                },
                display: { short: "bay" },
                groupIndex: 0,
                id: "terminal-2",
                kind: "terminal",
                recordId: "record-secondary",
                tabCount: 1,
                tabIndex: 0,
                windowFocused: false,
                windowId: "secondary",
              },
            ],
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
      ["bin/pier.mjs", "panels", "list"],
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
            message: "panel not found: missing",
          },
          ok: false,
          requestId: parsed.requestId,
        });
      },
      socketPath,
    });
    await server.start();

    await expect(
      execFileAsync("node", ["bin/pier.mjs", "panels", "focus", "missing"], {
        env: { ...process.env, PIER_CONTROL_SOCKET_PATH: socketPath },
      })
    ).rejects.toMatchObject({
      stderr: "not_found: panel not found: missing\n",
    });
    await server.close();
  });
});
