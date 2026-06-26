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

  it("拒绝 terminals open --cwd 旧入口", () => {
    expect(() =>
      parsePierCliArgs(["terminals", "open", "--cwd", "."], {
        clientId: "cli-1",
        cwd: "/Users/xyz/ABC/pier",
        requestId: "req-terminal-open-cwd",
      })
    ).toThrow("unknown pier CLI command");
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
