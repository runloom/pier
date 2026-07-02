import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { PluginSettingsContribution } from "@/pages/settings/components/plugin-settings-contribution.tsx";
import { usePluginSettingsStore } from "@/stores/plugin-settings.store.ts";
import { useSettingsDialogStore } from "@/stores/settings-dialog.store.ts";

function gitEntry(enabled = true): PluginRegistryEntry {
  return {
    effectivePermissions: [],
    enabled,
    manifest: {
      apiVersion: 1,
      commands: [],
      configuration: {
        properties: {
          "pier.git.statusItem.showDirtyIndicator": {
            default: true,
            description: "Show change counts.",
            type: "boolean",
          },
        },
      },
      engines: { pier: ">=0.1.0" },
      id: "pier.git",
      name: "Git",
      panels: [],
      permissions: [],
      source: { kind: "builtin" },
      terminalStatusItems: [],
      version: "1.0.0",
    },
    runtime: { canToggle: true, enabled, kind: "builtin" },
  };
}

describe("PluginSettingsContribution", () => {
  beforeEach(async () => {
    await initI18n();
    usePluginSettingsStore.setState({ initialized: true, values: {} });
    useSettingsDialogStore.setState({ activeSection: "plugins" });
  });

  afterEach(() => {
    cleanup();
  });

  it("渲染只读表：label、当前生效值、描述", () => {
    render(<PluginSettingsContribution entry={gitEntry()} />);
    expect(
      screen.getByText("statusItem.showDirtyIndicator")
    ).toBeInTheDocument();
    expect(screen.getByText("true")).toBeInTheDocument();
    expect(screen.getByText("Show change counts.")).toBeInTheDocument();
  });

  it("用户值覆盖后展示生效值", () => {
    usePluginSettingsStore.setState({
      initialized: true,
      values: { "pier.git.statusItem.showDirtyIndicator": false },
    });
    render(<PluginSettingsContribution entry={gitEntry()} />);
    expect(screen.getByText("false")).toBeInTheDocument();
  });

  it("打开设置按钮跳转到插件 section；禁用态插件按钮 disabled", () => {
    const { unmount } = render(
      <PluginSettingsContribution entry={gitEntry()} />
    );
    fireEvent.click(screen.getByTestId("plugin-settings-open-pier.git"));
    expect(useSettingsDialogStore.getState().activeSection).toBe(
      "plugin:pier.git"
    );
    unmount();

    render(<PluginSettingsContribution entry={gitEntry(false)} />);
    expect(screen.getByTestId("plugin-settings-open-pier.git")).toBeDisabled();
  });

  it("无 configuration 的插件整区隐藏", () => {
    const entry = gitEntry();
    const { configuration: _omitted, ...manifest } = entry.manifest;
    const { container } = render(
      <PluginSettingsContribution entry={{ ...entry, manifest }} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
