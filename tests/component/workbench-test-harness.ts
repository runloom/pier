import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import type { PluginWorkbenchWidgetContribution } from "@shared/contracts/workbench.ts";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { IDockviewPanelProps } from "dockview-react";
import i18next from "i18next";
import {
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  type Mock,
  vi,
} from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { clearPluginWorkbenchWidgetsForTests } from "@/lib/plugins/plugin-workbench-widget-registry.ts";
import { resetAppDialogForTests } from "@/stores/app-dialog.store.ts";
import { usePluginRegistryStore } from "@/stores/plugin-registry.store.ts";

export const MENU_LABEL_RE = /widget menu/i;
export const REMOVE_LABEL_RE = /remove/i;

const pointerPropertyNames = [
  "hasPointerCapture",
  "releasePointerCapture",
  "scrollIntoView",
  "setPointerCapture",
] as const;
const originalPointerDescriptors: Record<
  (typeof pointerPropertyNames)[number],
  PropertyDescriptor | undefined
> = {
  hasPointerCapture: Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "hasPointerCapture"
  ),
  releasePointerCapture: Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "releasePointerCapture"
  ),
  scrollIntoView: Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "scrollIntoView"
  ),
  setPointerCapture: Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "setPointerCapture"
  ),
};
const originalMatchMediaDescriptor = Object.getOwnPropertyDescriptor(
  window,
  "matchMedia"
);

export function installWorkbenchTestHarness(): void {
  beforeAll(async () => {
    await initI18n();
  });

  beforeEach(async () => {
    await i18next.changeLanguage("en");
    Object.defineProperties(HTMLElement.prototype, {
      hasPointerCapture: { configurable: true, value: vi.fn(() => false) },
      releasePointerCapture: { configurable: true, value: vi.fn() },
      scrollIntoView: { configurable: true, value: vi.fn() },
      setPointerCapture: { configurable: true, value: vi.fn() },
    });
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
    resetAppDialogForTests();
    clearPluginWorkbenchWidgetsForTests();
    usePluginRegistryStore.setState({
      diagnostics: [],
      error: null,
      initialized: false,
      plugins: [],
    });
    for (const name of pointerPropertyNames) {
      const descriptor = originalPointerDescriptors[name];
      if (descriptor) {
        Object.defineProperty(HTMLElement.prototype, name, descriptor);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, name);
      }
    }
    if (originalMatchMediaDescriptor) {
      Object.defineProperty(window, "matchMedia", originalMatchMediaDescriptor);
    } else {
      Reflect.deleteProperty(window, "matchMedia");
    }
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });
}

export function makeProps(
  params: Record<string, unknown>,
  updateParameters: Mock = vi.fn()
): IDockviewPanelProps<Record<string, unknown>> {
  return {
    api: {
      id: "workbench-test",
      setActive: vi.fn(),
      setTitle: vi.fn(),
      updateParameters,
    },
    containerApi: {},
    params,
  } as unknown as IDockviewPanelProps<Record<string, unknown>>;
}

export function makePluginRegistryEntry(input: {
  enabled?: boolean;
  pluginId: string;
  widgets: PluginWorkbenchWidgetContribution[];
}): PluginRegistryEntry {
  const enabled = input.enabled ?? true;
  return {
    effectivePermissions: [],
    enabled,
    manifest: {
      apiVersion: 1,
      commands: [],
      engines: { pier: ">=0.1.0" },
      id: input.pluginId,
      workbenchWidgets: input.widgets,
      name: input.pluginId,
      panels: [],
      permissions: [],
      settingsPages: [],
      source: { kind: "builtin" },
      terminalStatusItems: [],
      version: "1.0.0",
    },
    runtime: { canToggle: true, enabled, kind: "builtin" },
  };
}

export function setPluginRegistry(plugins: PluginRegistryEntry[]): void {
  usePluginRegistryStore.setState({
    diagnostics: [],
    error: null,
    initialized: true,
    plugins,
  });
}

export async function openWidgetMenu(): Promise<void> {
  const trigger = screen.getByTestId("workbench-widget-menu-trigger");
  await waitFor(() => expect(trigger).toBeVisible());
  fireEvent.pointerDown(trigger, {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
}

export function openPanelContextMenu(): void {
  fireEvent.contextMenu(screen.getByTestId("workbench-grid-wrapper"), {
    button: 2,
    ctrlKey: false,
  });
}
