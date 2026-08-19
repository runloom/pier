import {
  DEFAULT_LSP_POLICY_PREFS,
  type LspPolicyPrefs,
} from "@shared/contracts/lsp.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  detachLspPreferencesListener,
  initLspPreferences,
  useLspPreferencesStore,
} from "@/stores/lsp-preferences.store.ts";

type PreferencesChangedCallback = (next: { lsp: LspPolicyPrefs }) => void;

function snapshot(lsp: LspPolicyPrefs): { lsp: LspPolicyPrefs } {
  return { lsp };
}

describe("useLspPreferencesStore", () => {
  let changedCallback: PreferencesChangedCallback | null;
  const detachMock = vi.fn();
  const readMock = vi.fn();
  const updateMock = vi.fn();

  beforeEach(() => {
    changedCallback = null;
    detachLspPreferencesListener();
    detachMock.mockReset();
    readMock.mockReset();
    updateMock.mockReset();
    useLspPreferencesStore.getState()._hydrate(DEFAULT_LSP_POLICY_PREFS);
    vi.stubGlobal("window", {
      ...window,
      pier: {
        preferences: {
          onChanged: (callback: PreferencesChangedCallback) => {
            changedCallback = callback;
            return detachMock;
          },
          read: readMock,
          update: updateMock,
        },
      },
    });
  });

  afterEach(() => {
    detachLspPreferencesListener();
    vi.unstubAllGlobals();
  });

  it("hydrates the full LSP policy from preferences", async () => {
    const policy = {
      customServers: [],
      enabled: false,
      idleReleaseMs: 900_000,
      maxLocalWorkspaces: 6,
      maxRemoteWorkspaces: 4,
      memoryBudgetMb: 4096,
      worktreesEnabled: true,
    };
    readMock.mockResolvedValue(snapshot(policy));

    await initLspPreferences();

    expect(useLspPreferencesStore.getState()).toMatchObject(policy);
    expect(changedCallback).not.toBeNull();
  });

  it("preserves resource limits when toggling the global switch", async () => {
    const policy = {
      customServers: [],
      enabled: true,
      idleReleaseMs: 900_000,
      maxLocalWorkspaces: 6,
      maxRemoteWorkspaces: 4,
      memoryBudgetMb: 4096,
      worktreesEnabled: true,
    };
    useLspPreferencesStore.getState()._hydrate(policy);
    updateMock.mockResolvedValue(snapshot({ ...policy, enabled: false }));

    await useLspPreferencesStore.getState().setEnabled(false);

    expect(updateMock).toHaveBeenCalledWith({
      lsp: { ...policy, enabled: false },
    });
    expect(useLspPreferencesStore.getState()).toMatchObject({
      ...policy,
      enabled: false,
    });
  });

  it("persists workspace limits with the complete policy", async () => {
    const next = {
      ...DEFAULT_LSP_POLICY_PREFS,
      maxLocalWorkspaces: 7,
    };
    updateMock.mockResolvedValue(snapshot(next));

    await useLspPreferencesStore.getState().setMaxLocalWorkspaces(7);

    expect(updateMock).toHaveBeenCalledWith({ lsp: next });
    expect(useLspPreferencesStore.getState().maxLocalWorkspaces).toBe(7);
  });

  it("persists custom language servers with the complete policy", async () => {
    const customServers = [
      {
        args: ["--stdio"],
        command: "solargraph",
        displayName: "Ruby",
        extensions: [".rb"],
        highlightPreset: "text" as const,
        id: "ruby",
        languageIds: ["ruby"],
        priority: 50,
        rootMarkers: ["Gemfile"],
      },
    ];
    const next = {
      ...DEFAULT_LSP_POLICY_PREFS,
      customServers,
    };
    updateMock.mockResolvedValue(snapshot(next));

    await useLspPreferencesStore.getState().setCustomServers(customServers);

    expect(updateMock).toHaveBeenCalledWith({ lsp: next });
    expect(useLspPreferencesStore.getState().customServers).toEqual(
      customServers
    );
  });

  it("optimistically persists the idle release timeout with the complete policy", async () => {
    const next = {
      ...DEFAULT_LSP_POLICY_PREFS,
      idleReleaseMs: 2_700_000,
    };
    let resolveUpdate:
      | ((snapshot: { lsp: LspPolicyPrefs }) => void)
      | undefined;
    updateMock.mockReturnValue(
      new Promise<{ lsp: LspPolicyPrefs }>((resolve) => {
        resolveUpdate = resolve;
      })
    );

    const pending = useLspPreferencesStore
      .getState()
      .setIdleReleaseMs(2_700_000);

    expect(useLspPreferencesStore.getState().idleReleaseMs).toBe(2_700_000);
    expect(updateMock).toHaveBeenCalledWith({ lsp: next });

    resolveUpdate?.(snapshot(next));
    await pending;
    expect(useLspPreferencesStore.getState().idleReleaseMs).toBe(2_700_000);
  });

  it("reverts the idle release timeout when persistence fails", async () => {
    updateMock.mockRejectedValue(new Error("disk unavailable"));

    await expect(
      useLspPreferencesStore.getState().setIdleReleaseMs(2_700_000)
    ).rejects.toThrow("disk unavailable");

    expect(useLspPreferencesStore.getState().idleReleaseMs).toBe(
      DEFAULT_LSP_POLICY_PREFS.idleReleaseMs
    );
  });

  it("reverts an optimistic toggle when persistence fails", async () => {
    updateMock.mockRejectedValue(new Error("disk unavailable"));

    await expect(
      useLspPreferencesStore.getState().setWorktreesEnabled(false)
    ).rejects.toThrow("disk unavailable");

    expect(useLspPreferencesStore.getState().worktreesEnabled).toBe(true);
  });

  it("hydrates policy broadcasts", async () => {
    readMock.mockResolvedValue(snapshot(DEFAULT_LSP_POLICY_PREFS));
    await initLspPreferences();
    const next = {
      ...DEFAULT_LSP_POLICY_PREFS,
      maxLocalWorkspaces: 8,
      worktreesEnabled: true,
    };

    changedCallback?.(snapshot(next));
    expect(useLspPreferencesStore.getState()).toMatchObject(next);
  });
});
