import { createPierEventBus } from "@main/app-core/event-bus.ts";
import { createCommandPaletteMruService } from "@main/services/command-palette-service.ts";
import { createPreferencesService } from "@main/services/preferences-service.ts";
import { EMPTY_MRU_STATE } from "@shared/contracts/command-palette-mru.ts";
import type { ProjectPreferences } from "@shared/contracts/preferences.ts";
import { describe, expect, it } from "vitest";

const basePreferences: ProjectPreferences = {
  language: "system",
  monoFontFamily: "",
  monoFontSize: 13,
  stylePresetId: "pierre",
  terminalCursorBlink: true,
  terminalCursorStyle: "block",
  terminalNewCwdPolicy: "activeTerminal",
  terminalPasteProtection: true,
  terminalScrollbackMb: 64,
  theme: "system",
  uiFontFamily: "",
  userKeymap: [],
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

  it("更新终端偏好时不会被服务层过滤", async () => {
    const patches: Partial<ProjectPreferences>[] = [];
    const service = createPreferencesService({
      readPreferences: async () => basePreferences,
      updatePreferences: (patch) => {
        patches.push(patch);
        return Promise.resolve({ ...basePreferences, ...patch });
      },
    });

    await expect(
      service.update({
        terminalCursorBlink: false,
        terminalCursorStyle: "bar",
        terminalNewCwdPolicy: "shellDefault",
        terminalPasteProtection: false,
        terminalScrollbackMb: 128,
      })
    ).resolves.toMatchObject({
      terminalCursorBlink: false,
      terminalCursorStyle: "bar",
      terminalNewCwdPolicy: "shellDefault",
      terminalPasteProtection: false,
      terminalScrollbackMb: 128,
    });
    expect(patches).toEqual([
      {
        terminalCursorBlink: false,
        terminalCursorStyle: "bar",
        terminalNewCwdPolicy: "shellDefault",
        terminalPasteProtection: false,
        terminalScrollbackMb: 128,
      },
    ]);
  });

  it("更新用户快捷键时不会被服务层过滤", async () => {
    const patches: Partial<ProjectPreferences>[] = [];
    const userKeymap = [
      {
        commandId: "-pier.panel.newTerminal",
        keys: "",
        scope: "global" as const,
      },
      {
        commandId: "pier.panel.newTerminal",
        keys: "Mod+Shift+KeyX",
        scope: "global" as const,
      },
    ];
    const service = createPreferencesService({
      readPreferences: async () => basePreferences,
      updatePreferences: (patch) => {
        patches.push(patch);
        return Promise.resolve({ ...basePreferences, ...patch });
      },
    });

    await expect(service.update({ userKeymap })).resolves.toMatchObject({
      userKeymap,
    });
    expect(patches).toEqual([{ userKeymap }]);
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
