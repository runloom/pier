import { createLogger } from "@shared/logger.ts";
import { type MacOpenExecFile, openMacWithOpenCommand } from "../macos-open.ts";

const log = createLogger("files:folder-permission-settings");

export interface OpenFolderPermissionSettingsResult {
  opened: boolean;
}

/**
 * 打开「隐私与安全性 › 文件和文件夹」。不用 shell.openExternal：dev 壳会落到空协议页。
 */
export const MAC_FOLDER_PERMISSION_SETTINGS_OPEN_ARGS: readonly (readonly string[])[] =
  [
    [
      "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_FilesAndFolders",
    ],
    [
      "x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders",
    ],
    ["-b", "com.apple.systempreferences"],
  ];

export async function openMacFolderPermissionSettings(options?: {
  execFileImpl?: MacOpenExecFile;
  platform?: NodeJS.Platform;
}): Promise<OpenFolderPermissionSettingsResult> {
  const platform = options?.platform ?? process.platform;
  if (platform !== "darwin") {
    return { opened: false };
  }
  const opened = await openMacWithOpenCommand(
    MAC_FOLDER_PERMISSION_SETTINGS_OPEN_ARGS,
    {
      ...(options?.execFileImpl ? { execFileImpl: options.execFileImpl } : {}),
      onCandidateFailed: (args, err) => {
        log.debug("open folder permission settings candidate failed", {
          args,
          err,
        });
      },
    }
  );
  return { opened };
}
