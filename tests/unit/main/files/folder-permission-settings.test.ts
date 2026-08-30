import {
  MAC_FOLDER_PERMISSION_SETTINGS_OPEN_ARGS,
  openMacFolderPermissionSettings,
} from "@main/services/files/folder-permission-settings.ts";
import { describe, expect, it, vi } from "vitest";

describe("openMacFolderPermissionSettings", () => {
  it("targets the Files & Folders privacy pane first, app shell as fallback", () => {
    expect(MAC_FOLDER_PERMISSION_SETTINGS_OPEN_ARGS[0]?.[0]).toContain(
      "com.apple.settings.PrivacySecurity.extension"
    );
    expect(MAC_FOLDER_PERMISSION_SETTINGS_OPEN_ARGS[0]?.[0]).toContain(
      "Privacy_FilesAndFolders"
    );
    expect(MAC_FOLDER_PERMISSION_SETTINGS_OPEN_ARGS[1]?.[0]).toContain(
      "com.apple.preference.security"
    );
    expect(MAC_FOLDER_PERMISSION_SETTINGS_OPEN_ARGS.at(-1)).toEqual([
      "-b",
      "com.apple.systempreferences",
    ]);
  });

  it("returns opened:false on non-mac platforms without spawning", async () => {
    const execFileImpl = vi.fn(async () => undefined);
    await expect(
      openMacFolderPermissionSettings({ execFileImpl, platform: "win32" })
    ).resolves.toEqual({ opened: false });
    expect(execFileImpl).not.toHaveBeenCalled();
  });

  it("opens with the first candidate via open(1) on mac", async () => {
    const execFileImpl = vi.fn(async () => undefined);
    await expect(
      openMacFolderPermissionSettings({ execFileImpl, platform: "darwin" })
    ).resolves.toEqual({ opened: true });
    expect(execFileImpl).toHaveBeenCalledTimes(1);
    expect(execFileImpl).toHaveBeenCalledWith("open", [
      "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_FilesAndFolders",
    ]);
  });

  it("falls back through candidates and reports failure when all fail", async () => {
    const execFileImpl = vi.fn(async () => {
      throw new Error("open failed");
    });
    await expect(
      openMacFolderPermissionSettings({ execFileImpl, platform: "darwin" })
    ).resolves.toEqual({ opened: false });
    expect(execFileImpl).toHaveBeenCalledTimes(
      MAC_FOLDER_PERMISSION_SETTINGS_OPEN_ARGS.length
    );
  });
});
