import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { act, createElement, type SVGProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { ExternalPanelPlaceholderRegistry } from "@/lib/plugins/external-panel-placeholders.tsx";
import {
  clearPluginPanelsForTests,
  getPluginPanelRegistrations,
  setPluginPanelTitleUpdater,
} from "@/lib/plugins/plugin-panel-registry.ts";
import {
  clearRendererPluginRuntimeDiagnosticsForTests,
  getRendererPluginRuntimeDiagnostics,
  reportRendererPluginRuntimeDiagnostic,
} from "@/lib/plugins/plugin-runtime-diagnostics.ts";

type TestIconProps = SVGProps<SVGSVGElement> & { size?: number | string };

function externalEntry(): PluginRegistryEntry {
  return {
    effectivePermissions: [],
    enabled: true,
    manifest: {
      apiVersion: 1,
      commands: [],
      engines: { pier: ">=0.1.0" },
      id: "pier.external",
      missionControlWidgets: [],
      name: "External",
      panels: [
        { id: "pier.external.panel", permissions: [], title: "External" },
      ],
      permissions: [],
      settingsPages: [],
      source: { kind: "official" },
      terminalStatusItems: [],
      version: "1.0.0",
    },
    runtime: {
      canToggle: true,
      enabled: true,
      kind: "external",
      rendererEntryUrl: "pier-plugin://pier.external/renderer.js",
      sourceRevision: "rev-1",
    },
  };
}

describe("external panel placeholders", () => {
  beforeEach(async () => {
    await initI18n();
    await i18next.changeLanguage("en");
  });

  afterEach(() => {
    cleanup();
    clearPluginPanelsForTests();
    clearRendererPluginRuntimeDiagnosticsForTests();
  });

  it("同一 slot 保留参数并依次呈现 rev-1、加载/失败和 rev-2 元数据", async () => {
    const placeholders = new ExternalPanelPlaceholderRegistry();
    const entry = externalEntry();
    const updateTitle = vi.fn();
    setPluginPanelTitleUpdater(updateTitle);
    placeholders.sync(new Map([[entry.manifest.id, entry]]));
    const registration = getPluginPanelRegistrations().get(
      "pier.external.panel"
    );
    if (!registration) throw new Error("expected external panel placeholder");
    const Slot = registration.component;
    const StableIcon = registration.icon;
    const panelProps = { params: { token: "same-instance" } } as never;
    render(
      <>
        {createElement(Slot, panelProps)}
        <StableIcon
          aria-hidden="true"
          className="host-icon"
          data-panel-tab-icon="pier.external.panel"
          data-testid="stable-icon"
          size={14}
        />
      </>
    );
    expect(screen.getByText("Loading plugin panel")).toBeVisible();

    await act(async () => {
      reportRendererPluginRuntimeDiagnostic({
        message: "renderer import failed",
        pluginId: entry.manifest.id,
      });
    });
    expect(screen.getByText("renderer import failed")).toBeVisible();

    const IconV1 = ({ size, ...props }: TestIconProps) => (
      <svg {...props} data-testid="icon-v1" height={size} width={size} />
    );
    let disposeV1: () => void = () => undefined;
    await act(async () => {
      disposeV1 = placeholders.registerImplementation(entry, {
        component: (props) => {
          const params = props.params as Record<string, unknown>;
          return <div>rev-1:{String(params.token)}</div>;
        },
        icon: IconV1,
        id: "pier.external.panel",
        title: "Panel V1",
      });
    });
    expect(screen.getByText("rev-1:same-instance")).toBeVisible();
    expect(screen.getByTestId("icon-v1")).toBeVisible();
    expect(screen.getByTestId("icon-v1")).toHaveAttribute("width", "14");
    expect(screen.getByTestId("stable-icon")).toHaveClass("host-icon");
    expect(screen.getByTestId("stable-icon")).toHaveAttribute(
      "data-panel-tab-icon",
      "pier.external.panel"
    );
    expect(screen.getByTestId("stable-icon")).toHaveAttribute(
      "aria-hidden",
      "true"
    );
    expect(updateTitle).toHaveBeenLastCalledWith(
      "pier.external.panel",
      "Panel V1"
    );

    await act(async () => disposeV1());
    expect(screen.getByText("renderer import failed")).toBeVisible();

    const IconV2 = ({ size, ...props }: TestIconProps) => (
      <svg {...props} data-testid="icon-v2" height={size} width={size} />
    );
    await act(async () => {
      placeholders.registerImplementation(entry, {
        component: (props) => {
          const params = props.params as Record<string, unknown>;
          return <div>rev-2:{String(params.token)}</div>;
        },
        icon: IconV2,
        id: "pier.external.panel",
        title: () => "Panel V2",
      });
    });
    expect(screen.getByText("rev-2:same-instance")).toBeVisible();
    expect(screen.getByTestId("icon-v2")).toBeVisible();
    expect(updateTitle).toHaveBeenLastCalledWith(
      "pier.external.panel",
      "Panel V2"
    );
    const titleUpdateCount = updateTitle.mock.calls.length;
    await act(async () => {
      placeholders.sync(new Map([[entry.manifest.id, entry]]));
    });
    expect(updateTitle).toHaveBeenCalledTimes(titleUpdateCount);
    expect(getPluginPanelRegistrations().size).toBe(1);
    await act(async () => placeholders.sync(new Map()));
    expect(getPluginPanelRegistrations().size).toBe(0);
    placeholders.dispose();
  });

  it("首次槽位注册早于工作区桥时仍会在挂载后发布标题", () => {
    const placeholders = new ExternalPanelPlaceholderRegistry();
    const entry = externalEntry();
    placeholders.sync(new Map([[entry.manifest.id, entry]]));
    const Slot = getPluginPanelRegistrations().get(
      "pier.external.panel"
    )?.component;
    if (!Slot) throw new Error("expected external panel slot");
    const updateTitle = vi.fn();
    setPluginPanelTitleUpdater(updateTitle);

    render(createElement(Slot, {} as never));

    expect(updateTitle).toHaveBeenCalledOnce();
    expect(updateTitle).toHaveBeenCalledWith("pier.external.panel", "External");
    placeholders.dispose();
  });

  it("工作区重挂载后会向新的标题桥重新发布", () => {
    const placeholders = new ExternalPanelPlaceholderRegistry();
    const entry = externalEntry();
    placeholders.sync(new Map([[entry.manifest.id, entry]]));
    const Slot = getPluginPanelRegistrations().get(
      "pier.external.panel"
    )?.component;
    if (!Slot) throw new Error("expected external panel slot");
    const firstUpdater = vi.fn();
    setPluginPanelTitleUpdater(firstUpdater);
    const firstMount = render(createElement(Slot, {} as never));
    expect(firstUpdater).toHaveBeenCalledWith(
      "pier.external.panel",
      "External"
    );

    firstMount.unmount();
    setPluginPanelTitleUpdater(null);
    const secondUpdater = vi.fn();
    setPluginPanelTitleUpdater(secondUpdater);
    render(createElement(Slot, {} as never));

    expect(secondUpdater).toHaveBeenCalledOnce();
    expect(secondUpdater).toHaveBeenCalledWith(
      "pier.external.panel",
      "External"
    );
    placeholders.dispose();
  });

  it("updates a long-lived placeholder when the language changes", async () => {
    const placeholders = new ExternalPanelPlaceholderRegistry();
    const entry = externalEntry();
    placeholders.sync(new Map([[entry.manifest.id, entry]]));
    const Slot = getPluginPanelRegistrations().get(
      "pier.external.panel"
    )?.component;
    if (!Slot) throw new Error("expected external panel slot");
    render(createElement(Slot, {} as never));
    expect(screen.getByText("Loading plugin panel")).toBeVisible();

    await act(async () => i18next.changeLanguage("zh-CN"));
    expect(await screen.findByText("正在加载插件面板")).toBeVisible();
    placeholders.dispose();
  });

  it("拒绝前缀插件夺取已有 slot 所有权", () => {
    const placeholders = new ExternalPanelPlaceholderRegistry();
    const owner = externalEntry();
    owner.manifest.id = "pier.external";
    owner.manifest.panels = [
      {
        id: "pier.external.child.panel",
        permissions: [],
        title: "Owner",
      },
    ];
    const contender = externalEntry();
    contender.manifest.id = "pier.external.child";
    contender.manifest.panels = [
      {
        id: "pier.external.child.panel",
        permissions: [],
        title: "Contender",
      },
    ];

    placeholders.sync(
      new Map([
        [owner.manifest.id, owner],
        [contender.manifest.id, contender],
      ])
    );

    expect(getPluginPanelRegistrations().size).toBe(1);
    expect(getRendererPluginRuntimeDiagnostics()).toContainEqual({
      message: expect.stringContaining("owned by another plugin"),
      pluginId: contender.manifest.id,
    });
    expect(() =>
      placeholders.registerImplementation(contender, {
        component: () => null,
        id: "pier.external.child.panel",
      })
    ).toThrow("slot is not available");
    placeholders.dispose();
  });
});
