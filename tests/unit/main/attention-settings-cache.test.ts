import { createPierEventBus } from "@main/app-core/event-bus.ts";
import {
  getAgentAttentionSettingsCached,
  initAgentAttentionSettingsCache,
  setAgentAttentionSettingsCacheForTests,
} from "@main/services/agent-attention/settings-cache.ts";
import {
  type AgentAttentionSettings,
  DEFAULT_AGENT_ATTENTION_SETTINGS,
} from "@shared/contracts/agent-attention.ts";
import {
  type ProjectPreferences,
  projectPreferencesSchema,
} from "@shared/contracts/preferences.ts";
import { beforeEach, describe, expect, it } from "vitest";

function attention(
  overrides: Partial<AgentAttentionSettings> = {}
): AgentAttentionSettings {
  return { ...DEFAULT_AGENT_ATTENTION_SETTINGS, ...overrides };
}

function prefsSnapshot(
  agentAttention: AgentAttentionSettings
): ProjectPreferences {
  return {
    ...projectPreferencesSchema.parse({}),
    agentAttention,
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("agent attention settings cache", () => {
  beforeEach(() => {
    setAgentAttentionSettingsCacheForTests(null);
  });

  it("forces all three event gates off before boot read completes", () => {
    setAgentAttentionSettingsCacheForTests(
      attention({
        enabled: true,
        enableErrorAttention: true,
        turnNotifyMode: "always",
      }),
      { ready: false }
    );

    const snapshot = getAgentAttentionSettingsCached();
    expect(snapshot.enabled).toBe(false);
    expect(snapshot.enableErrorAttention).toBe(false);
    expect(snapshot.turnNotifyMode).toBe("off");
  });

  it("serves disk settings after boot read resolves", async () => {
    const disk = attention({ turnNotifyMode: "always", cooldownMs: 60_000 });
    initAgentAttentionSettingsCache({
      readPreferences: () => Promise.resolve({ agentAttention: disk }),
    });
    await flushMicrotasks();

    expect(getAgentAttentionSettingsCached()).toEqual(disk);
  });

  it("does not let a late boot read overwrite a newer preferences.changed snapshot", async () => {
    const eventBus = createPierEventBus();
    const stale = attention({ turnNotifyMode: "always" });
    let resolveBoot: (prefs: {
      agentAttention: AgentAttentionSettings;
    }) => void = () => undefined;
    initAgentAttentionSettingsCache({
      eventBus,
      readPreferences: () =>
        new Promise((resolve) => {
          resolveBoot = resolve;
        }),
    });

    const fresh = attention({ turnNotifyMode: "off", enabled: false });
    eventBus.publish({
      changedKeys: ["agentAttention"],
      snapshot: prefsSnapshot(fresh),
      type: "preferences.changed",
    });
    expect(getAgentAttentionSettingsCached()).toEqual(fresh);

    resolveBoot({ agentAttention: stale });
    await flushMicrotasks();
    expect(getAgentAttentionSettingsCached()).toEqual(fresh);
  });

  it("falls back to defaults when boot read fails", async () => {
    let bootError: unknown = null;
    initAgentAttentionSettingsCache({
      onBootReadError: (err) => {
        bootError = err;
      },
      readPreferences: () => Promise.reject(new Error("disk gone")),
    });
    await flushMicrotasks();

    expect(bootError).toBeInstanceOf(Error);
    expect(getAgentAttentionSettingsCached()).toEqual(
      DEFAULT_AGENT_ATTENTION_SETTINGS
    );
  });
});
