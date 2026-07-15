import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createExternalRendererPluginContext } from "@/lib/plugins/external-plugin-context.ts";
import {
  resetAppContentDialogForTests,
  useAppContentDialogStore,
} from "@/stores/app-content-dialog.store.ts";

function Dummy() {
  return null;
}

function entry(): PluginRegistryEntry {
  return {
    kind: "external",
    state: "enabled",
    effectivePermissions: [],
    manifest: {
      apiVersion: 1,
      id: "pier.grok",
      version: "1.0.0",
      name: "Grok",
      description: "test",
      engines: { pier: ">=0.1.0 <0.2.0" },
      main: "dist/main.js",
      renderer: "dist/renderer.js",
      permissions: [],
      dataSchemas: {},
      settingsPages: [],
      workbenchWidgets: [],
      panels: [],
      terminalStatusItems: [],
      commands: [],
      publisher: "Pier",
      locales: {},
    },
  } as PluginRegistryEntry;
}

describe("external plugin content dialog wiring", () => {
  beforeEach(() => {
    resetAppContentDialogForTests();
  });

  it("namespaces open ids with plugin id", () => {
    const context = createExternalRendererPluginContext(
      entry(),
      {
        invoke: vi.fn(),
        subscribe: vi.fn(() => () => undefined),
      },
      () => []
    );

    const handle = context.dialogs.open({
      id: "accounts.add",
      title: "Add",
      content: Dummy,
    });

    expect(handle.id).toBe("pier.grok:accounts.add");
    expect(useAppContentDialogStore.getState().stack[0]?.id).toBe(
      "pier.grok:accounts.add"
    );
  });
});
