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
} from "../../../../packages/plugin-api/src/renderer.ts";
import { AccountsWidget } from "../../../../packages/plugin-claude/src/renderer/accounts-widget.tsx";
import type { ClaudeAccountsSnapshot } from "../../../../packages/plugin-claude/src/shared/accounts.ts";

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

function activeSnapshot(): ClaudeAccountsSnapshot {
  return {
    accounts: [
      {
        email: "user@example.com",
        error: null,
        id: "acc-1",
        label: "user@example.com",
        status: "active",
        subscription: { planType: "max", organizationName: "Acme" },
      },
      {
        email: "other@example.com",
        error: null,
        id: "acc-2",
        label: "other@example.com",
        status: "available",
      },
    ],
    activeAccountId: "acc-1",
    login: null,
    revision: 1,
    schemaVersion: 1,
  };
}

function contextWithSnapshot(snapshot: ClaudeAccountsSnapshot): {
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
      app: {
        closeSettings: vi.fn(),
        openExternal: vi.fn(async () => true),
        openSettings,
      },
      actions: { register: vi.fn(() => () => undefined) },
      commandPalette: {
        openQuickPick: vi.fn(),
        updateQuickPick: vi.fn(),
      },
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
        choice: vi.fn(async () => "cancel" as const),
        confirm: vi.fn(async () => true),
        open: vi.fn(() => ({
          id: "pier.claude:test",
          result: Promise.resolve(null),
          close: vi.fn(),
          update: vi.fn(),
        })),
        prompt: vi.fn(async () => null),
        update: vi.fn(),
        close: vi.fn(),
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
        loading: vi.fn(() => ({
          dismiss: vi.fn(),
          info: vi.fn(),
          success: vi.fn(),
          update: vi.fn(),
        })),
        success: vi.fn(),
      },
      panels: { register: vi.fn(() => () => undefined) },
      rpc: {
        invoke,
        on: vi.fn(() => () => undefined),
      },
      terminals: {
        open: vi.fn(() =>
          Promise.resolve({ panelId: "terminal-1", windowId: "main" })
        ),
      },
      settingsPages: {
        register: vi.fn(() => () => undefined),
      },
    },
    openSettings,
  };
}

afterEach(() => {
  cleanup();
});

describe("Claude accounts widget", () => {
  it("keeps account identity outside one faded usage viewport", async () => {
    const { context } = contextWithSnapshot(activeSnapshot());
    const { container } = render(
      <AccountsWidget context={context} {...baseProps()} />
    );

    const accountLabel = await screen.findByText("user@example.com");
    const viewport = container.querySelector(
      '[data-slot="scroll-area-viewport"]'
    );

    expect(
      container.querySelectorAll('[data-slot="scroll-area"]')
    ).toHaveLength(1);
    expect(viewport).toHaveClass("scroll-fade-y", "overscroll-contain");
    expect(viewport?.contains(accountLabel)).toBe(false);
    expect(
      viewport?.querySelector('[data-slot="account-widget-usage-content"]')
    ).not.toBeNull();
  });

  it("shows the active account label", async () => {
    const { context } = contextWithSnapshot(activeSnapshot());
    await act(async () => {
      render(<AccountsWidget context={context} {...baseProps()} />);
    });
    expect(await screen.findByText("user@example.com")).toBeTruthy();
    expect(screen.getByText(/MAX/)).toBeTruthy();
  });

  it("hides the switch picker when only one account exists", async () => {
    const snap = activeSnapshot();
    snap.accounts = [snap.accounts[0]!];
    const { context } = contextWithSnapshot(snap);
    await act(async () => {
      render(<AccountsWidget context={context} {...baseProps()} />);
    });
    expect(await screen.findByText("user@example.com")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Switch account" })).toBeNull();
  });

  it("keeps only the account label and switcher in compact multi-account mode", async () => {
    const { context } = contextWithSnapshot(activeSnapshot());
    const { container } = render(
      <AccountsWidget
        context={context}
        {...baseProps({ size: { w: 4, h: 2 } })}
      />
    );

    expect(await screen.findByText("user@example.com")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Switch account" })).toBeTruthy();
    expect(container.querySelector('[data-slot="avatar"]')).toBeNull();
    expect(screen.queryByText(/MAX/)).toBeNull();
  });

  it("shows unavailable copy when the active account has an error", async () => {
    const snap = activeSnapshot();
    snap.accounts[0] = {
      ...snap.accounts[0]!,
      error: "credential missing",
      status: "error",
    };
    const { context } = contextWithSnapshot(snap);
    await act(async () => {
      render(<AccountsWidget context={context} {...baseProps()} />);
    });
    expect(
      await screen.findByText(
        "Account unavailable — open Manage accounts to fix"
      )
    ).toBeTruthy();
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
      section: "plugin:pier.claude",
    });
  });

  it("renders load failures via WidgetError", async () => {
    const { context } = contextWithSnapshot(activeSnapshot());
    context.rpc.invoke = async () => {
      throw new Error("boom");
    };
    await act(async () => {
      render(<AccountsWidget context={context} {...baseProps()} />);
    });
    expect(
      await screen.findByText("Could not load Claude accounts")
    ).toBeTruthy();
  });
});
