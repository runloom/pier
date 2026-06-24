import { createPierEventBus } from "@main/app-core/event-bus.ts";
import { createCommandPaletteMruService } from "@main/services/command-palette-service.ts";
import { createPreferencesService } from "@main/services/preferences-service.ts";
import { EMPTY_MRU_STATE } from "@shared/contracts/command-palette-mru.ts";
import type { ProjectPreferences } from "@shared/contracts/preferences.ts";
import { describe, expect, it } from "vitest";

const basePreferences: ProjectPreferences = {
  language: "zh-CN",
  monoFontFamily: "",
  monoFontSize: 13,
  stylePresetId: "pierre",
  theme: "system",
  uiFontFamily: "",
};

describe("createPreferencesService", () => {
  it("更新偏好后发布 preferences.changed 事件", async () => {
    const bus = createPierEventBus();
    const seen: ProjectPreferences[] = [];
    bus.subscribe((event) => {
      if (event.type === "preferences.changed") {
        seen.push(event.snapshot);
      }
    });

    const service = createPreferencesService({
      eventBus: bus,
      readPreferences: async () => basePreferences,
      updatePreferences: async (patch) => ({ ...basePreferences, ...patch }),
    });

    await expect(service.update({ theme: "dark" })).resolves.toMatchObject({
      theme: "dark",
    });
    expect(seen).toEqual([{ ...basePreferences, theme: "dark" }]);
  });
});

describe("createCommandPaletteMruService", () => {
  it("recordUse 落盘成功后更新 memo 并广播", async () => {
    const writes: unknown[] = [];
    const broadcasts: unknown[] = [];
    const service = createCommandPaletteMruService({
      broadcast: (state) => broadcasts.push(state),
      now: () => 1000,
      readMruState: async () => EMPTY_MRU_STATE,
      writeMruState: (state) => {
        writes.push(state);
        return Promise.resolve();
      },
    });

    await service.recordUse("pier.test");

    const expected = {
      entries: [{ actionId: "pier.test", lastUsedAt: 1000, useCount: 1 }],
      version: 1,
    };
    await expect(service.read()).resolves.toEqual(expected);
    expect(writes).toEqual([expected]);
    expect(broadcasts).toEqual([expected]);
  });

  it("拒绝异常 actionId 且不落盘", async () => {
    const writes: unknown[] = [];
    const service = createCommandPaletteMruService({
      broadcast: () => undefined,
      now: () => 1000,
      readMruState: async () => EMPTY_MRU_STATE,
      writeMruState: (state) => {
        writes.push(state);
        return Promise.resolve();
      },
    });

    await service.recordUse("");
    await service.recordUse("x".repeat(129));

    expect(writes).toEqual([]);
  });
});
