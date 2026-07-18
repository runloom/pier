import { Alert, AlertDescription } from "@pier/ui/alert.tsx";
import { Button } from "@pier/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@pier/ui/card.tsx";
import { Download, RefreshCw, RotateCw } from "lucide-react";
import { useT } from "@/i18n/use-t.ts";
import { useAppUpdateStore } from "@/stores/app-update.store.ts";

export function AppUpdateSection() {
  const t = useT();
  const snapshot = useAppUpdateStore((s) => s.snapshot);
  const pending = useAppUpdateStore((s) => s.pending);
  const check = useAppUpdateStore((s) => s.check);
  const download = useAppUpdateStore((s) => s.download);
  const quitAndInstall = useAppUpdateStore((s) => s.quitAndInstall);

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
            <Alert variant="destructive">
              <AlertDescription>{snapshot.error}</AlertDescription>
            </Alert>
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
        </CardContent>
      </Card>
    </div>
  );
}
