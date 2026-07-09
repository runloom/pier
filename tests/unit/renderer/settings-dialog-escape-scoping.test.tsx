/**
 * M1: Escape 作用域限定 —— settings-dialog.tsx 的 DialogContent.onEscapeKeyDown
 * 只在焦点落在非表单字段(空白/其它元素)时才关闭对话框; 焦点在 InputRow 等可编辑
 * 字段上时, Escape 应交给字段自己处理(回弹草稿), 不应连带关闭整个 SettingsDialog。
 *
 * 之所以要在真实 <SettingsDialog>(而非裸 InputRow)下测试: bug 根因是 Radix
 * DismissableLayer 用 capture 阶段监听 document keydown, 字段级 stopPropagation
 * 拦不住 —— 必须有真实的 Dialog + DismissableLayer 参与, 才能验证这条 capture
 * 阶段的 preventDefault 修复真的生效。
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

describe("SettingsDialog — Escape 作用域限定在字段级(M1)", () => {
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

  it("聚焦插件配置数字输入框改动草稿后按 Escape: 对话框不关闭, 输入框回弹为 effective, 不提交", async () => {
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

    // (a) dialog 仍开着(open state 未变)
    expect(useSettingsDialogStore.getState().isOpen).toBe(true);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // (b) 输入框回弹为 effective
    await waitFor(() => {
      expect(limitInput).toHaveValue(10);
    });
    // (c) 无 set 调用
    expect(window.pier.pluginSettings.set).not.toHaveBeenCalled();
  });

  it("对照组: 焦点不在输入字段时按 Escape 仍可关闭对话框", () => {
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
