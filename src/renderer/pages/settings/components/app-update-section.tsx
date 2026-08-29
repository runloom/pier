import { Alert, AlertDescription, AlertTitle } from "@pier/ui/alert.tsx";
import { Button } from "@pier/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@pier/ui/card.tsx";
import { FieldSeparator } from "@pier/ui/field.tsx";
import { Download, RefreshCw, RotateCw } from "lucide-react";
import { useT } from "@/i18n/use-t.ts";
import { SwitchRow } from "@/pages/settings/components/rows/switch-row.tsx";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import { useAppUpdateStore } from "@/stores/app-update.store.ts";
import { useAppUpdatePreferencesStore } from "@/stores/app-update-preferences.store.ts";

export function AppUpdateSection() {
  const t = useT();
  const snapshot = useAppUpdateStore((s) => s.snapshot);
  const pending = useAppUpdateStore((s) => s.pending);
  const check = useAppUpdateStore((s) => s.check);
  const download = useAppUpdateStore((s) => s.download);
  const quitAndInstall = useAppUpdateStore((s) => s.quitAndInstall);
  const receiveCandidateUpdates = useAppUpdatePreferencesStore(
    (s) => s.receiveCandidateUpdates
  );
  const setReceiveCandidateUpdates = useAppUpdatePreferencesStore(
    (s) => s.setReceiveCandidateUpdates
  );

  async function toggleReceiveCandidates(next: boolean): Promise<void> {
    try {
      await setReceiveCandidateUpdates(next);
    } catch (err) {
      await showAppAlert({
        body: err instanceof Error ? err.message : String(err),
        title: t("settings.appUpdate.toast.prefFailed"),
      });
      return;
    }
    // 开启即按新通道重查一次；开关翻转本身是自然反馈，不另加 toast。
    if (next) {
      check().catch(() => undefined);
    }
  }

  const state = snapshot?.state ?? "idle";
  const availableVersion = snapshot?.availableVersion;
  const errorKind = snapshot?.errorKind ?? "unknown";

  return (
    <div className="px-4 pb-4" id="updates">
      <h1 className="mb-4 text-xl">{t("settings.section.updates")}</h1>
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.appUpdate.title")}</CardTitle>
          <CardDescription>
            {t("settings.appUpdate.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {state === "error" ? (
            <Alert variant="destructive">
              <AlertTitle>
                {t(`settings.appUpdate.errorKind.${errorKind}`)}
              </AlertTitle>
              <AlertDescription>
                {t(`settings.appUpdate.errorHint.${errorKind}`)}
                {snapshot?.errorDetail ? (
                  <div className="mt-1 break-all text-muted-foreground text-xs">
                    {snapshot.errorDetail}
                  </div>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : (
            <div className="text-sm">
              {availableVersion
                ? t("settings.appUpdate.available", {
                    version: availableVersion,
                  })
                : t(`settings.appUpdate.state.${state}`)}
            </div>
          )}
          {snapshot?.progress ? (
            <div className="text-muted-foreground text-xs">
              {t("settings.appUpdate.progress", {
                percent: Math.round(snapshot.progress.percent),
              })}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={pending || state === "disabled"}
              onClick={() => {
                check().catch(() => undefined);
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              <RefreshCw aria-hidden data-icon="inline-start" />
              {t("settings.appUpdate.action.check")}
            </Button>
            <Button
              disabled={pending || (state !== "available" && state !== "error")}
              onClick={() => {
                download().catch(() => undefined);
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              <Download aria-hidden data-icon="inline-start" />
              {t("settings.appUpdate.action.download")}
            </Button>
            <Button
              disabled={pending || state !== "downloaded"}
              onClick={() => {
                quitAndInstall().catch(() => undefined);
              }}
              size="sm"
              type="button"
              variant="default"
            >
              <RotateCw aria-hidden data-icon="inline-start" />
              {t("settings.appUpdate.action.restart")}
            </Button>
          </div>
          <FieldSeparator />
          <SwitchRow
            checked={receiveCandidateUpdates}
            description={t("settings.appUpdate.receiveCandidatesDesc")}
            id="settings-app-update-receive-candidates"
            label={t("settings.appUpdate.receiveCandidates")}
            onCheckedChange={(next) => {
              toggleReceiveCandidates(next).catch(() => undefined);
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
