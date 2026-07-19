import {
  agentAttentionSettingsSchema,
  DEFAULT_AGENT_ATTENTION_SETTINGS,
} from "@shared/contracts/agent-attention.ts";
import { projectPreferencesSchema } from "@shared/contracts/preferences.ts";
import { describe, expect, it } from "vitest";

describe("agentAttention settings", () => {
  it("defaults include soundEnabled true, soundId system, and turnNotifyMode unfocused", () => {
    expect(DEFAULT_AGENT_ATTENTION_SETTINGS).toEqual({
      enabled: true,
      enableErrorAttention: false,
      suppressWhenFocused: true,
      cooldownMs: 180_000,
      soundEnabled: true,
      soundId: "system",
      turnNotifyMode: "unfocused",
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

  it("parses legacy four-field agentAttention without wiping", () => {
    const parsed = agentAttentionSettingsSchema.parse({
      enabled: false,
      enableErrorAttention: true,
      suppressWhenFocused: false,
      cooldownMs: 60_000,
    });
    expect(parsed).toEqual({
      enabled: false,
      enableErrorAttention: true,
      suppressWhenFocused: false,
      cooldownMs: 60_000,
      soundEnabled: true,
      soundId: "system",
      turnNotifyMode: "unfocused",
    });
  });

  it("parse legacy agentAttention missing turnNotifyMode → unfocused", () => {
    const parsed = agentAttentionSettingsSchema.parse({
      enabled: true,
      enableErrorAttention: false,
      suppressWhenFocused: true,
      cooldownMs: 180_000,
      soundEnabled: true,
      soundId: "system",
    });
    expect(parsed.turnNotifyMode).toBe("unfocused");
  });

  it("preferences parse keeps sibling keys when agentAttention is legacy", () => {
    const parsed = projectPreferencesSchema.parse({
      agentStatusHooks: false,
      agentAttention: {
        enabled: true,
        enableErrorAttention: false,
        suppressWhenFocused: true,
        cooldownMs: 180_000,
      },
    });
    expect(parsed.agentStatusHooks).toBe(false);
    expect(parsed.agentAttention.soundEnabled).toBe(true);
    expect(parsed.agentAttention.soundId).toBe("system");
    expect(parsed.agentAttention.turnNotifyMode).toBe("unfocused");
  });

  it("preferences parse keeps sibling keys when agentAttention lacks turnNotifyMode", () => {
    const parsed = projectPreferencesSchema.parse({
      agentStatusHooks: false,
      agentAttention: {
        enabled: true,
        enableErrorAttention: false,
        suppressWhenFocused: true,
        cooldownMs: 180_000,
        soundEnabled: false,
        soundId: "rooster",
      },
    });
    expect(parsed.agentStatusHooks).toBe(false);
    expect(parsed.agentAttention.soundEnabled).toBe(false);
    expect(parsed.agentAttention.soundId).toBe("rooster");
    expect(parsed.agentAttention.turnNotifyMode).toBe("unfocused");
  });

  it("falls back legacy soundId to system without wiping the rest", () => {
    // 旧目录 id（soft/clear/bright/bell）：回落 system，其余键原样保留。
    const parsed = projectPreferencesSchema.parse({
      agentStatusHooks: false,
      agentAttention: {
        ...DEFAULT_AGENT_ATTENTION_SETTINGS,
        soundEnabled: false,
        soundId: "bell",
      },
    });
    expect(parsed.agentAttention.soundId).toBe("system");
    expect(parsed.agentAttention.soundEnabled).toBe(false);
    expect(parsed.agentStatusHooks).toBe(false);
  });

  it("accepts every vibe-kanban builtin soundId", () => {
    for (const soundId of [
      "abstract-sound1",
      "abstract-sound2",
      "abstract-sound3",
      "abstract-sound4",
      "cow-mooing",
      "phone-vibration",
      "rooster",
      "fahhhhh",
    ] as const) {
      const parsed = agentAttentionSettingsSchema.parse({
        ...DEFAULT_AGENT_ATTENTION_SETTINGS,
        soundId,
      });
      expect(parsed.soundId).toBe(soundId);
    }
  });
});
