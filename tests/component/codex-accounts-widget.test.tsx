import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { createAccountsWidget } from "@plugins/builtin/codex/renderer/accounts-widget.tsx";
import type {
  AccountUsage,
  AgentAccount,
  AgentAccountsSnapshot,
} from "@shared/contracts/agent-accounts.ts";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const widgetProps = { size: { h: 4, w: 4 } } as const;

function makeAccount(overrides?: Partial<AgentAccount>): AgentAccount {
  return {
    createdAt: 1_700_000_000_000,
    email: "user@example.com",
    id: "acct-1",
    provider: "codex",
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function makeUsage(overrides?: Partial<AccountUsage>): AccountUsage {
  return {
    accountId: "acct-1",
    fetchedAt: Date.now(),
    status: "ok",
    session: { usedPercent: 42, windowMinutes: 60 },
    weekly: { usedPercent: 15, windowMinutes: 10_080 },
    ...overrides,
  };
}

function makeSnapshot(
  overrides?: Partial<AgentAccountsSnapshot>
): AgentAccountsSnapshot {
  return {
    accounts: [],
    activeAccountId: null,
    lastLoginError: null,
    loginPending: null,
    ts: Date.now(),
    usage: {},
    ...overrides,
  };
}

function makeContext(
  snapshot: AgentAccountsSnapshot,
  overrides?: {
    codexDetected?: boolean;
    confirmSwitch?: boolean;
    confirmResult?: boolean;
    selectFail?: Error;
    addFail?: Error;
  }
): RendererPluginContext {
  const opts = {
    codexDetected: true,
    confirmSwitch: false,
    confirmResult: true,
    ...overrides,
  };

  const loadingHandle = {
    dismiss: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  };

  return {
    accounts: {
      snapshot: vi.fn(() => snapshot),
      onDidChange: vi.fn(() => vi.fn()),
      select: opts.selectFail
        ? vi.fn().mockRejectedValue(opts.selectFail)
        : vi.fn().mockResolvedValue(undefined),
      adoptCurrent: vi.fn().mockResolvedValue(undefined),
      add: opts.addFail
        ? vi.fn().mockRejectedValue(opts.addFail)
        : vi.fn().mockResolvedValue(undefined),
      cancelLogin: vi.fn().mockResolvedValue(undefined),
      refreshUsage: vi.fn().mockResolvedValue(undefined),
    },
    agents: {
      selection: vi.fn().mockResolvedValue({
        detectedIds: opts.codexDetected ? ["codex"] : [],
        enabledIds: opts.codexDetected ? ["codex"] : [],
        selectedId: opts.codexDetected ? "codex" : null,
      }),
    },
    configuration: {
      get: vi.fn((key: string) => {
        if (key === "pier.codex.confirmSwitch") {
          return opts.confirmSwitch;
        }
        return;
      }),
      onDidChange: vi.fn(() => vi.fn()),
      reset: vi.fn().mockResolvedValue(undefined),
      set: vi.fn().mockResolvedValue(undefined),
    },
    dialogs: {
      alert: vi.fn().mockResolvedValue(undefined),
      confirm: vi.fn().mockResolvedValue(opts.confirmResult),
    },
    i18n: {
      commandDescription: vi.fn(() => undefined),
      commandTitle: vi.fn((_id: string, fallback?: string) => fallback ?? ""),
      language: vi.fn(() => "en"),
      t: vi.fn(
        (_key: string, _values?: unknown, fallback?: string) => fallback ?? _key
      ),
    },
    notifications: {
      error: vi.fn(),
      info: vi.fn(),
      loading: vi.fn(() => loadingHandle),
      success: vi.fn(),
      system: vi.fn().mockResolvedValue({ shown: true }),
    },
  } as unknown as RendererPluginContext;
}

describe("CodexAccountsWidget", () => {
  it("state-empty: no accounts shows empty guidance", async () => {
    const snap = makeSnapshot();
    const ctx = makeContext(snap);
    const Widget = createAccountsWidget(ctx);

    await act(() => {
      render(<Widget {...widgetProps} />);
    });

    expect(screen.getByTestId("state-empty")).toBeInTheDocument();
    expect(screen.getByTestId("add-btn")).toBeInTheDocument();
    expect(
      screen.getByText("No Codex account configured.")
    ).toBeInTheDocument();
  });

  it("state-normal: shows account list with active highlight and usage bars", async () => {
    const acct1 = makeAccount({
      id: "acct-1",
      email: "a@example.com",
      planType: "pro",
    });
    const acct2 = makeAccount({ id: "acct-2", email: "b@example.com" });
    const usage1 = makeUsage({ accountId: "acct-1" });
    const snap = makeSnapshot({
      accounts: [acct1, acct2],
      activeAccountId: "acct-1",
      usage: { "acct-1": usage1 },
    });
    const ctx = makeContext(snap);
    const Widget = createAccountsWidget(ctx);

    await act(() => {
      render(<Widget {...widgetProps} />);
    });

    expect(screen.getByTestId("state-normal")).toBeInTheDocument();
    expect(screen.getByTestId("account-row-acct-1")).toBeInTheDocument();
    expect(screen.getByTestId("account-row-acct-2")).toBeInTheDocument();
    expect(screen.getByTestId("active-indicator")).toBeInTheDocument();
    expect(screen.getByTestId("usage-bar-session")).toBeInTheDocument();
    expect(screen.getByTestId("usage-bar-weekly")).toBeInTheDocument();
    expect(screen.getByText("a@example.com")).toBeInTheDocument();
    expect(screen.getByText("pro")).toBeInTheDocument();
    // inactive account has switch button
    expect(screen.getByTestId("switch-btn-acct-2")).toBeInTheDocument();
  });

  it("loginPending: shows waiting message and cancel button", async () => {
    const snap = makeSnapshot({ loginPending: "codex" });
    const ctx = makeContext(snap);
    const Widget = createAccountsWidget(ctx);

    await act(() => {
      render(<Widget {...widgetProps} />);
    });

    expect(screen.getByTestId("state-empty")).toBeInTheDocument();
    expect(screen.getByTestId("cancel-login-btn")).toBeInTheDocument();
    expect(
      screen.getByText("Complete login in your browser…")
    ).toBeInTheDocument();
  });

  it("switch with confirm chain: confirmed → calls select", async () => {
    const acct1 = makeAccount({ id: "acct-1", email: "a@example.com" });
    const acct2 = makeAccount({ id: "acct-2", email: "b@example.com" });
    const snap = makeSnapshot({
      accounts: [acct1, acct2],
      activeAccountId: "acct-1",
    });
    const ctx = makeContext(snap, { confirmSwitch: true, confirmResult: true });
    const Widget = createAccountsWidget(ctx);

    await act(() => {
      render(<Widget {...widgetProps} />);
    });

    await act(() => {
      fireEvent.click(screen.getByTestId("switch-btn-acct-2"));
    });

    await waitFor(() => {
      expect(ctx.dialogs.confirm).toHaveBeenCalled();
      expect(ctx.accounts.select).toHaveBeenCalledWith("acct-2");
    });
  });

  it("switch confirm cancelled: does not call select", async () => {
    const acct1 = makeAccount({ id: "acct-1", email: "a@example.com" });
    const acct2 = makeAccount({ id: "acct-2", email: "b@example.com" });
    const snap = makeSnapshot({
      accounts: [acct1, acct2],
      activeAccountId: "acct-1",
    });
    const ctx = makeContext(snap, {
      confirmSwitch: true,
      confirmResult: false,
    });
    const Widget = createAccountsWidget(ctx);

    await act(() => {
      render(<Widget {...widgetProps} />);
    });

    await act(() => {
      fireEvent.click(screen.getByTestId("switch-btn-acct-2"));
    });

    await waitFor(() => {
      expect(ctx.dialogs.confirm).toHaveBeenCalled();
      expect(ctx.accounts.select).not.toHaveBeenCalled();
    });
  });

  it("usage error state does not crash", async () => {
    const acct = makeAccount({ id: "acct-1" });
    const errorUsage = makeUsage({
      accountId: "acct-1",
      status: "error",
      error: "rate limit exceeded",
    });
    const snap = makeSnapshot({
      accounts: [acct],
      activeAccountId: "acct-1",
      usage: { "acct-1": errorUsage },
    });
    const ctx = makeContext(snap);
    const Widget = createAccountsWidget(ctx);

    await act(() => {
      render(<Widget {...widgetProps} />);
    });

    expect(screen.getByTestId("state-normal")).toBeInTheDocument();
    expect(screen.getByTestId("account-row-acct-1")).toBeInTheDocument();
    expect(screen.getAllByText("rate limit exceeded").length).toBeGreaterThan(
      0
    );
  });

  it("state-not-installed: codex not detected shows install guidance", async () => {
    const snap = makeSnapshot();
    const ctx = makeContext(snap, { codexDetected: false });
    const Widget = createAccountsWidget(ctx);

    await act(() => {
      render(<Widget {...widgetProps} />);
    });

    expect(screen.getByTestId("state-not-installed")).toBeInTheDocument();
    expect(screen.getByText("Codex CLI not detected")).toBeInTheDocument();
  });

  it("handleSwitch select failure calls notifications.error", async () => {
    const acct1 = makeAccount({ id: "acct-1", email: "a@example.com" });
    const acct2 = makeAccount({ id: "acct-2", email: "b@example.com" });
    const snap = makeSnapshot({
      accounts: [acct1, acct2],
      activeAccountId: "acct-1",
    });
    const switchErr = new Error("network error");
    const ctx = makeContext(snap, { selectFail: switchErr });
    const Widget = createAccountsWidget(ctx);

    await act(() => {
      render(<Widget {...widgetProps} />);
    });

    await act(() => {
      fireEvent.click(screen.getByTestId("switch-btn-acct-2"));
    });

    await waitFor(() => {
      expect(ctx.notifications.error).toHaveBeenCalledWith(
        "Failed to switch account",
        { description: "Error: network error" }
      );
    });
  });

  it("handleAdd failure calls notifications.error", async () => {
    const snap = makeSnapshot();
    const addErr = new Error("add failed");
    const ctx = makeContext(snap, { addFail: addErr });
    const Widget = createAccountsWidget(ctx);

    await act(() => {
      render(<Widget {...widgetProps} />);
    });

    await act(() => {
      fireEvent.click(screen.getByTestId("add-btn"));
    });

    await waitFor(() => {
      expect(ctx.notifications.error).toHaveBeenCalledWith(
        "Failed to add account",
        { description: "Error: add failed" }
      );
    });
  });

  it("lastLoginError: shows error alert in empty state", async () => {
    const snap = makeSnapshot({
      lastLoginError: { at: Date.now(), message: "Auth server unreachable" },
    });
    const ctx = makeContext(snap);
    const Widget = createAccountsWidget(ctx);

    await act(() => {
      render(<Widget {...widgetProps} />);
    });

    expect(screen.getByTestId("state-empty")).toBeInTheDocument();
    expect(screen.getByTestId("login-error-alert")).toBeInTheDocument();
    expect(screen.getByText("Auth server unreachable")).toBeInTheDocument();
  });

  it("lastLoginError: shows error alert and retry button in normal state", async () => {
    const acct = makeAccount();
    const snap = makeSnapshot({
      accounts: [acct],
      activeAccountId: "acct-1",
      lastLoginError: { at: Date.now(), message: "Token expired" },
    });
    const ctx = makeContext(snap);
    const Widget = createAccountsWidget(ctx);

    await act(() => {
      render(<Widget {...widgetProps} />);
    });

    expect(screen.getByTestId("state-normal")).toBeInTheDocument();
    expect(screen.getByTestId("login-error-alert")).toBeInTheDocument();
    expect(screen.getByText("Token expired")).toBeInTheDocument();
    expect(screen.getByTestId("retry-btn")).toBeInTheDocument();
  });

  it("retry button calls add to re-attempt login", async () => {
    const acct = makeAccount();
    const snap = makeSnapshot({
      accounts: [acct],
      activeAccountId: "acct-1",
      lastLoginError: { at: Date.now(), message: "Network error" },
    });
    const ctx = makeContext(snap);
    const Widget = createAccountsWidget(ctx);

    await act(() => {
      render(<Widget {...widgetProps} />);
    });

    await act(() => {
      fireEvent.click(screen.getByTestId("retry-btn"));
    });

    await waitFor(() => {
      expect(ctx.accounts.add).toHaveBeenCalledWith("codex");
    });
  });

  it("账号行为窄卡片准备了折行收纳（flex-wrap + email truncate）", async () => {
    const acct1 = makeAccount({
      id: "acct-1",
      email: "a@example.com",
      planType: "pro",
    });
    const acct2 = makeAccount({ id: "acct-2", email: "b@example.com" });
    const usage1 = makeUsage({ accountId: "acct-1" });
    const snap = makeSnapshot({
      accounts: [acct1, acct2],
      activeAccountId: "acct-1",
      usage: { "acct-1": usage1 },
    });
    const ctx = makeContext(snap);
    const Widget = createAccountsWidget(ctx);

    await act(() => {
      render(<Widget {...widgetProps} />);
    });

    const row = screen.getByTestId("account-row-acct-1");
    const headerRow = row.firstElementChild as HTMLElement;
    expect(headerRow.className).toContain("flex-wrap");
    const email = screen.getByText("a@example.com");
    expect(email.className).toContain("truncate");
  });

  it("auto-adopt 后正常态展示账号", async () => {
    const acct = makeAccount({
      email: "auto-adopted@example.com",
      planType: "pro",
    });
    const snap = makeSnapshot({
      accounts: [acct],
      activeAccountId: "acct-1",
    });
    const ctx = makeContext(snap);
    const Widget = createAccountsWidget(ctx);

    await act(() => {
      render(<Widget {...widgetProps} />);
    });

    expect(screen.getByTestId("state-normal")).toBeInTheDocument();
    expect(screen.getByText("auto-adopted@example.com")).toBeInTheDocument();
    expect(screen.getByText("pro")).toBeInTheDocument();
  });
});
