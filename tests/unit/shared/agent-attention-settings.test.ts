import {
  agentAttentionSettingsSchema,
  DEFAULT_AGENT_ATTENTION_SETTINGS,
} from "@shared/contracts/agent-attention.ts";
import { projectPreferencesSchema } from "@shared/contracts/preferences.ts";
import { describe, expect, it } from "vitest";

describe("agentAttention settings", () => {
  it("defaults match product defaults", () => {
    expect(DEFAULT_AGENT_ATTENTION_SETTINGS).toEqual({
      enabled: true,
      enableErrorAttention: false,
      suppressWhenFocused: true,
      cooldownMs: 180_000,
    });
  });

  it("accepts the three product cooldown presets", () => {
    for (const cooldownMs of [60_000, 180_000, 600_000] as const) {
      expect(
        agentAttentionSettingsSchema.safeParse({
          ...DEFAULT_AGENT_ATTENTION_SETTINGS,
          cooldownMs,
        }).success
      ).toBe(true);
    }
  });

  it("rejects unknown cooldownMs", () => {
    expect(
      agentAttentionSettingsSchema.safeParse({
        ...DEFAULT_AGENT_ATTENTION_SETTINGS,
        cooldownMs: 123,
      }).success
    ).toBe(false);
  });

  it("preferences parse fills agentAttention default", () => {
    const parsed = projectPreferencesSchema.parse({});
    expect(parsed.agentAttention).toEqual(DEFAULT_AGENT_ATTENTION_SETTINGS);
  });

  it("preferences reject invalid nested agentAttention", () => {
    expect(
      projectPreferencesSchema.safeParse({
        agentAttention: {
          ...DEFAULT_AGENT_ATTENTION_SETTINGS,
          cooldownMs: 999,
        },
      }).success
    ).toBe(false);
  });
});
