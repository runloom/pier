import { createPreferencesService } from "@main/services/preferences-service.ts";
import {
  type AgentAttentionSettings,
  DEFAULT_AGENT_ATTENTION_SETTINGS,
} from "@shared/contracts/agent-attention.ts";
import type { ProjectPreferences } from "@shared/contracts/preferences.ts";
import { projectPreferencesSchema } from "@shared/contracts/preferences.ts";
import { describe, expect, it, vi } from "vitest";

function basePreferences(
  overrides: Partial<ProjectPreferences> = {}
): ProjectPreferences {
  return projectPreferencesSchema.parse(overrides);
}

describe("preferences-service agentAttention whitelist", () => {
  it("persists agentAttention and includes it in changedKeys", async () => {
    const nextAttention: AgentAttentionSettings = {
      enabled: false,
      enableErrorAttention: false,
      suppressWhenFocused: true,
      cooldownMs: 60_000,
      soundEnabled: true,
      soundId: "system",
      turnNotifyMode: "unfocused",
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

    const merged = await service.update({ agentAttention: nextAttention });

    expect(updatePreferences).toHaveBeenCalledWith({
      agentAttention: nextAttention,
    });
    expect(merged.agentAttention).toEqual(nextAttention);
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        changedKeys: ["agentAttention"],
        type: "preferences.changed",
      })
    );
  });

  it("defaults agentAttention when preferences parse empty object", () => {
    expect(basePreferences({}).agentAttention).toEqual(
      DEFAULT_AGENT_ATTENTION_SETTINGS
    );
  });
});
