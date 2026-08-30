import { ErrorEmpty } from "@pier/ui/error-empty.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { FilesTranslate } from "../i18n.ts";

function isMacRenderer(): boolean {
  return (
    typeof navigator !== "undefined" && navigator.platform.startsWith("Mac")
  );
}

export function FolderAccessErrorEmpty({
  blocked,
  className,
  context,
  description,
  retryAction,
  t,
  title,
}: {
  blocked: boolean;
  className?: string;
  context?: Pick<RendererPluginContext, "files" | "notifications">;
  description?: string;
  retryAction?: { label: string; onClick: () => void };
  t: FilesTranslate;
  title: string;
}) {
  const showGuide = Boolean(blocked && context && isMacRenderer());
  const openPermissionSettings = () => {
    if (!context) {
      return;
    }
    const failedToast = () => {
      context.notifications.error(
        t(
          "panel.loadError.openSystemSettingsFailed",
          "Could not open System Settings. Please open Privacy & Security manually."
        )
      );
    };
    context.files
      .openFolderPermissionSettings()
      .then((result) => {
        if (!result.opened) {
          failedToast();
        }
      })
      .catch(failedToast);
  };
  return (
    <ErrorEmpty
      className={className}
      description={
        showGuide
          ? t(
              "panel.loadError.permissionBody",
              "macOS is blocking Pier from reading this location. Allow Pier under System Settings › Privacy & Security › Files & Folders, then retry."
            )
          : description
      }
      detailAction={
        showGuide
          ? {
              label: t(
                "panel.loadError.openSystemSettings",
                "Open System Settings"
              ),
              onClick: openPermissionSettings,
            }
          : undefined
      }
      retryAction={retryAction}
      title={
        showGuide
          ? t("panel.loadError.permissionTitle", "Access is blocked")
          : title
      }
    />
  );
}

export function FileTreeLoadErrorEmpty({
  blocked,
  context,
  description,
  onRetry,
  t,
}: {
  blocked: boolean;
  context: Pick<RendererPluginContext, "files" | "notifications">;
  description: string;
  onRetry: () => void;
  t: FilesTranslate;
}) {
  return (
    <FolderAccessErrorEmpty
      blocked={blocked}
      className="min-h-0 flex-1 rounded-none border-0 p-4"
      context={context}
      description={description}
      retryAction={{
        label: t("panel.loadError.retry", "Retry"),
        onClick: onRetry,
      }}
      t={t}
      title={t("panel.loadError.title", "Unable to load files")}
    />
  );
}
