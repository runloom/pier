import { createPreferencesService } from "@main/services/preferences-service.ts";
import type { ProjectPreferences } from "@shared/contracts/preferences.ts";
import { projectPreferencesSchema } from "@shared/contracts/preferences.ts";
import { describe, expect, it, vi } from "vitest";

function basePreferences(
  overrides: Partial<ProjectPreferences> = {}
): ProjectPreferences {
  return projectPreferencesSchema.parse(overrides);
}

describe("preferences-service agentUninstallCommands whitelist", () => {
  it("defaults agentUninstallCommands to empty object", () => {
    expect(basePreferences({}).agentUninstallCommands).toEqual({});
  });

  it("persists agentUninstallCommands and includes it in changedKeys", async () => {
    const nextCommands = {
      claude: "npm uninstall -g @anthropic-ai/claude-code",
    };
    const current = basePreferences();
    const updatePreferences = vi.fn(
      async (patch: Partial<ProjectPreferences>) =>
        basePreferences({ ...current, ...patch })
    );
    const publish = vi.fn();
    const service = createPreferencesService({
      eventBus: { publish },
      readPreferences: async () => current,
      updatePreferences,
    });

    const merged = await service.update({
      agentUninstallCommands: nextCommands,
    });

    expect(updatePreferences).toHaveBeenCalledWith({
      agentUninstallCommands: nextCommands,
    });
    expect(merged.agentUninstallCommands).toEqual(nextCommands);
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        changedKeys: ["agentUninstallCommands"],
        type: "preferences.changed",
      })
    );
  });

  it("does not strip agentUninstallCommands when other keys are undefined", async () => {
    const current = basePreferences({
      agentUninstallCommands: { gemini: "npm uninstall -g @google/gemini-cli" },
    });
    const updatePreferences = vi.fn(
      async (patch: Partial<ProjectPreferences>) =>
        basePreferences({ ...current, ...patch })
    );
    const service = createPreferencesService({
      readPreferences: async () => current,
      updatePreferences,
    });

    // Runtime may still pass explicit undefined; stripUndefinedPatch drops it.
    // exactOptionalPropertyTypes forbids `key?: T` accepting undefined in the type.
    await service.update({
      agentUninstallCommands: { gemini: "echo custom-uninstall" },
      agentInstallCommands: undefined,
    } as unknown as Partial<ProjectPreferences>);

    expect(updatePreferences).toHaveBeenCalledWith({
      agentUninstallCommands: { gemini: "echo custom-uninstall" },
    });
    expect(updatePreferences.mock.calls[0]?.[0]).not.toHaveProperty(
      "agentInstallCommands"
    );
  });
});
