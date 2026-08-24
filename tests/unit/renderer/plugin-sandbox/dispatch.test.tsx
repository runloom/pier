// @vitest-environment jsdom

import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  createSandboxTrackRegistrations,
  isSandboxTrackCandidate,
  maybeActivateViaSandboxTrack,
  resolveSandboxTrackEnabled,
} from "@/lib/plugins/sandbox/dispatch.tsx";

function fakeStorage(value: string | null): Pick<Storage, "getItem"> {
  return { getItem: () => value };
}

function entryWithPanels(
  panelIds: readonly string[],
  sourceKind: PluginRegistryEntry["manifest"]["source"]["kind"] = "official"
): PluginRegistryEntry {
  return {
    effectivePermissions: ["file:read"],
    enabled: true,
    manifest: {
      commands: [],
      id: "third.demo",
      panels: panelIds.map((id) => ({
        id,
        permissions: [],
        title: `${id} title`,
      })) as PluginRegistryEntry["manifest"]["panels"],
      permissions: ["file:read"],
      publisher: "Third",
      source: { kind: sourceKind },
      terminalStatusItems: [],
      version: "1.0.0",
      workbenchWidgets: [],
    },
    runtime: {
      canToggle: true,
      enabled: true,
      kind: "external",
      rendererEntryUrl: "pier-plugin://third.demo/1.0.0/dist/renderer.js",
    },
  } as unknown as PluginRegistryEntry;
}

describe("sandbox track dispatch (Phase 2 接电)", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("is disabled in production regardless of storage", () => {
    expect(resolveSandboxTrackEnabled(false, fakeStorage("1"))).toBe(false);
  });

  it("requires an explicit local opt-in even in dev", () => {
    expect(resolveSandboxTrackEnabled(true, fakeStorage(null))).toBe(false);
    expect(resolveSandboxTrackEnabled(true, fakeStorage("1"))).toBe(true);
  });

  it("tolerates unavailable storage", () => {
    expect(resolveSandboxTrackEnabled(true, null)).toBe(false);
  });

  it("maps every manifest panel to a synthetic sandbox registration", () => {
    const entry = entryWithPanels(["demo.panel-a", "demo.panel-b"]);
    const registrations = createSandboxTrackRegistrations({ entry });
    expect(registrations.map((r) => r.id)).toEqual([
      "demo.panel-a",
      "demo.panel-b",
    ]);
  });

  it("renders the sandbox iframe host bound to the plugin bundle url", () => {
    const entry = entryWithPanels(["demo.panel-a"]);
    const registrations = createSandboxTrackRegistrations({ entry });
    const registration = registrations[0];
    if (!registration) {
      throw new Error("expected one registration");
    }
    const Component = registration.component as React.ComponentType;
    const { container } = render(<Component />);
    const iframe = container.querySelector("iframe");
    expect(iframe?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(iframe?.getAttribute("srcdoc") ?? "").toContain(
      "pier-plugin://third.demo/1.0.0/dist/renderer.js"
    );
  });

  it("keeps official and workspace overrides off the sandbox track", () => {
    expect(isSandboxTrackCandidate(entryWithPanels(["third.demo.a"]))).toBe(
      false
    );
    expect(
      isSandboxTrackCandidate(entryWithPanels(["third.demo.a"], "devOverride"))
    ).toBe(false);
    expect(
      isSandboxTrackCandidate(entryWithPanels(["third.demo.a"], "local"))
    ).toBe(true);
  });

  it("does not intercept official plugins even when the sandbox flag is on", () => {
    window.localStorage.setItem("pier.sandboxTrack", "1");
    const runtime = {
      active: new Map(),
      externalDiagnosticPluginIds: new Set<string>(),
      externalPanelPlaceholders: {
        registerImplementation: () => () => undefined,
        unresolvedPanelIds: () => [],
      },
      reportExternalActivation: async () => undefined,
    };
    expect(
      maybeActivateViaSandboxTrack(
        runtime as never,
        entryWithPanels(["third.demo.a"], "official"),
        "sig"
      )
    ).toBe(false);
  });

  it("throws when declared panels cannot be resolved so the fast path is not skipped silently", () => {
    window.localStorage.setItem("pier.sandboxTrack", "1");
    const runtime = {
      active: new Map(),
      externalDiagnosticPluginIds: new Set<string>(),
      externalPanelPlaceholders: {
        registerImplementation: () => () => undefined,
        unresolvedPanelIds: () => ["third.demo.missing"],
      },
      reportExternalActivation: async () => undefined,
    };
    expect(() =>
      maybeActivateViaSandboxTrack(
        runtime as never,
        entryWithPanels(["third.demo.missing"], "local"),
        "sig"
      )
    ).toThrow(/could not resolve declared panels/);
  });
});
