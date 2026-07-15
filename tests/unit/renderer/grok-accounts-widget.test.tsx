import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ExternalRendererPluginContext,
  WorkbenchWidgetComponentProps,
} from "../../../packages/plugin-api/src/renderer.ts";
import { AccountsWidget } from "../../../packages/plugin-grok/src/renderer/accounts-widget.tsx";
import type { GrokAccountsSnapshot } from "../../../packages/plugin-grok/src/shared/accounts.ts";

function baseProps(
  overrides: Partial<WorkbenchWidgetComponentProps> = {}
): WorkbenchWidgetComponentProps {
  return {
    instanceId: "widget-1",
    params: {},
    refreshToken: 0,
    size: { w: 4, h: 3 },
    updateParams: vi.fn(),
    visible: true,
    ...overrides,
  };
}

function activeSnapshot(): GrokAccountsSnapshot {
  return {
    accounts: [
      {
        email: "user@example.com",
        error: null,
        id: "acc-1",
        kind: "oidc",
        label: "user@example.com",
        status: "active",
        usage: {
          fetchedAt: Date.now(),
          status: "ok",
          windows: [
            {
              id: "grok:period",
              limitId: "period",
              limitName: "Weekly limit",
              usedPercent: 40,
              windowMinutes: 10_080,
            },
            {
              id: "grok:product:Api",
              limitId: "product",
              limitName: "API",
              usedPercent: 40,
              windowMinutes: 10_080,
            },
          ],
        },
      },
      {
        error: null,
        id: "acc-2",
        kind: "api_key",
        label: "API key",
        status: "available",
      },
    ],
    activeAccountId: "acc-1",
    activeUsage: {
      fetchedAt: Date.now(),
      status: "ok",
      windows: [
        {
          id: "grok:period",
          limitId: "period",
          limitName: "Weekly limit",
          usedPercent: 40,
          windowMinutes: 10_080,
        },
      ],
    },
    login: null,
    revision: 1,
    schemaVersion: 1,
  };
}

function contextWithSnapshot(snapshot: GrokAccountsSnapshot): {
  context: ExternalRendererPluginContext;
  openSettings: ReturnType<typeof vi.fn>;
} {
  const openSettings = vi.fn();
  const invoke: ExternalRendererPluginContext["rpc"]["invoke"] = async <T,>(
    method: string
  ): Promise<T> => {
    if (method === "accounts.snapshot") {
      return snapshot as T;
    }
    return null as T;
  };
  return {
    context: {
      app: { openSettings },
      actions: { register: vi.fn(() => () => undefined) },
      configuration: {
        get: vi.fn(
          () => false
        ) as ExternalRendererPluginContext["configuration"]["get"],
        onDidChange: vi.fn(() => () => undefined),
        reset: vi.fn(async () => undefined),
        set: vi.fn(async () => undefined),
      },
      workbenchWidgets: {
        register: vi.fn(() => () => undefined),
      },
      dialogs: {
        alert: vi.fn(async () => undefined),
        confirm: vi.fn(async () => true),
      },
      i18n: {
        language: () => "en",
        t: vi.fn((_key: string, fallback?: string) => fallback ?? _key),
      },
      lifecycle: {
        beforeSuspend: vi.fn(() => () => undefined),
      },
      notifications: {
        error: vi.fn(),
        info: vi.fn(),
        success: vi.fn(),
      },
      panels: { register: vi.fn(() => () => undefined) },
      rpc: {
        invoke,
        on: vi.fn(() => () => undefined),
      },
      settingsPages: {
        register: vi.fn(() => () => undefined),
      },
      terminalStatusItems: {
        register: vi.fn(() => () => undefined),
      },
    },
    openSettings,
  };
}

afterEach(() => {
  cleanup();
});

describe("Grok accounts widget", () => {
  it("shows active account with quota meters", async () => {
    const { context } = contextWithSnapshot(activeSnapshot());
    await act(async () => {
      render(<AccountsWidget context={context} {...baseProps()} />);
    });
    expect(await screen.findByText("user@example.com")).toBeTruthy();
    expect(
      document.querySelector("[data-slot='grok-quota-group']")
    ).toBeTruthy();
    expect(
      document.querySelector("[data-slot='grok-usage-progress']")
    ).toBeTruthy();
    expect(
      screen.queryByText("Quota monitoring is not available yet")
    ).toBeNull();
    expect(screen.queryByText(/No Grok quota windows/i)).toBeNull();
  });

  it("opens plugin settings from manage accounts", async () => {
    const { context, openSettings } = contextWithSnapshot(activeSnapshot());
    await act(async () => {
      render(<AccountsWidget context={context} {...baseProps()} />);
    });
    const switchButton = await screen.findByRole("button", {
      name: "Switch account",
    });
    await act(async () => {
      fireEvent.pointerDown(switchButton, {
        button: 0,
        ctrlKey: false,
      });
    });
    const manage = await screen.findByText("Manage accounts...");
    await act(async () => {
      fireEvent.click(manage);
    });
    expect(openSettings).toHaveBeenCalledWith({
      section: "plugin:pier.grok",
    });
  });
});
