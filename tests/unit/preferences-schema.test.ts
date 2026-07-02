import { projectPreferencesSchema } from "@shared/contracts/preferences.ts";
import { describe, expect, it } from "vitest";

describe("projectPreferencesSchema — language", () => {
  it("默认跟随系统并接受显式语言", () => {
    expect(projectPreferencesSchema.parse({}).language).toBe("system");
    expect(
      projectPreferencesSchema.parse({ language: "system" }).language
    ).toBe("system");
    expect(projectPreferencesSchema.parse({ language: "zh-CN" }).language).toBe(
      "zh-CN"
    );
    expect(projectPreferencesSchema.parse({ language: "en" }).language).toBe(
      "en"
    );
  });
});

describe("projectPreferencesSchema — monoFontSize", () => {
  it("默认值是 13", () => {
    const parsed = projectPreferencesSchema.parse({});
    expect(parsed.monoFontSize).toBe(13);
  });

  it("接受边界值 8 和 32", () => {
    expect(
      projectPreferencesSchema.parse({ monoFontSize: 8 }).monoFontSize
    ).toBe(8);
    expect(
      projectPreferencesSchema.parse({ monoFontSize: 32 }).monoFontSize
    ).toBe(32);
  });

  it("拒绝越界 (7 / 33)", () => {
    expect(() => projectPreferencesSchema.parse({ monoFontSize: 7 })).toThrow();
    expect(() =>
      projectPreferencesSchema.parse({ monoFontSize: 33 })
    ).toThrow();
  });

  it("拒绝非整数 (12.5)", () => {
    expect(() =>
      projectPreferencesSchema.parse({ monoFontSize: 12.5 })
    ).toThrow();
  });
});

describe("projectPreferencesSchema — windowZoomLevel", () => {
  it("defaults to 0 and accepts the supported range", () => {
    expect(projectPreferencesSchema.parse({}).windowZoomLevel).toBe(0);
    expect(
      projectPreferencesSchema.parse({ windowZoomLevel: -3 }).windowZoomLevel
    ).toBe(-3);
    expect(
      projectPreferencesSchema.parse({ windowZoomLevel: 5 }).windowZoomLevel
    ).toBe(5);
  });

  it("rejects values outside the supported range", () => {
    expect(() =>
      projectPreferencesSchema.parse({ windowZoomLevel: -4 })
    ).toThrow();
    expect(() =>
      projectPreferencesSchema.parse({ windowZoomLevel: 6 })
    ).toThrow();
    expect(() =>
      projectPreferencesSchema.parse({ windowZoomLevel: 1.5 })
    ).toThrow();
  });
});

describe("projectPreferencesSchema — terminal preferences", () => {
  it("提供终端设置默认值", () => {
    const parsed = projectPreferencesSchema.parse({});
    expect(parsed.terminalCursorStyle).toBe("block");
    expect(parsed.terminalCursorBlink).toBe(true);
    expect(parsed.terminalScrollbackMb).toBe(64);
    expect(parsed.terminalPasteProtection).toBe(true);
    expect(parsed.terminalNewCwdPolicy).toBe("activeTerminal");
  });

  it("接受终端设置边界值和枚举值", () => {
    expect(
      projectPreferencesSchema.parse({
        terminalCursorStyle: "bar",
        terminalCursorBlink: false,
        terminalScrollbackMb: 10,
        terminalPasteProtection: false,
        terminalNewCwdPolicy: "shellDefault",
      })
    ).toMatchObject({
      terminalCursorStyle: "bar",
      terminalCursorBlink: false,
      terminalScrollbackMb: 10,
      terminalPasteProtection: false,
      terminalNewCwdPolicy: "shellDefault",
    });

    expect(
      projectPreferencesSchema.parse({ terminalScrollbackMb: 512 })
        .terminalScrollbackMb
    ).toBe(512);
  });

  it("拒绝非法终端设置", () => {
    expect(() =>
      projectPreferencesSchema.parse({ terminalCursorStyle: "beam" })
    ).toThrow();
    expect(() =>
      projectPreferencesSchema.parse({ terminalScrollbackMb: 9 })
    ).toThrow();
    expect(() =>
      projectPreferencesSchema.parse({ terminalScrollbackMb: 513 })
    ).toThrow();
    expect(() =>
      projectPreferencesSchema.parse({ terminalScrollbackMb: 64.5 })
    ).toThrow();
    expect(() =>
      projectPreferencesSchema.parse({ terminalNewCwdPolicy: "workspaceRoot" })
    ).toThrow();
  });
});

describe("projectPreferencesSchema — user keymap", () => {
  it("默认没有用户快捷键覆盖", () => {
    const parsed = projectPreferencesSchema.parse({});
    expect(parsed.userKeymap).toEqual([]);
  });

  it("接受普通绑定和解绑条目", () => {
    expect(
      projectPreferencesSchema.parse({
        userKeymap: [
          {
            commandId: "-pier.panel.newTerminal",
            keys: "",
            scope: "global",
          },
          {
            commandId: "pier.panel.newTerminal",
            keys: "Mod+Shift+KeyX",
            scope: "global",
          },
        ],
      }).userKeymap
    ).toEqual([
      {
        commandId: "-pier.panel.newTerminal",
        keys: "",
        scope: "global",
      },
      {
        commandId: "pier.panel.newTerminal",
        keys: "Mod+Shift+KeyX",
        scope: "global",
      },
    ]);
  });

  it("拒绝缺少 keys 的普通绑定和非法 scope", () => {
    expect(() =>
      projectPreferencesSchema.parse({
        userKeymap: [{ commandId: "pier.panel.newTerminal", keys: "" }],
      })
    ).toThrow();
    expect(() =>
      projectPreferencesSchema.parse({
        userKeymap: [
          {
            commandId: "pier.panel.newTerminal",
            keys: "Mod+KeyT",
            scope: "bad scope",
          },
        ],
      })
    ).toThrow();
  });
});

describe("projectPreferencesSchema — agent preferences", () => {
  it("提供 agent 默认值", () => {
    const parsed = projectPreferencesSchema.parse({});
    expect(parsed.defaultAgentId).toBeNull();
    expect(parsed.disabledAgentIds).toEqual([]);
    expect(parsed.agentDefaultArgs).toEqual({});
    expect(parsed.agentDefaultEnv).toEqual({});
  });

  it("接受 agent 偏好值", () => {
    const parsed = projectPreferencesSchema.parse({
      defaultAgentId: "claude",
      disabledAgentIds: ["pi"],
      agentDefaultArgs: { claude: "--dangerously-skip-permissions" },
      agentDefaultEnv: { codex: { CODEX_X: "1" } },
    });
    expect(parsed.defaultAgentId).toBe("claude");
    expect(parsed.disabledAgentIds).toEqual(["pi"]);
    expect(parsed.agentDefaultArgs.claude).toBe(
      "--dangerously-skip-permissions"
    );
  });

  it("接受 blank 与 null 作为 defaultAgentId", () => {
    expect(
      projectPreferencesSchema.parse({ defaultAgentId: "blank" }).defaultAgentId
    ).toBe("blank");
    expect(
      projectPreferencesSchema.parse({ defaultAgentId: null }).defaultAgentId
    ).toBeNull();
  });

  it("拒绝未知 agent id", () => {
    expect(() =>
      projectPreferencesSchema.parse({ defaultAgentId: "nope" })
    ).toThrow();
    expect(() =>
      projectPreferencesSchema.parse({ disabledAgentIds: ["nope"] })
    ).toThrow();
  });

  it("拒绝 agentDefaultArgs/agentDefaultEnv 的未知 key", () => {
    expect(() =>
      projectPreferencesSchema.parse({ agentDefaultArgs: { nope: "x" } })
    ).toThrow();
    expect(() =>
      projectPreferencesSchema.parse({ agentDefaultEnv: { nope: { A: "1" } } })
    ).toThrow();
  });

  it("提供 agentCommandOverrides 默认 + 校验 key", () => {
    expect(projectPreferencesSchema.parse({}).agentCommandOverrides).toEqual(
      {}
    );
    expect(
      projectPreferencesSchema.parse({
        agentCommandOverrides: { claude: "/opt/claude" },
      }).agentCommandOverrides.claude
    ).toBe("/opt/claude");
    expect(() =>
      projectPreferencesSchema.parse({ agentCommandOverrides: { nope: "x" } })
    ).toThrow();
  });
});

describe("agentStatusHooks preference", () => {
  it("默认 true（opt-out：关闭即卸载）", () => {
    const parsed = projectPreferencesSchema.parse({});
    expect(parsed.agentStatusHooks).toBe(true);
  });

  it("接受布尔覆盖", () => {
    const parsed = projectPreferencesSchema.parse({ agentStatusHooks: true });
    expect(parsed.agentStatusHooks).toBe(true);
  });
});
