import { Button } from "@pier/ui/button.tsx";
import { Card, CardContent } from "@pier/ui/card.tsx";
import {
  FieldDescription,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@pier/ui/field.tsx";
import type { AppCliSnapshot } from "@shared/contracts/app-cli.ts";
import { useEffect, useState } from "react";
import { useT } from "@/i18n/use-t.ts";
import {
  readAppCliStatus,
  runInstallPierCommand,
  runUninstallPierCommand,
} from "@/lib/app-cli-actions.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";

function installedStatusLabel(
  t: ReturnType<typeof useT>,
  snapshot: AppCliSnapshot | null
): string {
  if (!snapshot) {
    return t("settings.cliCommand.status.loading");
  }
  if (snapshot.installed && snapshot.linkPath) {
    return t("settings.cliCommand.status.installed", {
      path: snapshot.linkPath,
    });
  }
  return t("settings.cliCommand.status.notInstalled");
}

function reasonText(
  t: ReturnType<typeof useT>,
  snapshot: AppCliSnapshot | null
): string | null {
  if (!snapshot) {
    return null;
  }
  if (snapshot.actionError === "dev") {
    return t("settings.cliCommand.reason.dev");
  }
  if (snapshot.actionError === "unsupported-platform") {
    return t("settings.cliCommand.reason.unsupported");
  }
  if (snapshot.actionError === "missing-source") {
    return t("settings.cliCommand.reason.missingSource");
  }
  if (snapshot.actionError === "conflict" && snapshot.conflictPath) {
    return t("settings.cliCommand.reason.conflict", {
      path: snapshot.conflictPath,
    });
  }
  if (!snapshot.installed && snapshot.needsAdmin && snapshot.linkPath) {
    return t("settings.cliCommand.reason.needsAdmin", {
      path: snapshot.linkPath,
    });
  }
  return null;
}

export function CliCommandBlock() {
  const t = useT();
  const [snapshot, setSnapshot] = useState<AppCliSnapshot | null>(null);
  const [pending, setPending] = useState<"install" | "uninstall" | null>(null);

  useEffect(() => {
    readAppCliStatus()
      .then(setSnapshot)
      .catch(async (err: unknown) => {
        await showAppAlert({
          body: err instanceof Error ? err.message : String(err),
          title: t("settings.cliCommand.statusFailed"),
        });
      });
  }, [t]);

  const unavailable =
    snapshot?.actionError === "dev" ||
    snapshot?.actionError === "unsupported-platform" ||
    snapshot?.actionError === "missing-source" ||
    snapshot?.actionError === "conflict";
  const statusText = installedStatusLabel(t, snapshot);
  const extra = reasonText(t, snapshot);

  return (
    <Card>
      <CardContent>
        <FieldSet>
          <FieldLegend>{t("settings.cliCommand.title")}</FieldLegend>
          <FieldDescription>
            {t("settings.cliCommand.description")}
          </FieldDescription>
          <FieldSeparator />
          <div className="flex flex-col gap-2">
            <div className="text-sm">
              <span className="text-muted-foreground">
                {t("settings.cliCommand.statusLabel")}
              </span>{" "}
              <span className="font-medium">{statusText}</span>
            </div>
            {extra ? (
              <div className="text-muted-foreground text-sm">{extra}</div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={
                  pending !== null || unavailable || snapshot?.installed
                }
                onClick={() => {
                  setPending("install");
                  runInstallPierCommand()
                    .then((next) => {
                      if (next) {
                        setSnapshot(next);
                      }
                    })
                    .finally(() => {
                      setPending(null);
                    });
                }}
                type="button"
                variant="outline"
              >
                {pending === "install"
                  ? t("settings.cliCommand.installing")
                  : t("settings.cliCommand.install")}
              </Button>
              <Button
                disabled={pending !== null || !snapshot?.installed}
                onClick={() => {
                  setPending("uninstall");
                  runUninstallPierCommand()
                    .then((next) => {
                      if (next) {
                        setSnapshot(next);
                      }
                    })
                    .finally(() => {
                      setPending(null);
                    });
                }}
                type="button"
                variant="outline"
              >
                {pending === "uninstall"
                  ? t("settings.cliCommand.uninstalling")
                  : t("settings.cliCommand.uninstall")}
              </Button>
            </div>
          </div>
        </FieldSet>
      </CardContent>
    </Card>
  );
}
