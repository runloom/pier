import type { PierDockviewGroupHandle } from "@shared/contracts/dockview.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearHostGroupContentForPlugin,
  clearHostGroupContentForTests,
  createHostGroupContentContext,
} from "@/lib/plugins/host-group-content-context.tsx";

const RENDER_FAILED_RE = /render failed/;

const pluginEntry = {
  effectivePermissions: [],
  enabled: true,
  manifest: {
    apiVersion: 1,
    commands: [],
    missionControlWidgets: [],
    settingsPages: [],
    engines: { pier: ">=0.1.0" },
    groupContent: [{ id: "host.test.groupView", title: "Group View" }],
    id: "host.test",
    name: "Host Test",
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

const otherPluginEntry = {
  ...pluginEntry,
  manifest: {
    ...pluginEntry.manifest,
    groupContent: [{ id: "host.other.groupView", title: "Other Group View" }],
    id: "host.other",
    name: "Host Other",
  },
} satisfies PluginRegistryEntry;

function createMockGroup(activeComponent = "pier.files.filePanel"): {
  container: HTMLElement;
  emitActiveChange: () => void;
  group: PierDockviewGroupHandle;
  setActiveComponent: (component: string) => void;
} {
  const root = document.createElement("div");
  const container = document.createElement("div");
  container.className = "dv-content-container";
  root.appendChild(container);
  document.body.appendChild(root);
  const listeners = new Set<(event: unknown) => void>();
  const activePanel = {
    id: "active-panel",
    view: { contentComponent: activeComponent },
  };
  const group: PierDockviewGroupHandle = {
    activePanel,
    api: {
      onDidActivePanelChange: (listener) => {
        listeners.add(listener);
        return { dispose: () => listeners.delete(listener) };
      },
    },
    element: root,
    id: "group-a",
  };
  return {
    container,
    emitActiveChange: () => {
      for (const listener of listeners) {
        listener({});
      }
    },
    group,
    setActiveComponent: (component) => {
      activePanel.view.contentComponent = component;
    },
  };
}

afterEach(() => {
  clearHostGroupContentForTests();
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("host group content context", () => {
  it("claims one DOM host per plugin slot and removes it after the last owner releases", async () => {
    vi.useFakeTimers();
    const context = createHostGroupContentContext(pluginEntry, () => undefined);
    const ownerA = Symbol("owner-a");
    const ownerB = Symbol("owner-b");
    const { container, group } = createMockGroup();

    expect(
      context.claim({
        group,
        id: "host.test.groupView",
        ownerId: ownerA,
        render: () => <div>Sample</div>,
        visible: () => true,
      })
    ).toBe(true);
    expect(
      context.claim({
        group,
        id: "host.test.groupView",
        ownerId: ownerB,
        render: () => <div>Ignored</div>,
        visible: () => true,
      })
    ).toBe(true);
    expect(
      container.querySelectorAll('[data-slot="host.test.groupView"]')
    ).toHaveLength(1);

    context.release({
      groupId: "group-a",
      id: "host.test.groupView",
      ownerId: ownerA,
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(
      container.querySelector('[data-slot="host.test.groupView"]')
    ).toBeInstanceOf(HTMLElement);

    context.release({
      groupId: "group-a",
      id: "host.test.groupView",
      ownerId: ownerB,
    });
    expect(
      container.querySelector('[data-slot="host.test.groupView"]')
    ).toBeInstanceOf(HTMLElement);
    await vi.advanceTimersByTimeAsync(999);
    expect(
      container.querySelector('[data-slot="host.test.groupView"]')
    ).toBeInstanceOf(HTMLElement);
    await vi.advanceTimersByTimeAsync(1);
    expect(
      container.querySelector('[data-slot="host.test.groupView"]')
    ).toBeNull();
  });

  it("updates visibility when the dockview group active panel changes", () => {
    const context = createHostGroupContentContext(pluginEntry, () => undefined);
    const ownerId = Symbol("owner");
    const { container, emitActiveChange, group, setActiveComponent } =
      createMockGroup();

    context.claim({
      group,
      id: "host.test.groupView",
      ownerId,
      render: () => <div>Sample</div>,
      visible: (candidate) =>
        candidate.activePanel?.view?.contentComponent ===
        "pier.files.filePanel",
    });
    const host = container.querySelector<HTMLElement>(
      '[data-slot="host.test.groupView"]'
    );
    expect(host?.style.visibility).toBe("visible");

    setActiveComponent("terminal");
    emitActiveChange();

    expect(host?.style.visibility).toBe("hidden");
    expect(host?.style.pointerEvents).toBe("none");

    setActiveComponent("pier.files.filePanel");
    emitActiveChange();

    expect(host?.style.visibility).toBe("visible");
    expect(host?.style.pointerEvents).toBe("auto");
  });

  it("clears all claimed group content for one plugin namespace", () => {
    const context = createHostGroupContentContext(pluginEntry, () => undefined);
    const otherContext = createHostGroupContentContext(
      otherPluginEntry,
      () => undefined
    );
    const ownerId = Symbol("owner");
    const { container, group } = createMockGroup();

    context.claim({
      group,
      id: "host.test.groupView",
      ownerId,
      render: () => <div>Sample</div>,
      visible: () => true,
    });
    otherContext.claim({
      group,
      id: "host.other.groupView",
      ownerId,
      render: () => <div>Other</div>,
      visible: () => true,
    });
    expect(
      container.querySelector('[data-slot="host.test.groupView"]')
    ).toBeInstanceOf(HTMLElement);
    expect(
      container.querySelector('[data-slot="host.other.groupView"]')
    ).toBeInstanceOf(HTMLElement);

    clearHostGroupContentForPlugin("host.test");

    expect(
      container.querySelector('[data-slot="host.test.groupView"]')
    ).toBeNull();
    expect(
      container.querySelector('[data-slot="host.other.groupView"]')
    ).toBeInstanceOf(HTMLElement);
  });

  it("does not leave a detached host when rendering claimed content throws", () => {
    const context = createHostGroupContentContext(pluginEntry, () => undefined);
    const ownerId = Symbol("owner");
    const { container, group } = createMockGroup();

    expect(() =>
      context.claim({
        group,
        id: "host.test.groupView",
        ownerId,
        render: () => {
          throw new Error("render failed");
        },
        visible: () => true,
      })
    ).toThrow(RENDER_FAILED_RE);

    expect(
      container.querySelector('[data-slot="host.test.groupView"]')
    ).toBeNull();
  });
});
