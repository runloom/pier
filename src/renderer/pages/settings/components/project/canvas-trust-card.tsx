import { Badge } from "@pier/ui/badge.tsx";
import { Button } from "@pier/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@pier/ui/card.tsx";
import type { CanvasTrustStatus } from "@shared/contracts/live-modules.ts";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useT } from "@/i18n/use-t.ts";
import { showAppAlert, showAppConfirm } from "@/stores/app-dialog.store.ts";

/**
 * Project → General: canvas trust status for this project.
 *
 * The decision lives in userData (never in the project), so this card is the
 * only place to see or revoke it. Revoking makes the next preview ask again.
 */
export function ProjectCanvasTrustCard({
  projectRootPath,
}: {
  projectRootPath: string;
}) {
  const t = useT();
  const [status, setStatus] = useState<CanvasTrustStatus | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const refresh = useCallback(() => {
    setLoadFailed(false);
    window.pier.liveModules
      .trustStatus(projectRootPath)
      .then(setStatus)
      .catch(() => {
        setLoadFailed(true);
      });
  }, [projectRootPath]);

  useEffect(refresh, [refresh]);

  const revoke = async (): Promise<void> => {
    const confirmed = await showAppConfirm({
      body: t("settings.projects.general.canvasTrustRevokeBody"),
      intent: "destructive",
      title: t("settings.projects.general.canvasTrustRevokeTitle"),
    });
    if (!confirmed) {
      return;
    }
    try {
      await window.pier.liveModules.revokeTrust(projectRootPath);
    } catch (error) {
      showAppAlert({
        body: error instanceof Error ? error.message : String(error),
        title: t("settings.projects.general.canvasTrustRevokeFailed"),
      });
      return;
    }
    refresh();
  };

  const body = renderTrustBody(t, loadFailed, status);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle>{t("settings.projects.general.canvasTrustTitle")}</CardTitle>
        <CardDescription>
          {t("settings.projects.general.canvasTrustDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent className="pb-3">{body}</CardContent>
      {status?.trusted ? (
        <CardFooter className="justify-end border-t pt-3">
          <Button onClick={() => revoke()} variant="destructive">
            {t("settings.projects.general.canvasTrustRevoke")}
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}

function renderTrustBody(
  t: (key: string) => string,
  loadFailed: boolean,
  status: CanvasTrustStatus | null
): ReactNode {
  if (loadFailed) {
    return (
      <p className="text-sm text-status-danger-fg">
        {t("settings.projects.general.canvasTrustLoadFailed")}
      </p>
    );
  }
  if (status === null) {
    return (
      <p className="text-muted-foreground text-sm">
        {t("settings.projects.general.canvasTrustLoading")}
      </p>
    );
  }
  if (!status.trusted) {
    return (
      <p className="text-muted-foreground text-sm">
        {t("settings.projects.general.canvasTrustNotTrusted")}
      </p>
    );
  }
  return (
    <p className="flex items-center gap-2 text-sm">
      <Badge>{t("settings.projects.general.canvasTrustedBadge")}</Badge>
      {status.grantedAt ? new Date(status.grantedAt).toLocaleString() : null}
    </p>
  );
}
