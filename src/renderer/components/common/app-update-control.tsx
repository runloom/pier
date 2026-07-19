import { Button } from "@pier/ui/button.tsx";
import type { AppUpdateSnapshot } from "@shared/contracts/app-update.ts";
import { Download, RotateCw } from "lucide-react";
import type { ReactNode } from "react";
import { useT } from "@/i18n/use-t.ts";
import {
  appUpdateNeedsAttention,
  openAppUpdateSettings,
  useAppUpdateStore,
} from "@/stores/app-update.store.ts";

function isVisible(snapshot: AppUpdateSnapshot | null): boolean {
  return appUpdateNeedsAttention(snapshot);
}

function chipLabel(
  t: ReturnType<typeof useT>,
  snapshot: AppUpdateSnapshot | null
): string {
  const state = snapshot?.state ?? "idle";
  const version = snapshot?.availableVersion;
  if (state === "downloaded") {
    return t("settings.appUpdate.action.restart");
  }
  if (state === "downloading") {
    return t("settings.appUpdate.progress", {
      percent: Math.round(snapshot?.progress?.percent ?? 0),
    });
  }
  if (version) {
    return t("settings.appUpdate.titleBar.updateAvailable", { version });
  }
  return t("settings.appUpdate.titleBar.update");
}

function chipAriaLabel(
  t: ReturnType<typeof useT>,
  snapshot: AppUpdateSnapshot | null
): string {
  const state = snapshot?.state ?? "idle";
  const version = snapshot?.availableVersion ?? "";
  if (state === "downloaded") {
    return t("settings.appUpdate.titleBar.restartAria", { version });
  }
  if (state === "downloading") {
    return t("settings.appUpdate.titleBar.downloadingAria", {
      percent: Math.round(snapshot?.progress?.percent ?? 0),
    });
  }
  if (state === "error") {
    return t("settings.appUpdate.titleBar.errorAria");
  }
  return t("settings.appUpdate.titleBar.availableAria", { version });
}

/**
 * Title-bar / chrome update chip — visible only when an update needs attention.
 * downloaded: primary action restarts to install; other states open Settings.
 */
export function AppUpdateControl(): ReactNode {
  const t = useT();
  const snapshot = useAppUpdateStore((s) => s.snapshot);
  const pending = useAppUpdateStore((s) => s.pending);
  const quitAndInstall = useAppUpdateStore((s) => s.quitAndInstall);

  if (!isVisible(snapshot)) {
    return null;
  }

  const state = snapshot?.state ?? "idle";
  const downloaded = state === "downloaded";
  const errored = state === "error";
  const label = chipLabel(t, snapshot);
  const ariaLabel = chipAriaLabel(t, snapshot);

  return (
    <Button
      aria-label={ariaLabel}
      className="app-no-drag"
      data-testid="titlebar-app-update"
      disabled={pending && downloaded}
      onClick={() => {
        if (downloaded) {
          quitAndInstall().catch(() => undefined);
          return;
        }
        openAppUpdateSettings();
      }}
      size="sm"
      type="button"
      variant={downloaded ? "default" : "ghost"}
    >
      {downloaded ? (
        <RotateCw aria-hidden data-icon="inline-start" />
      ) : (
        <Download aria-hidden data-icon="inline-start" />
      )}
      <span
        className={errored ? "font-medium text-status-warning-fg" : undefined}
      >
        {label}
      </span>
    </Button>
  );
}
