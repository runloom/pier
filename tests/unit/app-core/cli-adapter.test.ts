import { parsePierCliArgs } from "@main/adapters/cli/cli-parser.ts";
import { createPierCliCommandClient } from "@main/adapters/cli/local-command-client.ts";
import { resolvePierCliBin } from "@main/adapters/cli/pier-path.ts";
import { describe, expect, it } from "vitest";

describe("resolvePierCliBin", () => {
  it("优先使用 PIER_CLI_PATH", () => {
    expect(
      resolvePierCliBin({
        env: { PIER_CLI_PATH: "/custom/pier" },
        exists: () => false,
        home: "/Users/me",
        which: () => null,
      })
    ).toBe("/custom/pier");
  });

  it("环境变量缺失时使用 PATH 查询结果", () => {
    expect(
      resolvePierCliBin({
        env: {},
        exists: () => false,
        home: "/Users/me",
        which: () => "/opt/bin/pier",
      })
    ).toBe("/opt/bin/pier");
  });

  it("PATH 缺失时使用 macOS app bundle 路径", () => {
    expect(
      resolvePierCliBin({
        env: {},
        exists: (path) =>
          path ===
          "/Users/me/Applications/Pier.app/Contents/Resources/bin/pier",
        home: "/Users/me",
        which: () => null,
      })
    ).toBe("/Users/me/Applications/Pier.app/Contents/Resources/bin/pier");
  });

  it("找不到安装路径时 fallback 到 pier", () => {
    expect(
      resolvePierCliBin({
        env: {},
        exists: () => false,
        home: "/Users/me",
        which: () => null,
      })
    ).toBe("pier");
  });
});

describe("createPierCliCommandClient", () => {
  it("把 argv 解析成命令信封并交给 transport", async () => {
    const seen: unknown[] = [];
    const client = createPierCliCommandClient({
      parseOptions: { clientId: "cli-1", requestId: "req-9" },
      transport: {
        request(envelope) {
          seen.push(envelope);
          return Promise.resolve({
            data: [{ id: "main", focused: true, recordId: "record-main" }],
            ok: true,
            requestId: "req-9",
          });
        },
      },
    });

    await expect(client.run(["windows", "list", "--json"])).resolves.toEqual({
      data: [{ id: "main", focused: true, recordId: "record-main" }],
      ok: true,
      requestId: "req-9",
    });
    expect(seen).toEqual([
      {
        clientId: "cli-1",
        command: { type: "window.list" },
        protocolVersion: 1,
        requestId: "req-9",
      },
    ]);
  });

  it("把解析选项中的 clientEnv 放入命令信封", async () => {
    const seen: unknown[] = [];
    const client = createPierCliCommandClient({
      parseOptions: {
        clientEnv: { PATH: "/cli/bin", PIER_MODE: "dev" },
        clientId: "cli-1",
        requestId: "req-env",
      },
      transport: {
        request(envelope) {
          seen.push(envelope);
          return Promise.resolve({
            data: null,
            ok: true,
            requestId: "req-env",
          });
        },
      },
    });

    await client.run(["status", "--json"]);

    expect(seen).toEqual([
      {
        clientEnv: { PATH: "/cli/bin", PIER_MODE: "dev" },
        clientId: "cli-1",
        command: { type: "app.status" },
        protocolVersion: 1,
        requestId: "req-env",
      },
    ]);
  });
});

describe("parsePierCliArgs", () => {
  it("解析 open path 为 panel.open", () => {
    expect(
      parsePierCliArgs(
        ["open", ".", "--window", "main", "--split", "right", "--json"],
        {
          clientId: "cli-1",
          cwd: "/Users/xyz/ABC/pier",
          requestId: "req-open",
        }
      ).envelope.command
    ).toEqual({
      path: "/Users/xyz/ABC/pier",
      placement: "split-right",
      type: "panel.open",
      windowId: "main",
    });
  });

  it("解析时保留 CLI 进程环境作为信封元数据", () => {
    expect(
      parsePierCliArgs(["status"], {
        clientEnv: { PATH: "/cli/bin", PIER_MODE: "dev" },
        clientId: "cli-1",
        requestId: "req-client-env",
      }).envelope
    ).toEqual({
      clientEnv: { PATH: "/cli/bin", PIER_MODE: "dev" },
      clientId: "cli-1",
      command: { type: "app.status" },
      protocolVersion: 1,
      requestId: "req-client-env",
    });
  });

  it("默认不是 json 输出模式", () => {
    expect(
      parsePierCliArgs(["open", "."], {
        clientId: "cli-1",
        cwd: "/Users/xyz/ABC/pier",
        requestId: "req-open",
      }).json
    ).toBe(false);
  });

  it("解析 --no-focus", () => {
    expect(
      parsePierCliArgs(["open", ".", "--no-focus"], {
        clientId: "cli-1",
        cwd: "/Users/xyz/ABC/pier",
        requestId: "req-open-background",
      }).envelope.command
    ).toEqual({
      focus: false,
      path: "/Users/xyz/ABC/pier",
      type: "panel.open",
    });
  });

  it("解析 windows 和 panels 命令", () => {
    expect(
      parsePierCliArgs(["windows", "list", "--json"], {
        clientId: "cli-1",
        requestId: "req-1",
      }).envelope.command
    ).toEqual({ type: "window.list" });
    expect(
      parsePierCliArgs(["panels", "list", "--window", "main", "--json"], {
        clientId: "cli-1",
        requestId: "req-3",
      }).envelope.command
    ).toEqual({ type: "panel.list", windowId: "main" });
    expect(
      parsePierCliArgs(["panels", "focus", "panel-1", "--no-focus"], {
        clientId: "cli-1",
        requestId: "req-panel-focus-background",
      }).envelope.command
    ).toEqual({
      focus: false,
      panelId: "panel-1",
      type: "panel.focus",
    });
  });

  it("解析 preferences read", () => {
    expect(
      parsePierCliArgs(["preferences", "read", "--json"], {
        clientId: "cli-1",
        requestId: "req-4",
      }).envelope.command
    ).toEqual({ type: "preferences.read" });
  });

  it("解析 worktrees list/create/open", () => {
    expect(
      parsePierCliArgs(["worktrees", "list", "--path", ".", "--json"], {
        clientId: "cli-1",
        cwd: "/Users/xyz/ABC/pier",
        requestId: "req-worktree-list",
      }).envelope.command
    ).toEqual({
      path: "/Users/xyz/ABC/pier",
      type: "worktree.list",
    });

    expect(
      parsePierCliArgs(
        [
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
        ],
        {
          clientId: "cli-1",
          cwd: "/Users/xyz/ABC/pier",
          requestId: "req-worktree-create",
        }
      ).envelope.command
    ).toEqual({
      base: "origin/main",
      branch: "feature/a",
      name: "feature-a",
      path: "/Users/xyz/ABC/pier",
      type: "worktree.create",
    });

    expect(
      parsePierCliArgs(["worktrees", "open", "../linked", "--no-focus"], {
        clientId: "cli-1",
        cwd: "/Users/xyz/ABC/pier",
        requestId: "req-worktree-open",
      }).envelope.command
    ).toEqual({
      focus: false,
      path: "/Users/xyz/ABC/linked",
      type: "worktree.open",
    });
  });

  it("解析 plugins list/inspect", () => {
    expect(
      parsePierCliArgs(["plugins", "list", "--json"], {
        clientId: "cli-1",
        requestId: "req-plugin-list",
      }).envelope.command
    ).toEqual({ type: "plugin.list" });

    expect(
      parsePierCliArgs(["plugins", "inspect", "sample.local", "--json"], {
        clientId: "cli-1",
        requestId: "req-plugin-inspect",
      }).envelope.command
    ).toEqual({
      id: "sample.local",
      type: "plugin.inspect",
    });

    expect(
      parsePierCliArgs(["plugins", "enable", "pier.worktree", "--json"], {
        clientId: "cli-1",
        requestId: "req-plugin-enable",
      }).envelope.command
    ).toEqual({
      id: "pier.worktree",
      type: "plugin.enable",
    });

    expect(
      parsePierCliArgs(["plugins", "disable", "pier.worktree", "--json"], {
        clientId: "cli-1",
        requestId: "req-plugin-disable",
      }).envelope.command
    ).toEqual({
      id: "pier.worktree",
      type: "plugin.disable",
    });
  });

  it("拒绝 terminals open --cwd 旧入口", () => {
    expect(() =>
      parsePierCliArgs(["terminals", "open", "--cwd", "."], {
        clientId: "cli-1",
        cwd: "/Users/xyz/ABC/pier",
        requestId: "req-terminals-open-cwd",
      })
    ).toThrow("unknown pier CLI command");
  });

  it("解析 terminal open 启动参数", () => {
    expect(
      parsePierCliArgs(
        [
          "terminal",
          "open",
          "--cwd",
          ".",
          "--profile",
          "codex",
          "--env",
          "PIER_MODE=dev",
          "--env",
          "EMPTY=",
          "--window",
          "main",
          "--split",
          "below",
          "--no-focus",
          "--",
          "pnpm",
          "test",
          "--",
          "watch",
        ],
        {
          clientId: "cli-1",
          cwd: "/Users/xyz/ABC/pier",
          requestId: "req-terminal-open",
        }
      ).envelope.command
    ).toEqual({
      focus: false,
      launch: {
        command: "pnpm test -- watch",
        cwd: "/Users/xyz/ABC/pier",
        env: {
          EMPTY: "",
          PIER_MODE: "dev",
        },
        profileId: "codex",
      },
      placement: "split-below",
      type: "terminal.open",
      windowId: "main",
    });
  });

  it("拒绝非法 terminal env 参数", () => {
    expect(() =>
      parsePierCliArgs(["terminal", "open", "--env", "1BAD=value"], {
        clientId: "cli-1",
        cwd: "/Users/xyz/ABC/pier",
        requestId: "req-terminal-open-env",
      })
    ).toThrow("invalid --env value");
  });

  it("-- 后的 command 参数不被解析成 Pier 选项或输出选项", () => {
    const parsed = parsePierCliArgs(
      [
        "terminal",
        "open",
        "--cwd",
        ".",
        "--",
        "env",
        "--profile",
        "inner",
        "--env",
        "INNER=value",
        "--no-focus",
        "--json",
        "--print-envelope",
      ],
      {
        clientId: "cli-1",
        cwd: "/Users/xyz/ABC/pier",
        requestId: "req-terminal-open-command-flags",
      }
    );

    expect(parsed.json).toBe(false);
    expect(parsed.envelope.command).toEqual({
      launch: {
        command:
          "env --profile inner --env INNER=value --no-focus --json --print-envelope",
        cwd: "/Users/xyz/ABC/pier",
      },
      type: "terminal.open",
    });
  });

  it("解析 terminal profiles 管理命令", () => {
    expect(
      parsePierCliArgs(["terminal", "profiles", "list"], {
        clientId: "cli-1",
        requestId: "req-terminal-profiles-list",
      }).envelope.command
    ).toEqual({ type: "terminal.profile.list" });
    expect(
      parsePierCliArgs(["terminal", "profiles", "get", "codex"], {
        clientId: "cli-1",
        requestId: "req-terminal-profiles-get",
      }).envelope.command
    ).toEqual({ profileId: "codex", type: "terminal.profile.read" });
    expect(
      parsePierCliArgs(
        [
          "terminal",
          "profiles",
          "set",
          "codex",
          "--cwd",
          ".",
          "--env",
          "PIER_MODE=dev",
          "--",
          "codex",
          "--sandbox",
          "workspace-write",
        ],
        {
          clientId: "cli-1",
          cwd: "/Users/xyz/ABC/pier",
          requestId: "req-terminal-profiles-set",
        }
      ).envelope.command
    ).toEqual({
      profile: {
        command: "codex --sandbox workspace-write",
        cwd: "/Users/xyz/ABC/pier",
        env: { PIER_MODE: "dev" },
      },
      profileId: "codex",
      type: "terminal.profile.upsert",
    });
    expect(
      parsePierCliArgs(["terminal", "profiles", "delete", "codex"], {
        clientId: "cli-1",
        requestId: "req-terminal-profiles-delete",
      }).envelope.command
    ).toEqual({ profileId: "codex", type: "terminal.profile.delete" });
  });

  it("解析 tasks list 默认使用当前目录，也允许 --path 覆盖", () => {
    expect(
      parsePierCliArgs(["tasks", "list", "--json"], {
        clientId: "cli-1",
        cwd: "/Users/xyz/ABC/pier",
        requestId: "req-tasks-list",
      }).envelope.command
    ).toEqual({
      projectRoot: "/Users/xyz/ABC/pier",
      type: "run.list",
    });

    expect(
      parsePierCliArgs(["tasks", "list", "--path", "../bay", "--json"], {
        clientId: "cli-1",
        cwd: "/Users/xyz/ABC/pier",
        requestId: "req-tasks-list-path",
      }).envelope.command
    ).toEqual({
      projectRoot: "/Users/xyz/ABC/bay",
      type: "run.list",
    });
  });

  it("解析 tasks run/status/cancel", () => {
    expect(
      parsePierCliArgs(
        [
          "tasks",
          "run",
          "package-script:test",
          "--path",
          ".",
          "--input",
          "pkg=renderer",
          "--split",
          "below",
          "--window",
          "main",
          "--no-focus",
          "--json",
        ],
        {
          clientId: "cli-1",
          cwd: "/Users/xyz/ABC/pier",
          requestId: "req-task-run",
        }
      ).envelope.command
    ).toEqual({
      focus: false,
      inputs: { pkg: "renderer" },
      placement: "split-below",
      projectRoot: "/Users/xyz/ABC/pier",
      taskId: "package-script:test",
      type: "run.spawn",
      windowId: "main",
    });

    expect(
      parsePierCliArgs(["tasks", "status", "run-1", "--json"], {
        clientId: "cli-1",
        requestId: "req-task-status",
      }).envelope.command
    ).toEqual({
      runId: "run-1",
      type: "run.status",
    });

    expect(
      parsePierCliArgs(
        ["tasks", "cancel", "run-1", "--window", "main", "--json"],
        {
          clientId: "cli-1",
          requestId: "req-task-cancel",
        }
      ).envelope.command
    ).toEqual({
      runId: "run-1",
      type: "run.cancel",
      windowId: "main",
    });
  });

  it("拒绝未知命令和缺少值的 CLI 选项", () => {
    expect(() =>
      parsePierCliArgs(["windows", "delete", "main"], {
        clientId: "cli-1",
        requestId: "req-5",
      })
    ).toThrow("unknown pier CLI command");

    expect(() =>
      parsePierCliArgs(["panels", "list", "--window", "--json"], {
        clientId: "cli-1",
        requestId: "req-missing-window",
      })
    ).toThrow("missing required value for --window");
  });
});
