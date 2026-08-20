import { app, type Session, session } from "electron";

const DISPLAY_CAPTURE_PERMISSION = "display-capture";
const MEDIA_PERMISSION = "media";
const DEPRECATED_SYNC_CLIPBOARD_READ = "deprecated-sync-clipboard-read";
const DISABLE_FEATURES_SWITCH = "disable-features";
const SCREEN_CAPTURE_DISABLE_FEATURES = [
  "ScreenCaptureKitPickerScreen",
  "ScreenCaptureKitStreamPickerSonoma",
  "ScreenCaptureKitMacScreen",
  "ScreenCaptureKitDeviceMac",
  "ThumbnailCapturerMac:capture_mode/sc_screenshot_manager",
  "MacCatapLoopbackAudioForScreenShare",
].join(",");

function isDeniedPermission(permission: string): boolean {
  return (
    permission === DISPLAY_CAPTURE_PERMISSION ||
    permission === MEDIA_PERMISSION ||
    permission === DEPRECATED_SYNC_CLIPBOARD_READ
  );
}

export function applyDisplayCapturePolicy(target: Session): void {
  target.setPermissionCheckHandler(
    (_webContents, permission) => !isDeniedPermission(permission)
  );
  target.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (isDeniedPermission(permission)) {
      callback(false);
      return;
    }
    callback(true);
  });
  // Empty streams; never enumerate sources or use the macOS 15+ system picker.
  target.setDisplayMediaRequestHandler((_request, callback) => {
    callback({});
  });
}

export function disableUnusedScreenCaptureFeatures(): void {
  if (process.platform !== "darwin") {
    return;
  }
  const existing = app.commandLine.getSwitchValue(DISABLE_FEATURES_SWITCH);
  const merged = existing
    ? `${existing},${SCREEN_CAPTURE_DISABLE_FEATURES}`
    : SCREEN_CAPTURE_DISABLE_FEATURES;
  app.commandLine.appendSwitch(DISABLE_FEATURES_SWITCH, merged);
}

export function installDisplayCapturePolicy(): void {
  applyDisplayCapturePolicy(session.defaultSession);
  app.on("session-created", (created) => {
    applyDisplayCapturePolicy(created);
  });
}
