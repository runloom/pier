import type {
  RendererPluginAction,
  RendererPluginContext,
  RendererPluginQuickPick,
} from "@plugins/api/renderer.ts";
import { registerCodexActions } from "@plugins/builtin/codex/renderer/account-actions.ts";
import type { AgentAccountsSnapshot } from "@shared/contracts/agent-accounts.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

function makeSnapshot(
  overrides: Partial<AgentAccountsSnapshot> = {}
): AgentAccountsSnapshot {
  return {
    accounts: [
      {
        id: "acct-1",
        email: "a@example.com",
        provider: "codex",
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "acct-2",
        email: "b@example.com",
        provider: "codex",
        createdAt: 2,
        updatedAt: 2,
      },
    ],
    activeAccountId: "acct-1",
    lastLoginError: null,
    loginPending: null,
    ts: Date.now(),
    usage: {},
    ...overrides,
  };
}

function makeContext(
  snapshot: AgentAccountsSnapshot,
  overrides: Partial<{
    confirm: boolean;
  }> = {}
) {
  const register = vi.fn(() => vi.fn());
  const openQuickPick = vi.fn();
  const select = vi.fn(() => Promise.resolve());
  const add = vi.fn(() => Promise.resolve());
  const refreshUsage = vi.fn(() => Promise.resolve());
  const errorNotify = vi.fn();
  const loading = vi.fn(() => ({
    dismiss: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  }));

  const context = {
    accounts: {
      add,
      adoptCurrent: vi.fn(),
      cancelLogin: vi.fn(),
      onDidChange: vi.fn(() => vi.fn()),
      refreshUsage,
      remove: vi.fn(),
      select,
      snapshot: () => snapshot,
    },
    actions: { register },
    commandPalette: { openQuickPick },
    configuration: {
      get: vi.fn((key: string) => {
        if (key === "pier.codex.confirmSwitch") {
          return overrides.confirm ?? true;
        }
        return;
      }),
      onDidChange: vi.fn(() => vi.fn()),
    },
    dialogs: {
      alert: vi.fn(),
      confirm: vi.fn(() => Promise.resolve(overrides.confirm ?? true)),
    },
    i18n: {
      commandDescription: vi.fn(),
      commandTitle: vi.fn((_id: string, fallback?: string) => fallback ?? ""),
      language: vi.fn(() => "en"),
      t: vi.fn((key: string, _values?: Record<string, number | string>) => key),
    },
    notifications: {
      error: errorNotify,
      info: vi.fn(),
      loading,
      success: vi.fn(),
    },
  } as unknown as RendererPluginContext;

  return {
    context,
    mocks: {
      register,
      openQuickPick,
      select,
      add,
      refreshUsage,
      errorNotify,
      loading,
    },
  };
}

function getAction(
  mocks: { register: ReturnType<typeof vi.fn> },
  id: string
): RendererPluginAction {
  const match = mocks.register.mock.calls.find(
    (c: unknown[]) => (c[0] as RendererPluginAction).id === id
  );
  if (!match) {
    throw new Error(`action ${id} not registered`);
  }
  return match[0] as RendererPluginAction;
}

describe("registerCodexActions", () => {
  let snapshot: AgentAccountsSnapshot;

  beforeEach(() => {
    snapshot = makeSnapshot();
  });

  it("注册三个 action，且形状满足 RendererPluginAction 契约", () => {
    const { context, mocks } = makeContext(snapshot);
    registerCodexActions(context);

    expect(mocks.register).toHaveBeenCalledTimes(3);

    for (const call of mocks.register.mock.calls as unknown as [
      RendererPluginAction,
    ][]) {
      const action = call[0];
      expect(typeof action.handler).toBe("function");
      expect(typeof action.title).toBe("function");
      expect(action.category).toBe("Codex");
      expect(action.surfaces).toContain("command-palette");
      expect(action.metadata?.categoryKey).toBe("settings");
    }
  });

  it("switchAccount handler 打开 quickPick；onAccept 经 confirm 后调 select", async () => {
    const { context, mocks } = makeContext(snapshot, { confirm: true });
    registerCodexActions(context);

    const switchAction = getAction(mocks, "pier.codex.switchAccount");
    await switchAction.handler();

    expect(mocks.openQuickPick).toHaveBeenCalledTimes(1);
    const quickPick = mocks.openQuickPick.mock
      .calls[0]?.[0] as RendererPluginQuickPick;

    await quickPick.onAccept({ id: "acct-2", label: "b@example.com" });

    expect(mocks.select).toHaveBeenCalledWith("acct-2");
  });

  it("onAccept 选中当前 active 账号时不触发 select", async () => {
    const { context, mocks } = makeContext(snapshot);
    registerCodexActions(context);

    const switchAction = getAction(mocks, "pier.codex.switchAccount");
    await switchAction.handler();

    const quickPick = mocks.openQuickPick.mock
      .calls[0]?.[0] as RendererPluginQuickPick;
    await quickPick.onAccept({ id: "acct-1", label: "a@example.com" });

    expect(mocks.select).not.toHaveBeenCalled();
  });

  it("addAccount handler 调 accounts.add", async () => {
    const { context, mocks } = makeContext(snapshot);
    registerCodexActions(context);

    const addAction = getAction(mocks, "pier.codex.addAccount");
    await addAction.handler();

    expect(mocks.add).toHaveBeenCalledWith("codex");
  });

  it("refreshUsage handler 调 accounts.refreshUsage", async () => {
    const { context, mocks } = makeContext(snapshot);
    registerCodexActions(context);

    const refreshAction = getAction(mocks, "pier.codex.refreshUsage");
    await refreshAction.handler();

    expect(mocks.refreshUsage).toHaveBeenCalledTimes(1);
  });

  it("switchAccount onAccept select 失败时调 notifications.error", async () => {
    const { context, mocks } = makeContext(snapshot, { confirm: true });
    mocks.select.mockRejectedValueOnce(new Error("network failure"));
    registerCodexActions(context);

    const switchAction = getAction(mocks, "pier.codex.switchAccount");
    await switchAction.handler();

    const quickPick = mocks.openQuickPick.mock
      .calls[0]?.[0] as RendererPluginQuickPick;
    await quickPick.onAccept({ id: "acct-2", label: "b@example.com" });

    expect(mocks.errorNotify).toHaveBeenCalled();
  });

  it("addAccount handler 失败时 dismiss loading 并调 notifications.error", async () => {
    const { context, mocks } = makeContext(snapshot);
    mocks.add.mockRejectedValueOnce(new Error("auth failed"));
    registerCodexActions(context);

    const addAction = getAction(mocks, "pier.codex.addAccount");
    await addAction.handler();

    expect(mocks.errorNotify).toHaveBeenCalled();
    const loadingHandle = mocks.loading.mock.results[0]?.value;
    expect(loadingHandle?.dismiss).toHaveBeenCalled();
  });
});
