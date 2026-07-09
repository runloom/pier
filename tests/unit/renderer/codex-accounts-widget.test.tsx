import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ExternalRendererPluginContext,
  MissionControlWidgetComponentProps,
} from "../../../packages/plugin-api/src/renderer.ts";
import { AccountsWidget } from "../../../packages/plugin-codex/src/renderer/accounts-widget.tsx";
import type { CodexAccountsSnapshot } from "../../../packages/plugin-codex/src/shared/accounts.ts";

function baseProps(
  overrides: Partial<MissionControlWidgetComponentProps> = {}
): MissionControlWidgetComponentProps {
  return {
    instanceId: "widget-1",
    params: {},
    refreshToken: 0,
    size: { w: 4, h: 6 },
    updateParams: vi.fn(),
    visible: true,
    ...overrides,
  };
}

function usageSnapshot(
  overrides: Partial<CodexAccountsSnapshot> = {}
): CodexAccountsSnapshot {
  return {
    accounts: [
      { id: "acc-1", label: "test@codex.dev", status: "active", error: null },
    ],
    activeAccountId: "acc-1",
    activeUsage: {
      fetchedAt: Date.now(),
      status: "ok",
      session: { usedPercent: 32, resetsAt: Date.now() + 3_600_000 },
      weekly: { usedPercent: 68, resetsAt: Date.now() + 86_400_000 },
    },
    login: null,
    revision: 1,
    schemaVersion: 1,
    ...overrides,
  };
}

function systemDefaultSnapshot(): CodexAccountsSnapshot {
  return {
    accounts: [],
    activeAccountId: null,
    activeUsage: {
      fetchedAt: Date.now(),
      status: "ok",
      session: { usedPercent: 10, resetsAt: Date.now() + 3_600_000 },
      weekly: { usedPercent: 45 },
    },
    login: null,
    revision: 1,
    schemaVersion: 1,
  };
}

function contextWithSnapshot(snapshot: CodexAccountsSnapshot): {
  context: ExternalRendererPluginContext;
  invokeCalls: Array<{ method: string; payload: unknown }>;
} {
  const invokeCalls: Array<{ method: string; payload: unknown }> = [];
  const invoke: ExternalRendererPluginContext["rpc"]["invoke"] = async <T,>(
    method: string,
    payload?: unknown
  ): Promise<T> => {
    invokeCalls.push({ method, payload });
    return (method === "accounts.snapshot" ? snapshot : null) as T;
  };
  return {
    context: {
      app: { openSettings: vi.fn() },
      actions: { register: vi.fn(() => () => undefined) },
      configuration: {
        get: vi.fn(
          () => false
        ) as ExternalRendererPluginContext["configuration"]["get"],
        onDidChange: vi.fn(() => () => undefined),
        reset: vi.fn(async () => undefined),
        set: vi.fn(async () => undefined),
      },
      missionControlWidgets: { register: vi.fn(() => () => undefined) },
      dialogs: { alert: vi.fn(), confirm: vi.fn(async () => true) },
      i18n: {
        language: () => "en",
        t: vi.fn((_key: string, fallback?: string) => fallback ?? _key),
      },
      notifications: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
      rpc: { invoke, on: vi.fn(() => () => undefined) },
      settingsPages: { register: vi.fn(() => () => undefined) },
    },
    invokeCalls,
  };
}

/** Radix DropdownMenu triggers need pointerDown, not click. */
function openDropdown(triggerText: string): void {
  const el = screen.getByText(triggerText);
  const btn = el.closest("button");
  if (!btn) throw new Error(`No button ancestor for "${triggerText}"`);
  fireEvent.pointerDown(btn, {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
}

describe("AccountsWidget (usage)", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders remaining percent for session and weekly usage", async () => {
    const snap = usageSnapshot();
    const { context } = contextWithSnapshot(snap);
    const { container } = render(
      <AccountsWidget context={context} {...baseProps()} />
    );

    await screen.findByText("Session");
    expect(container.textContent).toContain("68% remaining");
    expect(container.textContent).toContain("32% remaining");
  });

  it("calls accounts.select when managed account is selected", async () => {
    const snap = usageSnapshot({
      accounts: [
        {
          id: "acc-1",
          label: "active@codex.dev",
          status: "active",
          error: null,
        },
        {
          id: "acc-2",
          label: "other@codex.dev",
          status: "available",
          error: null,
        },
      ],
      activeAccountId: "acc-1",
    });
    const { context, invokeCalls } = contextWithSnapshot(snap);
    render(<AccountsWidget context={context} {...baseProps()} />);

    await screen.findByText("active@codex.dev");
    openDropdown("active@codex.dev");

    const otherOption = await screen.findByText("other@codex.dev");
    fireEvent.click(otherOption);

    await vi.waitFor(() => {
      expect(invokeCalls).toContainEqual({
        method: "accounts.select",
        payload: { accountId: "acc-2" },
      });
    });
  });

  it("calls accounts.selectSystemDefault when system default is selected", async () => {
    const snap = usageSnapshot();
    const { context, invokeCalls } = contextWithSnapshot(snap);
    render(<AccountsWidget context={context} {...baseProps()} />);

    await screen.findByText("test@codex.dev");
    openDropdown("test@codex.dev");

    const sysOption = await screen.findByText("System default");
    fireEvent.click(sysOption);

    await vi.waitFor(() => {
      expect(invokeCalls).toContainEqual({
        method: "accounts.selectSystemDefault",
        payload: null,
      });
    });
  });

  it('calls app.openSettings when "Manage accounts..." is clicked', async () => {
    const snap = usageSnapshot();
    const { context } = contextWithSnapshot(snap);
    render(<AccountsWidget context={context} {...baseProps()} />);

    await screen.findByText("test@codex.dev");
    openDropdown("test@codex.dev");

    const manageBtn = await screen.findByText("Manage accounts...");
    fireEvent.click(manageBtn);

    expect(context.app.openSettings).toHaveBeenCalledWith({
      section: "plugin:pier.codex",
    });
  });

  it("calls accounts.refreshUsage when refreshToken changes", async () => {
    const snap = usageSnapshot();
    const { context, invokeCalls } = contextWithSnapshot(snap);
    const { rerender } = render(
      <AccountsWidget context={context} {...baseProps({ refreshToken: 0 })} />
    );

    await screen.findByText("Session");

    rerender(
      <AccountsWidget context={context} {...baseProps({ refreshToken: 1 })} />
    );

    await vi.waitFor(() => {
      expect(invokeCalls).toContainEqual({
        method: "accounts.refreshUsage",
        payload: null,
      });
    });
  });

  it("renders system default as current label when no active account", async () => {
    const snap = systemDefaultSnapshot();
    const { context } = contextWithSnapshot(snap);
    render(<AccountsWidget context={context} {...baseProps()} />);

    expect(await screen.findByText("System default")).toBeDefined();
  });
});
