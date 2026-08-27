import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  isNoActiveAccountError,
  NoActiveAccountError,
  normalizeAccountId,
  refreshAccountUsage,
  refreshAllAccountUsage,
  useAccountsRefresh,
} from "../../../../packages/plugin-api/src/account-usage/renderer.ts";
import type { ExternalRendererPluginContext } from "../../../../packages/plugin-api/src/renderer.ts";

function mockContext(options?: {
  activeAccountId?: string | null;
  refreshError?: Error;
  refreshAllHang?: boolean;
}): {
  context: ExternalRendererPluginContext;
  invokeCalls: Array<{ method: string; payload: unknown }>;
  resolveRefreshAll: () => void;
} {
  const invokeCalls: Array<{ method: string; payload: unknown }> = [];
  const activeAccountId =
    options && "activeAccountId" in options ? options.activeAccountId : "acc-1";
  let resolveRefreshAll: () => void = () => undefined;
  const refreshAllPending = options?.refreshAllHang
    ? new Promise<void>((resolve) => {
        resolveRefreshAll = resolve;
      })
    : Promise.resolve();
  const context = {
    dialogs: {
      alert: vi.fn(async () => undefined),
    },
    i18n: {
      t: (_key: string, fallback: string) => fallback,
    },
    notifications: {
      success: vi.fn(),
    },
    rpc: {
      invoke: vi.fn(async (method: string, payload?: unknown) => {
        invokeCalls.push({ method, payload });
        if (method === "accounts.snapshot") {
          return { activeAccountId };
        }
        if (method === "accounts.refreshAllUsage") {
          await refreshAllPending;
          if (options?.refreshError) throw options.refreshError;
          return null;
        }
        if (method === "accounts.refreshUsage" && options?.refreshError) {
          throw options.refreshError;
        }
        return null;
      }),
    },
  } as unknown as ExternalRendererPluginContext;
  return { context, invokeCalls, resolveRefreshAll };
}

describe("normalizeAccountId", () => {
  it("treats blank and whitespace as missing", () => {
    expect(normalizeAccountId(undefined)).toBeUndefined();
    expect(normalizeAccountId("")).toBeUndefined();
    expect(normalizeAccountId("   ")).toBeUndefined();
    expect(normalizeAccountId("acc-1")).toBe("acc-1");
    expect(normalizeAccountId("  acc-1  ")).toBe("acc-1");
  });
});

describe("refreshAccountUsage (shared manual refresh)", () => {
  it("always sends force: true for a targeted account", async () => {
    const { context, invokeCalls } = mockContext();
    await refreshAccountUsage(context, { accountId: "acc-2" });
    expect(invokeCalls).toEqual([
      {
        method: "accounts.refreshUsage",
        payload: { accountId: "acc-2", force: true },
      },
    ]);
  });

  it("refreshes the active account with force: true when accountId is omitted", async () => {
    const { context, invokeCalls } = mockContext();
    await refreshAccountUsage(context);
    expect(invokeCalls).toEqual([
      {
        method: "accounts.refreshUsage",
        payload: { force: true },
      },
    ]);
  });

  it("treats blank accountId like omit (and still force: true)", async () => {
    const { context, invokeCalls } = mockContext();
    await refreshAccountUsage(context, { accountId: "  " });
    expect(invokeCalls).toEqual([
      {
        method: "accounts.refreshUsage",
        payload: { force: true },
      },
    ]);
  });

  it("requires an active account before refreshing when requireActiveAccount", async () => {
    const { context, invokeCalls } = mockContext({ activeAccountId: null });
    await expect(
      refreshAccountUsage(context, { requireActiveAccount: true })
    ).rejects.toBeInstanceOf(NoActiveAccountError);
    expect(invokeCalls).toEqual([
      { method: "accounts.snapshot", payload: null },
    ]);
  });

  it("blank accountId with requireActiveAccount still runs the guard", async () => {
    const { context, invokeCalls } = mockContext({ activeAccountId: null });
    await expect(
      refreshAccountUsage(context, {
        accountId: "",
        requireActiveAccount: true,
      })
    ).rejects.toBeInstanceOf(NoActiveAccountError);
    expect(invokeCalls).toEqual([
      { method: "accounts.snapshot", payload: null },
    ]);
  });

  it("skips snapshot when requireActiveAccount and a real accountId are both set", async () => {
    const { context, invokeCalls } = mockContext({ activeAccountId: null });
    await refreshAccountUsage(context, {
      accountId: "acc-2",
      requireActiveAccount: true,
    });
    expect(invokeCalls).toEqual([
      {
        method: "accounts.refreshUsage",
        payload: { accountId: "acc-2", force: true },
      },
    ]);
  });

  it("refreshes after active-account guard succeeds", async () => {
    const { context, invokeCalls } = mockContext({ activeAccountId: "acc-1" });
    await refreshAccountUsage(context, { requireActiveAccount: true });
    expect(invokeCalls).toEqual([
      { method: "accounts.snapshot", payload: null },
      { method: "accounts.refreshUsage", payload: { force: true } },
    ]);
  });

  it("refreshAllAccountUsage invokes accounts.refreshAllUsage", async () => {
    const { context, invokeCalls } = mockContext();
    await refreshAllAccountUsage(context);
    expect(invokeCalls).toEqual([
      { method: "accounts.refreshAllUsage", payload: null },
    ]);
  });

  it("isNoActiveAccountError recognizes typed, duck-typed, and rejects others", () => {
    expect(isNoActiveAccountError(new NoActiveAccountError())).toBe(true);
    expect(isNoActiveAccountError({ code: "no-active-account" })).toBe(true);
    const coded = new Error("lost prototype");
    (coded as Error & { code: string }).code = "no-active-account";
    expect(isNoActiveAccountError(coded)).toBe(true);
    expect(isNoActiveAccountError(new Error("nope"))).toBe(false);
    expect(isNoActiveAccountError({ code: "other" })).toBe(false);
    expect(isNoActiveAccountError(null)).toBe(false);
    expect(isNoActiveAccountError(undefined)).toBe(false);
  });
});

describe("useAccountsRefresh", () => {
  const i18n = {
    refreshAllSuccess: { fallback: "All refreshed", key: "all" },
    refreshSuccess: { fallback: "Usage refreshed", key: "one" },
  };

  it("single refresh sends force:true payload and toasts", async () => {
    const { context, invokeCalls } = mockContext();
    const onAccountError = vi.fn();
    const { result } = renderHook(() =>
      useAccountsRefresh({
        context,
        i18n,
        onAccountError,
        t: (_k, fallback) => fallback,
      })
    );

    await act(async () => {
      result.current.refreshUsage("acc-2");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(invokeCalls).toContainEqual({
      method: "accounts.refreshUsage",
      payload: { accountId: "acc-2", force: true },
    });
    expect(context.notifications.success).toHaveBeenCalledWith(
      "Usage refreshed"
    );
    expect(onAccountError).not.toHaveBeenCalled();
  });

  it("ignores single refresh while refresh-all is in flight", async () => {
    const { context, invokeCalls } = mockContext({ refreshAllHang: true });
    const onAccountError = vi.fn();
    const { result } = renderHook(() =>
      useAccountsRefresh({
        context,
        i18n,
        onAccountError,
        t: (_k, fallback) => fallback,
      })
    );

    act(() => {
      result.current.refreshAllUsage(["acc-1", "acc-2"]);
    });
    expect(result.current.refreshingAll).toBe(true);

    act(() => {
      result.current.refreshUsage("acc-1");
    });

    // Only refresh-all should have been invoked so far.
    expect(
      invokeCalls.filter((c) => c.method === "accounts.refreshUsage")
    ).toHaveLength(0);
    expect(
      invokeCalls.filter((c) => c.method === "accounts.refreshAllUsage")
    ).toHaveLength(1);
  });
});

describe("account plugin renderer refresh governance", () => {
  it("settings pages use the shared refresh primitives (no inline RPC)", () => {
    const plugins = ["codex", "grok", "claude"] as const;
    for (const id of plugins) {
      const settingsPage = readFileSync(
        join(
          process.cwd(),
          `packages/plugin-${id}/src/renderer/accounts-settings-page.tsx`
        ),
        "utf8"
      );
      expect(settingsPage).not.toMatch(
        /rpc\.invoke\(\s*["']accounts\.refreshUsage["']/
      );
      expect(settingsPage).toContain("useAccountsRefresh");

      const settingsHook = readFileSync(
        join(
          process.cwd(),
          `packages/plugin-${id}/src/renderer/use-accounts-refresh.ts`
        ),
        "utf8"
      );
      expect(settingsHook).toContain("@pier/plugin-api/account-usage/renderer");
      expect(settingsHook).toContain("useAccountsRefresh");
    }

    const sharedHook = readFileSync(
      join(
        process.cwd(),
        "packages/plugin-api/src/account-usage/use-accounts-refresh.ts"
      ),
      "utf8"
    );
    expect(sharedHook).toContain("refreshAccountUsage");
    expect(sharedHook).toContain("refreshAllAccountUsage");
    expect(sharedHook).not.toMatch(
      /rpc\.invoke\(\s*["']accounts\.refreshUsage["']/
    );

    // Pure RPC owns the only client-side refreshUsage invoke.
    const pure = readFileSync(
      join(process.cwd(), "packages/plugin-api/src/account-usage/refresh.ts"),
      "utf8"
    );
    expect(pure).toContain('invoke("accounts.refreshUsage"');
    expect(pure).toContain("force: true");
  });
});
