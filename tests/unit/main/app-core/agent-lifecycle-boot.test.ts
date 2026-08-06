import type { PreferencesService } from "@main/services/preferences-service.ts";
import type { ProjectPreferences } from "@shared/contracts/preferences.ts";
import { projectPreferencesSchema } from "@shared/contracts/preferences.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const uninstallHook = vi.fn(async () => undefined);
const detectHook = vi.fn(() => false);

interface LifecycleOptions {
  afterUninstall?: (agentId: string) => Promise<void>;
  getLifecycleCommands?: () => Promise<{
    install: Record<string, string>;
    uninstall: Record<string, string>;
    update: Record<string, string>;
  }>;
}

const captured: { options: LifecycleOptions | null } = { options: null };

vi.mock("@main/services/agents/lifecycle/service.ts", () => ({
  createAgentLifecycleService: (options: LifecycleOptions) => {
    captured.options = options;
    return { run: vi.fn(), probe: vi.fn() };
  },
}));

vi.mock("@main/services/agents/integrations/registry.ts", () => ({
  getAgentHookIntegration: (agentId: string) =>
    agentId === "gemini"
      ? {
          id: "gemini",
          detect: detectHook,
          install: vi.fn(),
          uninstall: uninstallHook,
        }
      : undefined,
}));

vi.mock("@main/app-core/window-broadcasts.ts", () => ({
  broadcastAgentLifecycleProgress: vi.fn(),
}));

function prefs(
  overrides: Partial<ProjectPreferences> = {}
): ProjectPreferences {
  return projectPreferencesSchema.parse(overrides);
}

describe("createBootedAgentLifecycleService", () => {
  beforeEach(() => {
    captured.options = null;
    uninstallHook.mockClear();
    detectHook.mockClear();
    vi.resetModules();
  });

  async function bootWith(preferences: PreferencesService) {
    const { createBootedAgentLifecycleService } = await import(
      "@main/app-core/agent-lifecycle-boot.ts"
    );
    createBootedAgentLifecycleService({
      waitForHostEnv: async () => undefined,
      getEnv: async () => ({}),
      preferences,
      refreshDetection: async () => undefined,
    });
    if (!captured.options) {
      throw new Error("createAgentLifecycleService was not called");
    }
    return captured.options;
  }

  it("wires uninstall L2 commands from preferences", async () => {
    const preferences: PreferencesService = {
      read: vi.fn(async () =>
        prefs({
          agentUninstallCommands: { claude: "echo uninstall-claude" },
          agentInstallCommands: { claude: "echo install" },
          agentUpdateCommands: { claude: "echo update" },
        })
      ),
      update: vi.fn(async (patch) => prefs(patch)),
    };
    const options = await bootWith(preferences);
    const cmds = await options.getLifecycleCommands?.();
    expect(cmds).toEqual({
      install: { claude: "echo install" },
      update: { claude: "echo update" },
      uninstall: { claude: "echo uninstall-claude" },
    });
  });

  it("afterUninstall uninstalls hooks without detect gate and clears disabled/default", async () => {
    const update = vi.fn(async (patch: Partial<ProjectPreferences>) =>
      prefs(patch)
    );
    const preferences: PreferencesService = {
      read: vi.fn(async () =>
        prefs({
          disabledAgentIds: ["gemini", "claude"],
          defaultAgentId: "gemini",
        })
      ),
      update,
    };
    const options = await bootWith(preferences);
    await options.afterUninstall?.("gemini");

    expect(detectHook).not.toHaveBeenCalled();
    expect(uninstallHook).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      disabledAgentIds: ["claude"],
      defaultAgentId: null,
    });
  });

  it("afterUninstall skips prefs update when agent not in disabled/default", async () => {
    const update = vi.fn(async (patch: Partial<ProjectPreferences>) =>
      prefs(patch)
    );
    const preferences: PreferencesService = {
      read: vi.fn(async () =>
        prefs({
          disabledAgentIds: ["claude"],
          defaultAgentId: "claude",
        })
      ),
      update,
    };
    const options = await bootWith(preferences);
    await options.afterUninstall?.("gemini");

    expect(uninstallHook).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });

  it("afterUninstall preserves agent*Commands (does not clear overrides)", async () => {
    const update = vi.fn(async (patch: Partial<ProjectPreferences>) =>
      prefs(patch)
    );
    const preferences: PreferencesService = {
      read: vi.fn(async () =>
        prefs({
          disabledAgentIds: ["gemini"],
          defaultAgentId: "gemini",
          agentUninstallCommands: { gemini: "echo u" },
          agentInstallCommands: { gemini: "echo i" },
        })
      ),
      update,
    };
    const options = await bootWith(preferences);
    await options.afterUninstall?.("gemini");

    expect(update).toHaveBeenCalledTimes(1);
    const patch = update.mock.calls[0]?.[0] ?? {};
    expect(patch).not.toHaveProperty("agentUninstallCommands");
    expect(patch).not.toHaveProperty("agentInstallCommands");
    expect(patch).not.toHaveProperty("agentUpdateCommands");
  });
});
