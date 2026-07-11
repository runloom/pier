/**
 * SettingsDialog 使用 Radix Dialog 的标准 Escape 关闭语义。测试必须挂载真实
 * Dialog + DismissableLayer，才能覆盖 document capture 阶段的键盘处理；同时验证
 * 关闭前会先 blur 当前字段，让设置项沿用既有提交入口且不会丢草稿。
 */
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { SettingsDialog } from "@/pages/settings/settings-dialog.tsx";
import { usePluginRegistryStore } from "@/stores/plugin-registry.store.ts";
import { usePluginSettingsStore } from "@/stores/plugin-settings.store.ts";
import { useSettingsDialogStore } from "@/stores/settings-dialog.store.ts";

function entry(id: string): PluginRegistryEntry {
  return {
    effectivePermissions: [],
    enabled: true,
    manifest: {
      apiVersion: 1,
      commands: [],
      missionControlWidgets: [],
      settingsPages: [],
      configuration: {
        properties: {
          [`${id}.limit`]: {
            default: 10,
            description: "Numeric limit",
            maximum: 20,
            minimum: 1,
            type: "number",
          },
          [`${id}.prompt`]: {
            default: "initial prompt",
            description: "Prompt template",
            multiline: true,
            type: "string",
          },
        },
        title: `${id} Settings`,
      },
      engines: { pier: ">=0.1.0" },
      id,
      name: `${id}-name`,
      panels: [],
      permissions: [],
      source: { kind: "builtin" },
      terminalStatusItems: [],
      version: "1.0.0",
    },
    runtime: { canToggle: true, enabled: true, kind: "builtin" },
  };
}

const REGISTRY_INITIAL_STATE = {
  diagnostics: [],
  error: null,
  initialized: false,
  plugins: [],
};

const SETTINGS_INITIAL_STATE = {
  error: null,
  initialized: false,
  values: {},
};

const DIALOG_INITIAL_STATE = {
  activeSection: "appearance",
  isOpen: false,
};

describe("SettingsDialog — Escape 关闭与字段提交", () => {
  beforeEach(async () => {
    await initI18n();
    usePluginRegistryStore.setState(REGISTRY_INITIAL_STATE);
    usePluginSettingsStore.setState(SETTINGS_INITIAL_STATE);
    useSettingsDialogStore.setState(DIALOG_INITIAL_STATE);
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        pluginSettings: {
          getAll: vi.fn(async () => ({ values: {}, version: 1 })),
          onChanged: vi.fn(() => () => undefined),
          reset: vi.fn(async () => ({ values: {}, version: 1 })),
          set: vi.fn(async (key: string, value: unknown) => ({
            values: { [key]: value },
            version: 1,
          })),
        },
        settings: {
          onOpenRequest: vi.fn(() => () => undefined),
        },
      },
    });
    // SidebarProvider (useIsMobile) 依赖 matchMedia — jsdom 默认不实现。
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn((query: string) => ({
        addEventListener: vi.fn(),
        addListener: vi.fn(),
        dispatchEvent: vi.fn(),
        matches: false,
        media: query,
        onchange: null,
        removeEventListener: vi.fn(),
        removeListener: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    usePluginRegistryStore.setState(REGISTRY_INITIAL_STATE);
    usePluginSettingsStore.setState(SETTINGS_INITIAL_STATE);
    useSettingsDialogStore.setState(DIALOG_INITIAL_STATE);
  });

  it("聚焦输入框按 Escape 会先提交草稿再关闭对话框", async () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [entry("pier.demo")],
    });
    act(() => {
      useSettingsDialogStore.setState({
        activeSection: "plugin:pier.demo",
        isOpen: true,
      });
    });
    render(<SettingsDialog />);

    const limitInput = screen.getByDisplayValue("10");
    limitInput.focus();
    fireEvent.change(limitInput, { target: { value: "999" } });
    fireEvent.keyDown(limitInput, { key: "Escape" });

    await waitFor(() => {
      expect(useSettingsDialogStore.getState().isOpen).toBe(false);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(window.pier.pluginSettings.set).toHaveBeenCalledTimes(1);
    expect(window.pier.pluginSettings.set).toHaveBeenCalledWith(
      "pier.demo.limit",
      20
    );
  });

  it("聚焦文本域按 Escape 会先提交草稿再关闭对话框", async () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [entry("pier.demo")],
    });
    act(() => {
      useSettingsDialogStore.setState({
        activeSection: "plugin:pier.demo",
        isOpen: true,
      });
    });
    render(<SettingsDialog />);

    const promptTextarea = screen.getByDisplayValue("initial prompt");
    promptTextarea.focus();
    fireEvent.change(promptTextarea, {
      target: { value: "updated prompt" },
    });
    fireEvent.keyDown(promptTextarea, { key: "Escape" });

    await waitFor(() => {
      expect(useSettingsDialogStore.getState().isOpen).toBe(false);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(window.pier.pluginSettings.set).toHaveBeenCalledTimes(1);
    expect(window.pier.pluginSettings.set).toHaveBeenCalledWith(
      "pier.demo.prompt",
      "updated prompt"
    );
  });

  it("焦点不在输入字段时按 Escape 仍可关闭对话框", () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [entry("pier.demo")],
    });
    act(() => {
      useSettingsDialogStore.setState({
        activeSection: "plugin:pier.demo",
        isOpen: true,
      });
    });
    render(<SettingsDialog />);

    const content = document.querySelector('[data-slot="dialog-content"]');
    expect(content).toBeInstanceOf(HTMLElement);
    // DialogContent 打开时默认把焦点放在自己身上(非表单字段)。
    expect(document.activeElement).toBe(content);
    fireEvent.keyDown(content as HTMLElement, { key: "Escape" });

    expect(useSettingsDialogStore.getState().isOpen).toBe(false);
  });
});
