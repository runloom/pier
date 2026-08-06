import { Button } from "@pier/ui/button.tsx";
import { getAgentCatalogEntry } from "@shared/agent-catalog.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import type { TFunction } from "i18next";
import { ExternalLink, Trash2 } from "lucide-react";
import type { MouseEvent } from "react";
import { toast } from "sonner";
import { useT } from "@/i18n/use-t.ts";
import {
  formatLifecycleError,
  formatLifecycleRowFailure,
  isLifecycleSoftFailure,
} from "@/pages/settings/components/agent-lifecycle-format.ts";
import { useAgentLifecycleStore } from "@/stores/agent-lifecycle.store.ts";
import { useAgentPreferencesStore } from "@/stores/agent-preferences.store.ts";
import { showAppAlert, showAppConfirm } from "@/stores/app-dialog.store.ts";

/** K18: uninstall control only for full support + managed plan or L2 custom. */
export function shouldShowAgentUninstall(input: {
  isBusy: boolean;
  isDetected: boolean;
  support: string | undefined;
  canUninstall: boolean | undefined;
  hasCustomUninstallCommand: boolean;
}): boolean {
  return (
    !input.isBusy &&
    input.isDetected &&
    input.support === "full" &&
    (input.canUninstall === true || input.hasCustomUninstallCommand)
  );
}

/**
 * Confirm body with PATH-default targets when known.
 * Never interpolates "—" — missing targets degrade to name-only copy.
 * Multi-install (isConflict): append note that only the default location is removed (§9.3).
 */
export function formatUninstallConfirmBody(
  t: TFunction,
  options: {
    name: string;
    path?: string | null | undefined;
    source?: string | null | undefined;
    isConflict?: boolean;
  }
): string {
  const path = options.path?.trim() ?? "";
  const source = options.source?.trim() ?? "";
  const base =
    path.length > 0 && source.length > 0
      ? t("settings.agents.action.uninstallConfirmBody", {
          name: options.name,
          path,
          source,
        })
      : t("settings.agents.action.uninstallConfirmBodyNameOnly", {
          name: options.name,
        });
  if (!options.isConflict) {
    return base;
  }
  return `${base} ${t("settings.agents.action.uninstallConfirmConflictNote")}`;
}

/** Uninstall button + unsupported note for expanded agent details. */
export function AgentUninstallControls({ agentId }: { agentId: AgentKind }) {
  const t = useT();
  const entry = getAgentCatalogEntry(agentId);
  const displayName = entry?.label ?? agentId;

  const probe = useAgentLifecycleStore((s) => s.probesById[agentId]);
  const job = useAgentLifecycleStore((s) => s.jobById[agentId]);
  const runLifecycle = useAgentLifecycleStore((s) => s.run);
  const agentUninstallCommands = useAgentPreferencesStore(
    (s) => s.agentUninstallCommands
  );

  const hasCustom = (agentUninstallCommands[agentId] ?? "").trim().length > 0;
  const isBusy = Boolean(job);
  const isDetected = Boolean(probe?.detected);
  const support = probe?.support;

  const showUninstall = shouldShowAgentUninstall({
    isBusy,
    isDetected,
    support,
    canUninstall: probe?.canUninstall,
    hasCustomUninstallCommand: hasCustom,
  });

  const showUnsupported =
    support === "full" &&
    isDetected &&
    probe?.uninstallMode === "none" &&
    !hasCustom;

  const handleWebsiteClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if ((event.button !== 0 && event.button !== 1) || !entry?.homepageUrl) {
      return;
    }
    event.preventDefault();
    window.pier.externalNavigation
      .open(entry.homepageUrl)
      .then((result) => {
        if (result.opened) {
          return;
        }
        if (result.reason === "busy") {
          toast.info(t("settings.agents.action.websiteOpenBusy"));
          return;
        }
        return showAppAlert({
          body: t("settings.agents.action.websiteOpenFailedDescription"),
          title: t("settings.agents.action.websiteOpenFailedTitle"),
        });
      })
      .catch((error: unknown) =>
        showAppAlert({
          body: error instanceof Error ? error.message : String(error),
          title: t("settings.agents.action.websiteOpenFailedTitle"),
        })
      )
      .catch(() => undefined);
  };

  const handleUninstall = async () => {
    const confirmed = await showAppConfirm({
      title: t("settings.agents.action.uninstallConfirmTitle"),
      body: formatUninstallConfirmBody(t, {
        name: displayName,
        path: probe?.uninstallTargetPath,
        source: probe?.uninstallTargetSource,
        isConflict: probe?.isConflict === true,
      }),
      confirmLabel: t("settings.agents.action.uninstallConfirmContinue"),
      intent: "destructive",
    });
    if (!confirmed) {
      return;
    }
    try {
      const result = await runLifecycle(agentId, "uninstall");
      if (result.ok && result.skipped) {
        toast.success(t("settings.agents.action.uninstallSkipped"));
        return;
      }
      if (result.ok) {
        toast.success(
          t("settings.agents.action.uninstallSuccess", { name: displayName })
        );
        return;
      }
      if (isLifecycleSoftFailure(result)) {
        toast.error(formatLifecycleError(t, result));
        return;
      }
      // Hard failure: row red line via store; alert when detail/preview present.
      const detail = formatLifecycleError(t, result);
      const short = formatLifecycleRowFailure(t, {
        name: displayName,
        failure: {
          action: "uninstall",
          errorCode: result.errorCode,
          errorDetail: result.errorDetail,
        },
      });
      if (result.errorDetail?.trim() || result.commandPreview?.trim()) {
        await showAppAlert({
          title: short,
          body: detail,
        });
      }
    } catch (err) {
      await showAppAlert({
        title: t("settings.agents.action.uninstallFailed"),
        body: err instanceof Error ? err.message : String(err),
      });
    }
  };

  if (!(showUninstall || showUnsupported)) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3">
      {showUnsupported ? (
        <div className="flex flex-col gap-2 text-muted-foreground text-sm">
          <p>{t("settings.agents.action.uninstallUnsupported")}</p>
          {entry?.homepageUrl ? (
            <div>
              <Button asChild size="sm" variant="outline">
                <a
                  aria-label={t("settings.agents.action.website")}
                  href={entry.homepageUrl}
                  onAuxClick={handleWebsiteClick}
                  onClick={handleWebsiteClick}
                  rel="noreferrer"
                >
                  <ExternalLink data-icon="inline-start" />
                  {t("settings.agents.action.website")}
                </a>
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      {showUninstall ? (
        <div className="flex justify-end">
          <Button
            data-testid={`agent-uninstall-${agentId}`}
            onClick={() => {
              handleUninstall().catch(() => undefined);
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            <Trash2 data-icon="inline-start" />
            {t("settings.agents.action.uninstall")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
