import { basename } from "node:path";
import {
  resolveBundledSoundAbsolutePath,
  soundAssetRootDir,
} from "@main/sounds/sound-asset-paths.ts";
import { ATTENTION_BUILTIN_SOUND_IDS } from "@shared/attention-sound-catalog.ts";
import { describe, expect, it, vi } from "vitest";

// Unit tests run outside Electron; isDevRuntime reads app.isPackaged.
vi.mock("electron", () => ({
  app: {
    isPackaged: false,
  },
}));

describe("soundAssetRootDir", () => {
  it("points at notification-sounds, never fonts", () => {
    const root = soundAssetRootDir().replace(/\\/g, "/");
    expect(root).toMatch(/notification-sounds$/);
    expect(root).not.toMatch(/fonts$/);
    expect(basename(root)).toBe("notification-sounds");
  });
});

describe("resolveBundledSoundAbsolutePath", () => {
  it("resolves catalog basenames under the sound root", () => {
    for (const id of ATTENTION_BUILTIN_SOUND_IDS) {
      const fileName = `${id}.wav`;
      const absolute = resolveBundledSoundAbsolutePath(fileName);
      expect(absolute).toBeTruthy();
      expect(absolute?.replace(/\\/g, "/")).toMatch(
        new RegExp(`/notification-sounds/${fileName}$`)
      );
      expect(absolute).not.toMatch(/fonts/);
    }
  });

  it("rejects path traversal and non-catalog names", () => {
    expect(resolveBundledSoundAbsolutePath("../fonts/x.ttf")).toBeNull();
    expect(resolveBundledSoundAbsolutePath("evil.wav")).toBeNull();
    expect(resolveBundledSoundAbsolutePath("rooster.mp3")).toBeNull();
    expect(
      resolveBundledSoundAbsolutePath("rooster.wav/../evil.wav")
    ).toBeNull();
    expect(resolveBundledSoundAbsolutePath("/rooster.wav")).toBeNull();
    expect(resolveBundledSoundAbsolutePath("")).toBeNull();
    // 旧目录 id 已移除：不得再解析
    expect(resolveBundledSoundAbsolutePath("soft.wav")).toBeNull();
  });
});
