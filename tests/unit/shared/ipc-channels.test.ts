import {
  ALLOWED_RENDERER_CHANNELS,
  PIER,
  PIER_BROADCAST,
} from "@shared/ipc-channels.ts";
import { describe, expect, it } from "vitest";

describe("PIER_BROADCAST.PLUGINS_CHANGED", () => {
  it("遵循 pier://<domain>:<action> 命名", () => {
    expect(PIER_BROADCAST.PLUGINS_CHANGED).toBe("pier://plugins:changed");
  });

  it("自动进入 preload 订阅白名单(ALLOWED_RENDERER_CHANNELS 派生)", () => {
    expect(ALLOWED_RENDERER_CHANNELS).toContain("pier://plugins:changed");
  });
});

describe("PIER.FILE_PICK_SAVE_TARGET", () => {
  it("uses a dedicated renderer-to-main channel", () => {
    expect(PIER.FILE_PICK_SAVE_TARGET).toBe("pier://file:pick-save-target");
    expect(ALLOWED_RENDERER_CHANNELS).not.toContain(PIER.FILE_PICK_SAVE_TARGET);
  });
});
