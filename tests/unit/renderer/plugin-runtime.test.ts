import type {
  RendererPluginContext,
  RendererPluginModule,
} from "@plugins/api/renderer.ts";
import type { PierDockviewGroupHandle } from "@shared/contracts/dockview.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearHostGroupContentForTests } from "@/lib/plugins/host-group-content-context.tsx";
import { RendererPluginRuntime } from "@/lib/plugins/runtime.ts";

const DISPOSE_FAILED_RE = /dispose failed/;

const pluginEntry = {
  effectivePermissions: [],
  enabled: true,
  manifest: {
    apiVersion: 1,
    commands: [],
    dashboardWidgets: [],
    engines: { pier: ">=0.1.0" },
    groupContent: [{ id: "runtime.test.groupView", title: "Group View" }],
    id: "runtime.test",
    name: "Runtime Test",
    panels: [],
    permissions: [],
    source: { kind: "builtin" },
    terminalStatusItems: [],
    version: "1.0.0",
  },
  runtime: {
    canToggle: true,
    enabled: true,
    kind: "builtin",
  },
} satisfies PluginRegistryEntry;

function createMockGroup(): {
  container: HTMLElement;
  group: PierDockviewGroupHandle;
} {
  const root = document.createElement("div");
  const container = document.createElement("div");
  container.className = "dv-content-container";
  root.appendChild(container);
  document.body.appendChild(root);
  const group: PierDockviewGroupHandle = {
    activePanel: {
      id: "active-panel",
      view: { contentComponent: "runtime.test.panel" },
    },
    api: {
      onDidActivePanelChange: () => ({ dispose: () => undefined }),
    },
    element: root,
    id: "group-a",
  };
  return { container, group };
}

afterEach(() => {
  clearHostGroupContentForTests();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("RendererPluginRuntime", () => {
  it("clears host group content for a plugin when that plugin is deactivated", () => {
    const { container, group } = createMockGroup();
    const dispose = vi.fn();
    const module: RendererPluginModule = {
      activate: (context: RendererPluginContext) => {
        context.groupContent.claim({
          group,
          id: "runtime.test.groupView",
          ownerId: Symbol("runtime-owner"),
          render: () => createElement("div", null, "Runtime Group View"),
          visible: () => true,
        });
        return dispose;
      },
      id: "runtime.test",
    };
    const runtime = new RendererPluginRuntime([module]);

    runtime.refresh([pluginEntry]);
    expect(
      container.querySelector('[data-slot="runtime.test.groupView"]')
    ).toBeInstanceOf(HTMLElement);

    runtime.refresh([]);

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector('[data-slot="runtime.test.groupView"]')
    ).toBeNull();
  });

  it("clears host group content when runtime.dispose is called directly", () => {
    const { container, group } = createMockGroup();
    const dispose = vi.fn();
    const module: RendererPluginModule = {
      activate: (context: RendererPluginContext) => {
        context.groupContent.claim({
          group,
          id: "runtime.test.groupView",
          ownerId: Symbol("runtime-owner"),
          render: () => createElement("div", null, "Runtime Group View"),
          visible: () => true,
        });
        return dispose;
      },
      id: "runtime.test",
    };
    const runtime = new RendererPluginRuntime([module]);

    runtime.refresh([pluginEntry]);
    expect(
      container.querySelector('[data-slot="runtime.test.groupView"]')
    ).toBeInstanceOf(HTMLElement);

    runtime.dispose();

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector('[data-slot="runtime.test.groupView"]')
    ).toBeNull();
  });

  it("clears host group content even when the plugin disposer throws", () => {
    const { container, group } = createMockGroup();
    const dispose = vi.fn(() => {
      throw new Error("dispose failed");
    });
    const module: RendererPluginModule = {
      activate: (context: RendererPluginContext) => {
        context.groupContent.claim({
          group,
          id: "runtime.test.groupView",
          ownerId: Symbol("runtime-owner"),
          render: () => createElement("div", null, "Runtime Group View"),
          visible: () => true,
        });
        return dispose;
      },
      id: "runtime.test",
    };
    const runtime = new RendererPluginRuntime([module]);

    runtime.refresh([pluginEntry]);
    expect(
      container.querySelector('[data-slot="runtime.test.groupView"]')
    ).toBeInstanceOf(HTMLElement);

    expect(() => runtime.dispose()).toThrow(DISPOSE_FAILED_RE);
    expect(
      container.querySelector('[data-slot="runtime.test.groupView"]')
    ).toBeNull();
  });
});
