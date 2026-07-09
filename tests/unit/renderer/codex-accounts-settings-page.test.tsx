import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExternalRendererPluginContext } from "../../../packages/plugin-api/src/renderer.ts";
import { AccountsSettingsPage } from "../../../packages/plugin-codex/src/renderer/accounts-settings-page.tsx";
import type { CodexAccountsSnapshot } from "../../../packages/plugin-codex/src/shared/accounts.ts";

function emptySnapshot(): CodexAccountsSnapshot {
  return {
    accounts: [],
    activeAccountId: null,
    activeUsage: null,
    login: null,
    revision: 1,
    schemaVersion: 1,
  };
}

function snapshotWithAccount(
  overrides: Partial<CodexAccountsSnapshot> = {}
): CodexAccountsSnapshot {
  return {
    accounts: [
      { id: "acc-1", label: "test@codex.dev", status: "active", error: null },
    ],
    activeAccountId: "acc-1",
    activeUsage: null,
    login: null,
    revision: 2,
    schemaVersion: 1,
    ...overrides,
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
      app: {
        openSettings: vi.fn(),
      },
      actions: {
        register: vi.fn(() => () => undefined),
      },
      configuration: {
        get: vi.fn(
          () => false
        ) as ExternalRendererPluginContext["configuration"]["get"],
        onDidChange: vi.fn(() => () => undefined),
        reset: vi.fn(async () => undefined),
        set: vi.fn(async () => undefined),
      },
      missionControlWidgets: {
        register: vi.fn(() => () => undefined),
      },
      dialogs: {
        alert: vi.fn(),
        confirm: vi.fn(async () => true),
      },
      i18n: {
        language: () => "en",
        t: vi.fn((_key: string, fallback?: string) => fallback ?? _key),
      },
      notifications: {
        error: vi.fn(),
        info: vi.fn(),
        success: vi.fn(),
      },
      rpc: {
        invoke,
        on: vi.fn(() => () => undefined),
      },
      settingsPages: {
        register: vi.fn(() => () => undefined),
      },
    },
    invokeCalls,
  };
}

describe("AccountsSettingsPage", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders system default card with 'Current' badge when activeAccountId is null", async () => {
    const { context } = contextWithSnapshot(emptySnapshot());
    render(<AccountsSettingsPage context={context} />);

    expect(await screen.findByText("System default")).toBeDefined();
    expect(screen.getByText("Current")).toBeDefined();
  });

  it("renders dashed empty state when no managed accounts", async () => {
    const { context } = contextWithSnapshot(emptySnapshot());
    render(<AccountsSettingsPage context={context} />);

    await screen.findByText("System default");
    expect(screen.getByText("No managed accounts")).toBeDefined();
  });

  it('calls accounts.add when "Add account" is clicked', async () => {
    const { context, invokeCalls } = contextWithSnapshot(emptySnapshot());
    render(<AccountsSettingsPage context={context} />);

    fireEvent.click(await screen.findByText("Add account"));
    expect(invokeCalls).toContainEqual({ method: "accounts.add", payload: {} });
  });

  it("shows destructive confirm before removing an account", async () => {
    const multiSnap = snapshotWithAccount({
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
    const { context: ctx, invokeCalls } = contextWithSnapshot(multiSnap);
    render(<AccountsSettingsPage context={ctx} />);

    // Wait for snapshot to load
    await screen.findByText("active@codex.dev");

    const removeButtons = screen.getAllByText("Remove");
    expect(removeButtons.length).toBeGreaterThan(0);
    fireEvent.click(removeButtons[0]!);

    expect(ctx.dialogs.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ intent: "destructive" })
    );

    // After confirming, should call accounts.remove
    await vi.waitFor(() => {
      expect(invokeCalls).toContainEqual({
        method: "accounts.remove",
        payload: { accountId: "acc-2" },
      });
    });
  });

  it("calls accounts.selectSystemDefault when system default card is clicked while non-default active", async () => {
    const snap = snapshotWithAccount();
    const { context, invokeCalls } = contextWithSnapshot(snap);
    render(<AccountsSettingsPage context={context} />);

    expect(await screen.findByText("System default")).toBeDefined();

    // There should be a "Switch" button on the system default card (not current)
    const switchButtons = screen.getAllByText("Switch");
    // First "Switch" is on the system default card
    fireEvent.click(switchButtons[0]!);

    await vi.waitFor(() => {
      expect(invokeCalls).toContainEqual({
        method: "accounts.selectSystemDefault",
        payload: null,
      });
    });
  });

  it("renders login alert with cancel when login is pending", async () => {
    const snap = snapshotWithAccount({
      login: { provider: "codex", startedAt: Date.now() },
    });
    const { context } = contextWithSnapshot(snap);
    render(<AccountsSettingsPage context={context} />);

    expect(await screen.findByText("Login in progress")).toBeDefined();
    expect(screen.getByText("Cancel login")).toBeDefined();
  });
});
