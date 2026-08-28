import type { ManagedPluginCatalogSnapshot } from "@shared/contracts/plugin/managed.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import {
  clearRendererPluginRuntimeDiagnosticsForTests,
  reportRendererPluginRuntimeDiagnostic,
} from "@/lib/plugins/runtime-diagnostics.ts";
import { PluginsSection } from "@/pages/settings/components/plugins-section.tsx";
import { useHostCatalogStore } from "@/stores/host-catalog/store.ts";
import { usePluginRegistryStore } from "@/stores/plugin-registry.store.ts";
import { useSettingsDialogStore } from "@/stores/settings-dialog.store.ts";
import { catalogApiFromManaged } from "../host-catalog/test-api.ts";

function entry(id: string, enabled: boolean): PluginRegistryEntry {
  return {
    effectivePermissions: [],
    enabled,
    manifest: {
      apiVersion: 1,
      commands: [],
      canvasActions: [],
      dataProjections: [],
      settingsPages: [],
      engines: { pier: ">=0.1.0" },
      id,
      name: id,
      panels: [],
      permissions: [],
      source: { kind: "builtin" },
      terminalStatusItems: [],
      version: "1.0.0",
    },
    runtime: { canToggle: true, enabled, kind: "builtin" },
  };
}

const INITIAL_STORE_STATE = {
  diagnostics: [],
  error: null,
  initialized: false,
  plugins: [],
};

function emptyManagedCatalog() {
  return {
    checkedAt: 1,
    officialMutationsAllowed: true,
    pluginMode: "release" as const,
    plugins: [],
  };
}

function stubPier(managed: {
  checkUpdates: () => Promise<ManagedPluginCatalogSnapshot>;
  list: () => Promise<ManagedPluginCatalogSnapshot>;
  [key: string]: unknown;
}) {
  return {
    catalog: catalogApiFromManaged(managed),
    managedPlugins: managed,
    plugins: {
      disable: vi.fn(async () => entry("pier.git", false)),
      enable: vi.fn(async () => entry("pier.git", true)),
      list: vi.fn(async () => ({
        diagnostics: [],
        entries: [entry("pier.git", false)],
      })),
      onChanged: vi.fn(() => () => undefined),
    },
  };
}

describe("PluginsSection", () => {
  beforeEach(async () => {
    await initI18n();
    clearRendererPluginRuntimeDiagnosticsForTests();
    usePluginRegistryStore.setState(INITIAL_STORE_STATE);
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: stubPier({
        checkUpdates: vi.fn(async () => emptyManagedCatalog()),
        disable: vi.fn(),
        enable: vi.fn(),
        install: vi.fn(),
        list: vi.fn(async () => emptyManagedCatalog()),
        rollback: vi.fn(),
        uninstall: vi.fn(),
        update: vi.fn(),
      }),
    });
  });

  afterEach(() => {
    cleanup();
    clearRendererPluginRuntimeDiagnosticsForTests();
    vi.restoreAllMocks();
    usePluginRegistryStore.setState(INITIAL_STORE_STATE);
    useSettingsDialogStore.setState({ activeSection: "appearance" });
    useHostCatalogStore.getState().reset();
  });

  it("store 未初始化时渲染 loading 骨架", () => {
    render(<PluginsSection />);
    expect(screen.getByTestId("plugins-loading")).toBeInTheDocument();
  });

  it("渲染 store 中的插件行, 挂载时不自行发起 list 拉取", () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [entry("pier.git", true)],
    });
    const { container } = render(<PluginsSection />);
    expect(screen.getByTestId("plugin-row-pier.git")).toBeInTheDocument();
    expect(window.pier.plugins.list).not.toHaveBeenCalled();
    const content = container.querySelector('[data-slot="card-content"]');
    expect(content).toHaveClass("px-0");
    expect(content).not.toHaveClass("py-(--card-spacing)");
  });

  it("store 更新时(模拟广播落地)行随之更新", () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [entry("pier.git", true)],
    });
    render(<PluginsSection />);
    expect(screen.queryByTestId("plugin-row-pier.extra")).toBeNull();

    act(() => {
      usePluginRegistryStore.setState({
        plugins: [entry("pier.git", true), entry("pier.extra", true)],
      });
    });
    expect(screen.getByTestId("plugin-row-pier.extra")).toBeInTheDocument();
  });

  it("shows external renderer activation diagnostics without blocking the plugin list", async () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [entry("pier.external", true)],
    });
    reportRendererPluginRuntimeDiagnostic({
      message: "renderer plugin load timed out",
      pluginId: "pier.external",
    });

    render(<PluginsSection />);

    expect(screen.getByTestId("plugin-row-pier.external")).toBeVisible();
    const stack = await screen.findByTestId("plugins-status-stack");
    expect(stack).toHaveAttribute("data-slot", "status-stack");
    expect(within(stack).getByText("Plugin failed to load")).toBeVisible();
    expect(stack).toHaveTextContent("pier.external");
    expect(stack).toHaveTextContent("renderer plugin load timed out");
    expect(stack.querySelectorAll('[data-slot="alert"]')).toHaveLength(0);
  });

  it("keeps identical invalid_manifest rows distinct when sources differ", async () => {
    usePluginRegistryStore.setState({
      diagnostics: [
        {
          code: "invalid_manifest",
          message:
            "invalid plugin manifest (pier.files): enumDescriptions length",
          source: { kind: "builtin", path: "/app/files" },
        },
        {
          code: "invalid_manifest",
          message: "invalid plugin manifest (pier.extra): missing source",
          source: { kind: "devOverride", path: "/tmp/extra" },
        },
        {
          code: "invalid_manifest",
          message: "invalid plugin manifest (pier.codex): bad engines",
          source: { kind: "official" },
        },
      ],
      initialized: true,
      plugins: [entry("pier.codex", true)],
    });

    render(<PluginsSection />);

    const stack = await screen.findByTestId("plugins-status-stack");
    expect(
      stack.querySelectorAll('[data-slot="status-stack-item"]')
    ).toHaveLength(1);
    expect(stack).toHaveTextContent("Plugin issues");
    expect(stack).toHaveTextContent("Couldn't read plugin info");
    expect(stack).toHaveTextContent("pier.files");
    expect(stack).toHaveTextContent("/app/files");
    expect(stack).toHaveTextContent("pier.extra");
    expect(stack).toHaveTextContent("/tmp/extra");
    expect(stack).toHaveTextContent("pier.codex");
    expect(document.querySelectorAll('[data-slot="alert"]')).toHaveLength(0);
  });

  it("summarizes multiple distinct diagnostics in one status-stack item", async () => {
    usePluginRegistryStore.setState({
      diagnostics: [
        {
          code: "invalid_manifest",
          message:
            "invalid plugin manifest (pier.files): enumDescriptions length",
          source: { kind: "builtin", path: "/app/files" },
        },
        {
          code: "unsupported",
          message: "unsupported plugin API version",
          source: { kind: "official" },
        },
      ],
      initialized: true,
      plugins: [entry("pier.codex", true)],
    });

    render(<PluginsSection />);

    const stack = await screen.findByTestId("plugins-status-stack");
    expect(stack.querySelectorAll('[data-slot="status-stack"]')).toHaveLength(
      0
    );
    expect(
      document.querySelectorAll('[data-slot="status-stack"]')
    ).toHaveLength(1);
    expect(
      stack.querySelectorAll('[data-slot="status-stack-item"]')
    ).toHaveLength(1);
    expect(stack).toHaveTextContent("Plugin issues");
    expect(stack).toHaveTextContent("Couldn't read plugin info");
    expect(stack).toHaveTextContent("pier.files");
    expect(stack).toHaveTextContent("Plugin is not supported");
    expect(document.querySelectorAll('[data-slot="alert"]')).toHaveLength(0);
  });

  it("renders one status-stack for workspace mode plus a diagnostic with zero alerts", async () => {
    const list = vi.fn(async () => ({
      checkedAt: 1,
      officialMutationsAllowed: false,
      pluginMode: "workspace" as const,
      plugins: [],
    }));
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: stubPier({
        checkUpdates: vi.fn(async () => list()),
        disable: vi.fn(),
        enable: vi.fn(),
        install: vi.fn(),
        list,
        rollback: vi.fn(),
        uninstall: vi.fn(),
        update: vi.fn(),
      }),
    });
    usePluginRegistryStore.setState({
      diagnostics: [
        {
          code: "invalid_manifest",
          message:
            "invalid plugin manifest (pier.files): configuration.properties.x: bad",
          source: { kind: "builtin", path: "/app/files" },
        },
      ],
      initialized: true,
      plugins: [entry("pier.git", true)],
    });

    render(<PluginsSection />);

    const stack = await screen.findByTestId("plugins-status-stack");
    expect(
      document.querySelectorAll('[data-slot="status-stack"]')
    ).toHaveLength(1);
    expect(stack).toHaveAttribute("data-shell-tone", "warning");
    expect(within(stack).getByText("Couldn't read plugin info")).toBeVisible();
    expect(stack).toHaveTextContent("pier.files");
    expect(within(stack).getByText("Local development loading")).toBeVisible();
    expect(
      stack.querySelectorAll('[data-slot="status-stack-item"]').length
    ).toBeGreaterThanOrEqual(2);
    expect(document.querySelectorAll('[data-slot="alert"]')).toHaveLength(0);
  });

  it("uses info shell-tone when only workspace mode is reported", async () => {
    const list = vi.fn(async () => ({
      checkedAt: 1,
      officialMutationsAllowed: false,
      pluginMode: "workspace" as const,
      plugins: [],
    }));
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: stubPier({
        checkUpdates: vi.fn(async () => list()),
        disable: vi.fn(),
        enable: vi.fn(),
        install: vi.fn(),
        list,
        rollback: vi.fn(),
        uninstall: vi.fn(),
        update: vi.fn(),
      }),
    });
    usePluginRegistryStore.setState({
      diagnostics: [],
      error: null,
      initialized: true,
      plugins: [entry("pier.git", true)],
    });

    render(<PluginsSection />);

    const stack = await screen.findByTestId("plugins-status-stack");
    expect(stack).toHaveAttribute("data-shell-tone", "info");
    expect(within(stack).getByText("Local development loading")).toBeVisible();
    expect(document.querySelectorAll('[data-slot="alert"]')).toHaveLength(0);
  });

  it("merges page error and catalog error into one destructive status item", async () => {
    const list = vi.fn(async () => {
      throw new Error("catalog boom");
    });
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: stubPier({
        checkUpdates: vi.fn(async () => emptyManagedCatalog()),
        disable: vi.fn(),
        enable: vi.fn(),
        install: vi.fn(),
        list,
        rollback: vi.fn(),
        uninstall: vi.fn(),
        update: vi.fn(),
      }),
    });
    usePluginRegistryStore.setState({
      diagnostics: [],
      error: "page boom",
      initialized: true,
      plugins: [entry("pier.git", true)],
    });

    render(<PluginsSection />);

    const stack = await screen.findByTestId("plugins-status-stack");
    expect(stack).toHaveAttribute("data-shell-tone", "destructive");
    expect(within(stack).getByText("Unable to load plugins")).toBeVisible();
    expect(stack).toHaveTextContent("page boom");
    await waitFor(() => {
      expect(stack).toHaveTextContent("catalog boom");
    });
    expect(
      stack.querySelectorAll('[data-slot="status-stack-item"]')
    ).toHaveLength(1);
    expect(document.querySelectorAll('[data-slot="alert"]')).toHaveLength(0);
  });

  it("toggle 调用 disable 并 refresh store", async () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [entry("pier.git", true)],
    });
    render(<PluginsSection />);

    fireEvent.click(screen.getByRole("button", { name: "Disable pier.git" }));

    await waitFor(() => {
      expect(window.pier.plugins.disable).toHaveBeenCalledWith("pier.git");
      // toggle resolve 后显式 refresh() → 恰好一次 list 拉取
      expect(window.pier.plugins.list).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(usePluginRegistryStore.getState().plugins[0]?.enabled).toBe(false);
    });
  });

  it("声明 configuration 的插件行渲染 Settings 内链, 点击跳转到插件 section", () => {
    const withConfiguration: PluginRegistryEntry = {
      ...entry("pier.git", true),
      manifest: {
        ...entry("pier.git", true).manifest,
        configuration: {
          properties: {
            "pier.git.example": { default: true, type: "boolean" },
          },
        },
      },
    };
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [withConfiguration],
    });
    render(<PluginsSection />);

    fireEvent.click(screen.getByTestId("plugin-settings-link-pier.git"));

    expect(useSettingsDialogStore.getState().activeSection).toBe(
      "plugin:pier.git"
    );
  });

  it("声明 settingsPages 的插件行渲染 Settings 内链（与侧栏导航同判定）", () => {
    const withSettingsPages: PluginRegistryEntry = {
      ...entry("pier.codex", true),
      manifest: {
        ...entry("pier.codex", true).manifest,
        settingsPages: [{ id: "pier.codex.accounts" }],
      },
    };
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [withSettingsPages],
    });
    render(<PluginsSection />);

    fireEvent.click(screen.getByTestId("plugin-settings-link-pier.codex"));

    expect(useSettingsDialogStore.getState().activeSection).toBe(
      "plugin:pier.codex"
    );
  });

  it("未声明 configuration / settingsPages 的插件行不渲染 Settings 内链", () => {
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [entry("pier.git", true)],
    });
    render(<PluginsSection />);

    expect(
      screen.queryByTestId("plugin-settings-link-pier.git")
    ).not.toBeInTheDocument();
  });

  it("runtime.enabled=false 时(即使有 configuration / settingsPages)不渲染 Settings 内链", () => {
    const disabledWithSettings: PluginRegistryEntry = {
      ...entry("pier.git", false),
      manifest: {
        ...entry("pier.git", false).manifest,
        configuration: {
          properties: {
            "pier.git.example": { default: true, type: "boolean" },
          },
        },
        settingsPages: [{ id: "pier.git.page" }],
      },
      runtime: { canToggle: true, enabled: false, kind: "builtin" },
    };
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [disabledWithSettings],
    });
    render(<PluginsSection />);

    expect(
      screen.queryByTestId("plugin-settings-link-pier.git")
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Settings")).not.toBeInTheDocument();
  });
});
