import type { AppCliSnapshot } from "@shared/contracts/app-cli.ts";
import i18next from "i18next";
import { toast } from "sonner";
import { showAppAlert, showAppConfirm } from "@/stores/app-dialog.store.ts";

function api() {
  return window.pier.appCli;
}

function t(key: string, params?: Record<string, string>): string {
  if (!params) {
    return i18next.t(key);
  }
  return i18next.t(key, params);
}

async function confirmAdmin(
  path: string,
  kind: "install" | "uninstall"
): Promise<boolean> {
  const prefix = "settings.cliCommand";
  return await showAppConfirm({
    body: t(
      kind === "install"
        ? `${prefix}.installConfirmBody`
        : `${prefix}.uninstallConfirmBody`,
      { path }
    ),
    intent: "default",
    title: t(
      kind === "install"
        ? `${prefix}.installConfirmTitle`
        : `${prefix}.uninstallConfirmTitle`
    ),
  });
}

async function reportFailure(
  titleKey: string,
  snapshot: AppCliSnapshot
): Promise<void> {
  let body = snapshot.detail ?? "";
  if (snapshot.actionError === "conflict" && snapshot.conflictPath) {
    body = t("settings.cliCommand.reason.conflict", {
      path: snapshot.conflictPath,
    });
  } else if (snapshot.actionError === "dev") {
    body = t("settings.cliCommand.reason.dev");
  } else if (snapshot.actionError === "unsupported-platform") {
    body = t("settings.cliCommand.reason.unsupported");
  } else if (snapshot.actionError === "missing-source") {
    body = t("settings.cliCommand.reason.missingSource");
  }
  await showAppAlert({
    body: body.length > 0 ? body : undefined,
    title: t(titleKey),
  });
}

export async function readAppCliStatus(): Promise<AppCliSnapshot> {
  return await api().status();
}

export async function runInstallPierCommand(options?: {
  notify?: boolean;
}): Promise<AppCliSnapshot | null> {
  const notify = options?.notify === true;
  try {
    let snapshot = await api().status();
    if (snapshot.installed) {
      if (notify) {
        toast.success(t("settings.cliCommand.toastAlreadyInstalled"));
      }
      return snapshot;
    }
    if (snapshot.needsAdmin && snapshot.linkPath) {
      const confirmed = await confirmAdmin(snapshot.linkPath, "install");
      if (!confirmed) {
        return snapshot;
      }
      snapshot = await api().install(true);
    } else {
      snapshot = await api().install(false);
      if (!snapshot.actionOk && snapshot.needsAdmin && snapshot.linkPath) {
        const confirmed = await confirmAdmin(snapshot.linkPath, "install");
        if (!confirmed) {
          return snapshot;
        }
        snapshot = await api().install(true);
      }
    }
    if (snapshot.actionError === "cancelled") {
      return snapshot;
    }
    if (!(snapshot.actionOk && snapshot.installed)) {
      await reportFailure("settings.cliCommand.installFailed", snapshot);
      return snapshot;
    }
    if (notify) {
      toast.success(t("settings.cliCommand.toastInstalled"));
    }
    return snapshot;
  } catch (err) {
    await showAppAlert({
      body: err instanceof Error ? err.message : String(err),
      title: t("settings.cliCommand.installFailed"),
    });
    return null;
  }
}

export async function runUninstallPierCommand(options?: {
  notify?: boolean;
}): Promise<AppCliSnapshot | null> {
  const notify = options?.notify === true;
  try {
    let snapshot = await api().status();
    if (!snapshot.installed) {
      return snapshot;
    }
    if (snapshot.linkPath) {
      const confirmed = await confirmAdmin(snapshot.linkPath, "uninstall");
      if (!confirmed) {
        return snapshot;
      }
    }
    snapshot = await api().uninstall(snapshot.needsAdmin);
    if (snapshot.actionError === "cancelled") {
      return snapshot;
    }
    if (!snapshot.actionOk || snapshot.installed) {
      await reportFailure("settings.cliCommand.uninstallFailed", snapshot);
      return snapshot;
    }
    if (notify) {
      toast.success(t("settings.cliCommand.toastRemoved"));
    }
    return snapshot;
  } catch (err) {
    await showAppAlert({
      body: err instanceof Error ? err.message : String(err),
      title: t("settings.cliCommand.uninstallFailed"),
    });
    return null;
  }
}
