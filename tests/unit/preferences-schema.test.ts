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
