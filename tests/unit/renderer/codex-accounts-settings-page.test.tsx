import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
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
    },
    invokeCalls,
  };
}

describe("AccountsSettingsPage", () => {
  afterEach(() => {
    cleanup();
  });

  it("uses the active account and cost card without redundant copy", async () => {
    const { context } = contextWithSnapshot(snapshotWithAccount());
    const { container } = render(<AccountsSettingsPage context={context} />);

    expect(
      await screen.findByRole("heading", { level: 1, name: "Codex Accounts" })
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Add account" })).toBeDefined();
    expect(screen.getByTestId("codex-active-account")).toBeDefined();
    expect(container.querySelector('[data-slot="avatar"]')).not.toBeNull();
    expect(
      container.querySelector('[data-slot="avatar-fallback"]')
    ).toHaveTextContent("T");
    expect(container.querySelector(".pier-codex-avatar")).toBeNull();
    expect(screen.getByTestId("codex-cost-card")).toBeDefined();
    expect(screen.getByText("PRO · Resets unavailable")).toBeDefined();
    expect(screen.getByText("Last 31 days cost")).toBeDefined();
    expect(
      container.querySelectorAll(".pier-codex-cost-bars [data-cost-bar]")
    ).toHaveLength(31);
    expect(
      screen.queryByText(
        "Manage Codex accounts and compare session and weekly remaining limits."
      )
    ).toBeNull();
    expect("configuration" in pluginManifest).toBe(false);
  });

  it("uses responsive grids and semantic design tokens", () => {
    const styles = readFileSync(
      resolve(process.cwd(), "packages/plugin-codex/src/renderer/styles.css"),
      "utf8"
    );

    expect(styles).toContain("grid-template-columns: repeat(31");
    expect(styles).toContain("@media (max-width: 48rem)");
    expect(styles).toContain("var(--chart-2)");
    expect(styles).not.toMatch(/#[0-9a-f]{3,8}/i);
  });

  it("renders the active account once with a system-default badge", async () => {
    const { context } = contextWithSnapshot(snapshotWithAccount());
    render(<AccountsSettingsPage context={context} />);

    expect(await screen.findByText("test@codex.dev")).toBeDefined();
    expect(screen.getAllByText("System default")).toHaveLength(1);
    expect(screen.queryByText("Current")).toBeNull();
    expect(screen.queryByText("Active")).toBeNull();
  });

  it("centers account avatars against the complete identity block", async () => {
    const { context } = contextWithSnapshot(
      snapshotWithAccount({
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
      })
    );
    const { container } = render(<AccountsSettingsPage context={context} />);

    await screen.findByText("other@codex.dev");
    const media = container.querySelector(
      '[data-testid="codex-account-usage-row"] [data-slot="item-media"]'
    );
    expect(media).toHaveAttribute("data-align", "center");
    expect(media).toHaveClass("self-center");
  });

  it("shows reset credits, remaining quota and host-computed cost history", async () => {
    const { context } = contextWithSnapshot(
      snapshotWithAccount({
        accounts: [
          {
            error: null,
            id: "acc-1",
            label: "test@codex.dev",
            planType: "plus",
            status: "active",
            usage: {
              fetchedAt: Date.now(),
              resetCreditsAvailable: 3,
              session: { usedPercent: 38 },
              status: "ok",
              weekly: { usedPercent: 64 },
            },
          },
        ],
        costUsage: {
          buckets: [
            {
              date: "2026-07-11",
              estimatedCostMicrousd: 1_250_000,
              pricingStatus: "complete",
              tokens: {
                cachedInputTokens: 10,
                inputTokens: 80,
                outputTokens: 20,
                reasoningTokens: 0,
                totalTokens: 100,
              },
            },
          ],
          coverage: { complete: true, from: "2026-06-11", to: "2026-07-11" },
          observedAt: Date.now(),
          summary: {
            estimatedCostMicrousd: 1_250_000,
            latestDayTokens: 100,
            periodTokens: 100,
            todayEstimatedCostMicrousd: 1_250_000,
          },
        },
      })
    );
    const { container } = render(<AccountsSettingsPage context={context} />);

    expect(await screen.findByText("PLUS · 3 resets")).toBeDefined();
    expect(screen.getByText("62%")).toBeDefined();
    expect(screen.getByText("36%")).toBeDefined();
    expect(screen.getAllByText("$1.25")).toHaveLength(2);
    expect(
      container.querySelectorAll(".pier-codex-cost-bars [data-cost-bar]")
    ).toHaveLength(31);
    const pricedBar = container.querySelector(
      '.pier-codex-cost-bars [data-cost-bar][aria-label*="$1.25"]'
    );
    expect(pricedBar).not.toBeNull();
    await act(async () => {
      fireEvent.focus(pricedBar as Element);
    });
    await vi.waitFor(() => {
      const tooltip = document.querySelector('[data-slot="tooltip-content"]');
      expect(tooltip).toHaveTextContent("2026-07-11");
      expect(tooltip).toHaveTextContent("Cost: $1.25");
      expect(tooltip).toHaveTextContent("Tokens: 100");
    });
  });

  it("refreshes cost independently with loading and success feedback", async () => {
    const snapshot = snapshotWithAccount();
    const { context } = contextWithSnapshot(snapshot);
    let resolveRefresh: (() => void) | undefined;
    const refreshPending = new Promise<void>((resolvePromise) => {
      resolveRefresh = resolvePromise;
    });
    context.rpc.invoke = async <T,>(method: string): Promise<T> => {
      if (method === "accounts.snapshot") return snapshot as T;
      if (method === "usage.refreshCost") await refreshPending;
      return null as T;
    };
    render(<AccountsSettingsPage context={context} />);

    const refreshButton = await screen.findByRole("button", {
      name: "Refresh cost",
    });
    await act(async () => {
      fireEvent.click(refreshButton);
    });

    await vi.waitFor(() => {
      expect(refreshButton).toBeDisabled();
      expect(refreshButton).toHaveAttribute("aria-busy", "true");
      expect(refreshButton.querySelector("svg")).toHaveClass("animate-spin");
    });

    await act(async () => {
      resolveRefresh?.();
      await refreshPending;
    });
    await vi.waitFor(() => {
      expect(refreshButton).not.toBeDisabled();
      expect(context.notifications.success).toHaveBeenCalledWith(
        "Cost data refreshed"
      );
    });
  });

  it("explains incomplete cost coverage with scan diagnostics", async () => {
    const { context } = contextWithSnapshot(
      snapshotWithAccount({
        costUsage: {
          buckets: [],
          coverage: { complete: false, from: "2026-06-11", to: "2026-07-11" },
          diagnostics: {
            candidateFiles: 3,
            deduplicatedEvents: 2,
            failedFiles: 1,
            forkedFiles: 1,
            malformedLines: 4,
            parsedFiles: 3,
            reusedFiles: 0,
            truncatedFiles: 0,
            uniqueEvents: 2,
          },
          observedAt: Date.now(),
          summary: {
            estimatedCostMicrousd: null,
            latestDayTokens: 0,
            periodTokens: 0,
            todayEstimatedCostMicrousd: null,
          },
        },
      })
    );
    render(<AccountsSettingsPage context={context} />);

    const partial = await screen.findByText("Partial data");
    fireEvent.focus(partial);

    await vi.waitFor(() => {
      const tooltip = document.querySelector('[data-slot="tooltip-content"]');
      expect(tooltip).toHaveTextContent("1 files could not be read");
      expect(tooltip).toHaveTextContent("4 malformed log lines");
      expect(tooltip).not.toHaveTextContent("repeated fork events");
    });
  });

  it("restores the cost refresh button and shows details after failure", async () => {
    const snapshot = snapshotWithAccount();
    const { context } = contextWithSnapshot(snapshot);
    context.rpc.invoke = async <T,>(method: string): Promise<T> => {
      if (method === "accounts.snapshot") return snapshot as T;
      if (method === "usage.refreshCost") throw new Error("scan failed");
      return null as T;
    };
    render(<AccountsSettingsPage context={context} />);

    const refreshButton = await screen.findByRole("button", {
      name: "Refresh cost",
    });
    await act(async () => {
      fireEvent.click(refreshButton);
    });

    await vi.waitFor(() => {
      expect(context.dialogs.alert).toHaveBeenCalledWith({
        body: "scan failed",
        title: "Could not refresh cost data",
      });
      expect(refreshButton).not.toBeDisabled();
    });
    expect(context.notifications.success).not.toHaveBeenCalled();
  });

  it("renders a team account's single quota without an invented empty lane", async () => {
    const { context } = contextWithSnapshot(
      snapshotWithAccount({
        accounts: [
          {
            error: null,
            id: "acc-1",
            label: "team@codex.dev",
            planType: "team",
            status: "active",
            usage: {
              fetchedAt: Date.now(),
              resetCreditsAvailable: 0,
              session: { usedPercent: 5, windowMinutes: 300 },
              status: "ok",
            },
          },
        ],
      })
    );
    const { container } = render(<AccountsSettingsPage context={context} />);

    expect(await screen.findByText("TEAM · 0 resets")).toBeDefined();
    expect(screen.getByText("5-hour remaining")).toBeDefined();
    expect(screen.getByText("95%")).toBeDefined();
    expect(screen.queryByText("Weekly remaining")).toBeNull();
    expect(screen.queryByText("No usage data")).toBeNull();
    expect(
      container.querySelector('.pier-codex-quota-grid[data-count="1"]')
    ).not.toBeNull();
  });

  it("labels a normalized weekly-only account as weekly", async () => {
    const { context } = contextWithSnapshot(
      snapshotWithAccount({
        accounts: [
          {
            error: null,
            id: "acc-1",
            label: "weekly@codex.dev",
            planType: "team",
            status: "active",
            usage: {
              fetchedAt: Date.now(),
              status: "ok",
              weekly: { usedPercent: 5, windowMinutes: 10_080 },
            },
          },
        ],
      })
    );
    render(<AccountsSettingsPage context={context} />);

    expect(await screen.findByText("Weekly remaining")).toBeDefined();
    expect(screen.queryByText("5-hour remaining")).toBeNull();
    expect(screen.queryByText("No usage data")).toBeNull();
  });

  it("shows a per-account usage error instead of an empty quota", async () => {
    const { context } = contextWithSnapshot(
      snapshotWithAccount({
        accounts: [
          {
            error: null,
            id: "acc-1",
            label: "failed@codex.dev",
            planType: "plus",
            status: "active",
            usage: {
              error: "refresh token expired",
              fetchedAt: Date.now(),
              status: "error",
            },
          },
        ],
      })
    );
    render(<AccountsSettingsPage context={context} />);

    expect(await screen.findByText("Usage update failed")).toBeDefined();
    expect(screen.queryByText("No usage data")).toBeNull();
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
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", {
          name: "Refresh usage: other@codex.dev",
        })
      );
    });

    expect(invokeCalls).toContainEqual({
      method: "accounts.refreshUsage",
      payload: { accountId: "acc-2" },
    });
    expect(invokeCalls).not.toContainEqual({
      method: "accounts.select",
      payload: { accountId: "acc-2" },
    });
  });

  it("shows a spinning refresh state and success notification", async () => {
    const snapshot = snapshotWithAccount();
    const { context } = contextWithSnapshot(snapshot);
    let resolveRefresh: (() => void) | undefined;
    const refreshPending = new Promise<void>((resolvePromise) => {
      resolveRefresh = resolvePromise;
    });
    context.rpc.invoke = async <T,>(method: string): Promise<T> => {
      if (method === "accounts.snapshot") return snapshot as T;
      if (method === "accounts.refreshUsage") await refreshPending;
      return null as T;
    };
    render(<AccountsSettingsPage context={context} />);

    const refreshButton = await screen.findByRole("button", {
      name: "Refresh usage",
    });
    fireEvent.click(refreshButton);

    await vi.waitFor(() => {
      expect(refreshButton).toBeDisabled();
      expect(refreshButton).toHaveAttribute("aria-busy", "true");
      expect(refreshButton.querySelector("svg")).toHaveClass("animate-spin");
    });

    await act(async () => {
      resolveRefresh?.();
      await refreshPending;
    });
    await vi.waitFor(() => {
      expect(refreshButton).not.toBeDisabled();
      expect(context.notifications.success).toHaveBeenCalledWith(
        "Usage refreshed"
      );
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
    expect(container.textContent).toContain("68%");
    expect(container.textContent).toContain("32%");
    expect(container.textContent).toContain("5-hour remaining");
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
        name: "5-hour remaining 25%",
      })
    ).toBeDefined();
    expect(
      screen.getByRole("progressbar", {
        name: "Weekly remaining 10%",
      })
    ).toBeDefined();
    expect(container.textContent).toContain("25%");
    expect(container.textContent).toContain("10%");
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
