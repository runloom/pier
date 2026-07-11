import { Button } from "@pier/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@pier/ui/card.tsx";
import type { AppUpdateSnapshot } from "@shared/contracts/app-update.ts";
import { Download, RefreshCw, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useCommittedValue } from "@/hooks/use-committed-ref.ts";
import { useT } from "@/i18n/use-t.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";

interface AppUpdateApi {
  check(): Promise<AppUpdateSnapshot>;
  download(): Promise<AppUpdateSnapshot>;
  onChanged(cb: (snapshot: AppUpdateSnapshot) => void): () => void;
  quitAndInstall(): Promise<AppUpdateSnapshot>;
  status(): Promise<AppUpdateSnapshot>;
}

function appUpdateApi(): AppUpdateApi | undefined {
  return (window as unknown as { pier?: { appUpdate?: AppUpdateApi } }).pier
    ?.appUpdate;
}

export function AppUpdateSection() {
  const t = useT();
  const readT = useCommittedValue(t);
  const [snapshot, setSnapshot] = useState<AppUpdateSnapshot | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const api = appUpdateApi();
    const unsubscribe = api?.onChanged(setSnapshot);
    api
      ?.status()
      .then(setSnapshot)
      .catch((err: unknown) => {
        showAppAlert({
          title: readT()("settings.appUpdate.toast.statusFailed"),
          body: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      unsubscribe?.();
    };
  }, [readT]);

  async function run(
    action: () => Promise<AppUpdateSnapshot>,
    failureKey: string
  ): Promise<void> {
    setPending(true);
    try {
      setSnapshot(await action());
    } catch (err) {
      await showAppAlert({
        title: t(failureKey),
        body: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setPending(false);
    }
  }

  const state = snapshot?.state ?? "idle";
  const availableVersion = snapshot?.availableVersion;

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
          <div className="text-sm">
            {availableVersion
              ? t("settings.appUpdate.available", {
                  version: availableVersion,
                })
              : t(`settings.appUpdate.state.${state}`)}
          </div>
          {snapshot?.progress ? (
            <div className="text-muted-foreground text-xs">
              {t("settings.appUpdate.progress", {
                percent: Math.round(snapshot.progress.percent),
              })}
            </div>
          ) : null}
          {snapshot?.error ? (
            <div className="text-destructive text-xs">{snapshot.error}</div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={pending || state === "disabled"}
              onClick={() =>
                run(
                  () =>
                    appUpdateApi()?.check() ?? Promise.reject("missing API"),
                  "settings.appUpdate.toast.checkFailed"
                )
              }
              size="sm"
              type="button"
              variant="outline"
            >
              <RefreshCw aria-hidden className="size-3.5" />
              {t("settings.appUpdate.action.check")}
            </Button>
            <Button
              disabled={pending || state !== "available"}
              onClick={() =>
                run(
                  () =>
                    appUpdateApi()?.download() ?? Promise.reject("missing API"),
                  "settings.appUpdate.toast.downloadFailed"
                )
              }
              size="sm"
              type="button"
              variant="outline"
            >
              <Download aria-hidden className="size-3.5" />
              {t("settings.appUpdate.action.download")}
            </Button>
            <Button
              disabled={pending || state !== "downloaded"}
              onClick={() =>
                run(
                  () =>
                    appUpdateApi()?.quitAndInstall() ??
                    Promise.reject("missing API"),
                  "settings.appUpdate.toast.installFailed"
                )
              }
              size="sm"
              type="button"
              variant="default"
            >
              <RotateCw aria-hidden className="size-3.5" />
              {t("settings.appUpdate.action.restart")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
