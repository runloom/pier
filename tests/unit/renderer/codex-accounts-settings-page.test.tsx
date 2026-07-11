import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExternalRendererPluginContext } from "../../../packages/plugin-api/src/renderer.ts";
import pluginManifest from "../../../packages/plugin-codex/plugin.json" with {
  type: "json",
};
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
      {
        id: "acc-1",
        label: "test@codex.dev",
        planType: "pro",
        status: "active",
        error: null,
      },
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

  it("uses a semantic account table and has no redundant description or switch setting", async () => {
    const { context } = contextWithSnapshot(snapshotWithAccount());
    const { container } = render(<AccountsSettingsPage context={context} />);

    expect(
      await screen.findByRole("heading", { level: 1, name: "Codex Accounts" })
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Add account" })).toBeDefined();
    expect(container.querySelector('[data-slot="table"]')).not.toBeNull();
    expect(screen.getByRole("columnheader", { name: "Account" })).toBeDefined();
    expect(
      screen.getByRole("columnheader", { name: "Subscription" })
    ).toBeDefined();
    expect(
      screen.getByRole("columnheader", { name: "Quota status" })
    ).toBeDefined();
    expect(screen.getByRole("columnheader", { name: "Actions" })).toBeDefined();
    expect(screen.getAllByRole("columnheader")).toHaveLength(4);
    expect(container.querySelector("colgroup")?.children).toHaveLength(4);
    expect(container.querySelector("table")?.className).toContain(
      "pier-codex-account-table"
    );
    expect(
      screen
        .getByText("test@codex.dev")
        .closest("tr")
        ?.querySelectorAll("[data-account-action]")
    ).toHaveLength(3);
    expect(screen.getByText("PRO")).toBeDefined();
    expect(
      screen.queryByText(
        "Manage Codex accounts and compare session and weekly remaining limits."
      )
    ).toBeNull();
    expect("configuration" in pluginManifest).toBe(false);
  });

  it("uses fixed responsive columns without legacy widths or account icons", () => {
    const styles = readFileSync(
      resolve(process.cwd(), "packages/plugin-codex/src/renderer/styles.css"),
      "utf8"
    );

    expect(styles).toContain("table-layout: fixed");
    expect(styles).toContain("container-type: inline-size");
    expect(styles).toContain("@container (min-width: 28rem)");
    expect(styles).toContain("@container (max-width: 40rem)");
    expect(styles).not.toContain("min-width: 15rem");
    expect(styles).not.toContain("min-width: 18rem");
    expect(styles).not.toContain("pier-codex-account-icon");
  });

  it("renders the active account once with a system-default badge", async () => {
    const { context } = contextWithSnapshot(snapshotWithAccount());
    render(<AccountsSettingsPage context={context} />);

    expect(await screen.findByText("test@codex.dev")).toBeDefined();
    expect(screen.getAllByText("System default")).toHaveLength(1);
    expect(screen.queryByText("Current")).toBeNull();
    expect(screen.queryByText("Active")).toBeNull();
  });

  it("renders dashed empty state when no managed accounts", async () => {
    const { context } = contextWithSnapshot(emptySnapshot());
    render(<AccountsSettingsPage context={context} />);

    expect(await screen.findByText("No managed accounts")).toBeDefined();
    expect(screen.queryByText("System default")).toBeNull();
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

    fireEvent.click(
      screen.getByRole("button", { name: "Remove: other@codex.dev" })
    );

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

  it("switches accounts directly without a confirmation dialog", async () => {
    const snap = snapshotWithAccount({
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
    });
    const { context, invokeCalls } = contextWithSnapshot(snap);
    render(<AccountsSettingsPage context={context} />);

    await screen.findByText("other@codex.dev");
    expect(screen.queryByText("Available")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Switch: other@codex.dev" })
    );

    await vi.waitFor(() => {
      expect(invokeCalls).toContainEqual({
        method: "accounts.select",
        payload: { accountId: "acc-2" },
      });
    });
    expect(context.dialogs.confirm).not.toHaveBeenCalled();
  });

  it("refreshes quota for the selected row without switching accounts", async () => {
    const snap = snapshotWithAccount({
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
    });
    const { context, invokeCalls } = contextWithSnapshot(snap);
    render(<AccountsSettingsPage context={context} />);

    await screen.findByText("other@codex.dev");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Refresh usage: other@codex.dev",
      })
    );

    expect(invokeCalls).toContainEqual({
      method: "accounts.refreshUsage",
      payload: { accountId: "acc-2" },
    });
    expect(invokeCalls).not.toContainEqual({
      method: "accounts.select",
      payload: { accountId: "acc-2" },
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

  it("shows usage for system default and every managed account", async () => {
    const now = Date.now();
    const snap = snapshotWithAccount({
      accounts: [
        {
          id: "acc-1",
          label: "first@codex.dev",
          status: "active",
          error: null,
          usage: {
            fetchedAt: now,
            session: { usedPercent: 32 },
            status: "ok",
            weekly: { usedPercent: 68 },
          },
        },
        {
          id: "acc-2",
          label: "second@codex.dev",
          status: "available",
          error: null,
          usage: {
            fetchedAt: now,
            session: { usedPercent: 15 },
            status: "ok",
            weekly: { usedPercent: 40 },
          },
        },
      ],
    });
    const { context } = contextWithSnapshot(snap);
    const { container } = render(<AccountsSettingsPage context={context} />);

    await screen.findByText("first@codex.dev");
    expect(screen.getByText("second@codex.dev")).toBeDefined();
    expect(
      container.querySelectorAll('[data-slot="codex-usage-progress"]')
    ).toHaveLength(4);
    expect(
      container.querySelector('[data-risk="normal"] [data-slot="progress"]')
    ).toHaveAttribute("data-variant", "default");
    expect(container.textContent).toContain("32%");
    expect(container.textContent).toContain("68%");
    expect(container.textContent).not.toContain("remaining");
  });

  it("uses semantic progress variants at warning and critical thresholds", async () => {
    const now = Date.now();
    const snap = snapshotWithAccount({
      accounts: [
        {
          id: "acc-1",
          label: "thresholds@codex.dev",
          status: "active",
          error: null,
          usage: {
            fetchedAt: now,
            session: { usedPercent: 75 },
            status: "ok",
            weekly: { usedPercent: 90 },
          },
        },
      ],
    });
    const { context } = contextWithSnapshot(snap);
    const { container } = render(<AccountsSettingsPage context={context} />);

    await screen.findByText("thresholds@codex.dev");
    expect(
      container.querySelector('[data-risk="warning"] [data-slot="progress"]')
    ).toHaveAttribute("data-variant", "warning");
    expect(
      container.querySelector('[data-risk="critical"] [data-slot="progress"]')
    ).toHaveAttribute("data-variant", "destructive");
    expect(
      screen.getByRole("progressbar", {
        name: "Session: Used 75%, Warning",
      })
    ).toBeDefined();
    expect(
      screen.getByRole("progressbar", {
        name: "Weekly: Used 90%, Critical",
      })
    ).toBeDefined();
    expect(container.textContent).toContain("75% · Warning");
    expect(container.textContent).toContain("90% · Critical");
  });

  it("renders one compact state for missing and failed usage", async () => {
    const now = Date.now();
    const snap = snapshotWithAccount({
      accounts: [
        {
          id: "acc-1",
          label: "missing@codex.dev",
          status: "active",
          error: null,
        },
        {
          id: "acc-2",
          label: "failed@codex.dev",
          status: "error",
          error: null,
          usage: {
            error: "network unavailable",
            fetchedAt: now,
            status: "error",
          },
        },
      ],
    });
    const { context } = contextWithSnapshot(snap);
    render(<AccountsSettingsPage context={context} />);

    await screen.findByText("missing@codex.dev");
    expect(screen.getAllByText("No usage data")).toHaveLength(1);
    expect(screen.getAllByText("Usage update failed")).toHaveLength(1);
  });
});
