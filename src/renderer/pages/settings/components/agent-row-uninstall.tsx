import { Button } from "@pier/ui/button.tsx";
import { getAgentCatalogEntry } from "@shared/agent-catalog.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import type { TFunction } from "i18next";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/i18n/use-t.ts";
import {
  formatLifecycleError,
  formatLifecycleRowFailure,
  isLifecycleSoftFailure,
} from "@/pages/settings/components/agent-lifecycle-format.ts";
import { useAgentLifecycleStore } from "@/stores/agent-lifecycle.store.ts";
import { showAppAlert, showAppConfirm } from "@/stores/app-dialog.store.ts";

/**
 * One-click uninstall only when probe.canUninstall (managed plan from project specs).
 * No custom command path; no unsupported explanation when false — hide the button.
 */
export function shouldShowAgentUninstall(input: {
  isBusy: boolean;
  isDetected: boolean;
  canUninstall: boolean | undefined;
}): boolean {
  return !input.isBusy && input.isDetected && input.canUninstall === true;
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

/** Uninstall button for expanded agent details (managed one-click only). */
export function AgentUninstallControls({ agentId }: { agentId: AgentKind }) {
  const t = useT();
  const entry = getAgentCatalogEntry(agentId);
  const displayName = entry?.label ?? agentId;

  const probe = useAgentLifecycleStore((s) => s.probesById[agentId]);
  const job = useAgentLifecycleStore((s) => s.jobById[agentId]);
  const runLifecycle = useAgentLifecycleStore((s) => s.run);

  const showUninstall = shouldShowAgentUninstall({
    isBusy: Boolean(job),
    isDetected: Boolean(probe?.detected),
    canUninstall: probe?.canUninstall,
  });

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

  if (!showUninstall) {
    return null;
  }

  return (
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
  );
}
