import { beforeEach, describe, expect, it, vi } from "vitest";

describe("terminal-preferences.store", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  function installPierApi(snapshot = {}) {
    const read = vi.fn(async () => ({
      theme: "system",
      stylePresetId: "pierre",
      language: "system",
      uiFontFamily: "",
      monoFontFamily: "",
      monoFontSize: 13,
      terminalCursorStyle: "block",
      terminalCursorBlink: true,
      terminalScrollbackMb: 64,
      terminalPasteProtection: true,
      agentComposerEnabled: true,
      terminalNewCwdPolicy: "activeTerminal",
      ...snapshot,
    }));
    const update = vi.fn(async (patch: Record<string, unknown>) => ({
      ...(await read()),
      ...patch,
    }));
    const onChanged = vi.fn();
    const setConfig = vi.fn();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        preferences: { onChanged, read, update },
        terminal: { setConfig },
      },
    });
    return { onChanged, read, setConfig, update };
  }

  it("hydrate 后把运行时配置同步给 native terminal", async () => {
    const pier = installPierApi({
      terminalCursorStyle: "bar",
      terminalCursorBlink: false,
      terminalScrollbackMb: 128,
      terminalPasteProtection: false,
    });

    const { initTerminalPreferences, useTerminalPreferencesStore } =
      await import("@/stores/terminal-preferences.store.ts");

    await initTerminalPreferences();

    expect(useTerminalPreferencesStore.getState()).toMatchObject({
      terminalCursorStyle: "bar",
      terminalCursorBlink: false,
      terminalScrollbackMb: 128,
      terminalPasteProtection: false,
      terminalNewCwdPolicy: "activeTerminal",
    });
    expect(pier.setConfig).toHaveBeenCalledWith({
      cursorStyle: "bar",
      cursorBlink: false,
      scrollbackLimitBytes: 128_000_000,
      pasteProtection: false,
    });
  });

  it("setter 写入偏好并立即应用 native 配置", async () => {
    const pier = installPierApi();
    const { initTerminalPreferences, useTerminalPreferencesStore } =
      await import("@/stores/terminal-preferences.store.ts");

    await initTerminalPreferences();
    pier.setConfig.mockClear();

    await useTerminalPreferencesStore.getState().setTerminalCursorStyle("bar");

    expect(pier.update).toHaveBeenCalledWith({ terminalCursorStyle: "bar" });
    expect(pier.setConfig).toHaveBeenCalledWith({
      cursorStyle: "bar",
      cursorBlink: true,
      scrollbackLimitBytes: 64_000_000,
      pasteProtection: true,
    });
  });

  it("setAgentComposerEnabled 走 preferences.update 并回写快照", async () => {
    const pier = installPierApi();
    const { initTerminalPreferences, useTerminalPreferencesStore } =
      await import("@/stores/terminal-preferences.store.ts");

    await initTerminalPreferences();

    await useTerminalPreferencesStore.getState().setAgentComposerEnabled(false);

    expect(pier.update).toHaveBeenCalledWith({
      agentComposerEnabled: false,
    });
    expect(useTerminalPreferencesStore.getState().agentComposerEnabled).toBe(
      false
    );
  });

  it("订阅跨窗口偏好变化并应用运行时配置", async () => {
    const pier = installPierApi();
    let changed:
      | ((snapshot: {
          terminalCursorStyle: "underline";
          terminalCursorBlink: false;
          terminalScrollbackMb: 256;
          terminalPasteProtection: false;
          terminalNewCwdPolicy: "shellDefault";
        }) => void)
      | undefined;
    pier.onChanged.mockImplementation((cb) => {
      changed = cb;
      return vi.fn();
    });
    const { initTerminalPreferences, useTerminalPreferencesStore } =
      await import("@/stores/terminal-preferences.store.ts");

    await initTerminalPreferences();
    pier.setConfig.mockClear();
    changed?.({
      terminalCursorStyle: "underline",
      terminalCursorBlink: false,
      terminalScrollbackMb: 256,
      terminalPasteProtection: false,
      terminalNewCwdPolicy: "shellDefault",
    });

    expect(useTerminalPreferencesStore.getState()).toMatchObject({
      terminalCursorStyle: "underline",
      terminalCursorBlink: false,
      terminalScrollbackMb: 256,
      terminalPasteProtection: false,
      terminalNewCwdPolicy: "shellDefault",
    });
    expect(pier.setConfig).toHaveBeenCalledWith({
      cursorStyle: "underline",
      cursorBlink: false,
      scrollbackLimitBytes: 256_000_000,
      pasteProtection: false,
    });
  });
});
