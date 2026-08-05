import { Badge } from "@pier/ui/badge.tsx";
import { Button } from "@pier/ui/button.tsx";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@pier/ui/collapsible.tsx";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@pier/ui/item.tsx";
import { AgentIcon } from "@plugins/api/components/agent-icons/index.tsx";
import { getAgentCatalogEntry } from "@shared/agent-catalog.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import {
  ArrowUpCircle,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { type MouseEvent, useState } from "react";
import { toast } from "sonner";
import { useT } from "@/i18n/use-t.ts";
import {
  formatAgentVersionMeta,
  formatLifecycleError,
  formatLifecycleRowFailure,
  isLifecycleSoftFailure,
  lifecycleBusyStatusText,
  resolveAgentStatusBadge,
} from "@/pages/settings/components/agent-lifecycle-format.ts";
import { AgentExpandedDetails } from "@/pages/settings/components/agent-row-details.tsx";
import { useAgentDetectStore } from "@/stores/agent-detect.store.ts";
import { useAgentLifecycleStore } from "@/stores/agent-lifecycle.store.ts";
import { useAgentPreferencesStore } from "@/stores/agent-preferences.store.ts";
import { showAppAlert, showAppConfirm } from "@/stores/app-dialog.store.ts";

export function AgentRow({ agentId }: { agentId: AgentKind }) {
  const t = useT();
  const [open, setOpen] = useState(false);

  const detectedIds = useAgentDetectStore((s) => s.detectedIds);
  const disabledAgentIds = useAgentPreferencesStore((s) => s.disabledAgentIds);
  const defaultAgentId = useAgentPreferencesStore((s) => s.defaultAgentId);
  const setDisabledAgentIds = useAgentPreferencesStore(
    (s) => s.setDisabledAgentIds
  );
  const setDefaultAgentId = useAgentPreferencesStore(
    (s) => s.setDefaultAgentId
  );
  const probe = useAgentLifecycleStore((s) => s.probesById[agentId]);
  const job = useAgentLifecycleStore((s) => s.jobById[agentId]);
  const lifecycleFailure = useAgentLifecycleStore(
    (s) => s.failureById[agentId]
  );
  const runLifecycle = useAgentLifecycleStore((s) => s.run);
  const cancelLifecycle = useAgentLifecycleStore((s) => s.cancel);

  const entry = getAgentCatalogEntry(agentId);
  // Prefer lifecycle probe when present (same env + version); fall back to detect.
  const isDetected =
    probe === undefined
      ? detectedIds.includes(agentId)
      : Boolean(probe.detected);
  const isDisabled = disabledAgentIds.includes(agentId);
  const isAvailable = isDetected && !isDisabled;
  const isDefault = isAvailable && defaultAgentId === agentId;
  const canExpand = isDetected;
  // Explicit job phase — no batchIds × actionById cross-product.
  const isBusy = Boolean(job);
  const busyAction = job?.action;
  const isQueued = job?.phase === "queued";
  /** Cancel only while main is actually running this agent. */
  const canCancelBusy = job?.phase === "running";
  const lifecycleProgress = job?.progress;
  const canInstall = probe?.canInstall === true;
  const displayName = entry?.label ?? agentId;

  const statusBadge = resolveAgentStatusBadge(t, {
    broken: Boolean(probe?.installedButBroken),
    conflict: Boolean(probe?.isConflict),
    disabled: isDisabled,
    detected: isDetected,
  });
  // Disabled: show installed version only — no latest / upgrade affordance.
  const versionMeta = formatAgentVersionMeta(
    probe?.version,
    isDisabled ? null : probe?.latestVersion
  );

  const busyStatusText = lifecycleBusyStatusText(t, {
    action: busyAction ?? undefined,
    queued: isQueued,
    progress: canCancelBusy ? lifecycleProgress : undefined,
  });

  const failureText = lifecycleFailure
    ? formatLifecycleRowFailure(t, {
        name: displayName,
        failure: lifecycleFailure,
      })
    : null;

  const handleLifecycle = async (action: "install" | "update") => {
    if (action === "update" && probe?.isConflict) {
      const confirmed = await showAppConfirm({
        title: t("settings.agents.action.conflictConfirmTitle"),
        body: t("settings.agents.action.conflictConfirmBody"),
        confirmLabel: t("settings.agents.action.conflictConfirmContinue"),
        intent: "default",
      });
      if (!confirmed) {
        return;
      }
    }
    try {
      const result = await runLifecycle(agentId, action);
      if (result.ok && result.skipped) {
        toast.success(t("settings.agents.action.alreadyInstalled"));
        return;
      }
      if (!result.ok) {
        if (isLifecycleSoftFailure(result)) {
          toast.error(formatLifecycleError(t, result));
          return;
        }
        // Hard failure: red line on the row; details only when stderr/detail exists.
        const detail = formatLifecycleError(t, result);
        const short = formatLifecycleRowFailure(t, {
          name: displayName,
          failure: {
            action,
            errorCode: result.errorCode,
            errorDetail: result.errorDetail,
            stepLabel: lifecycleProgress?.label,
          },
        });
        if (result.errorDetail?.trim() || result.commandPreview?.trim()) {
          await showAppAlert({
            title: short,
            body: detail,
          });
        }
      }
    } catch (err) {
      await showAppAlert({
        title:
          action === "install"
            ? t("settings.agents.action.installFailed")
            : t("settings.agents.action.updateFailed"),
        body: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleCancel = () => {
    cancelLifecycle(agentId).catch(() => undefined);
  };

  const toggleDisabled = () => {
    if (isDisabled) {
      setDisabledAgentIds(
        disabledAgentIds.filter((id) => id !== agentId)
      ).catch(() => undefined);
    } else {
      setDisabledAgentIds([...disabledAgentIds, agentId]).catch(
        () => undefined
      );
    }
  };

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

  return (
    <Collapsible onOpenChange={setOpen} open={open}>
      <Item
        className="rounded-none border-0 px-(--card-spacing)"
        data-testid={`agent-row-${agentId}`}
        role="listitem"
      >
        <ItemContent className="min-w-0 gap-0.5">
          <ItemTitle className="min-w-0 max-w-full">
            <AgentIcon agentId={agentId} size={16} />
            <span className="truncate">{entry?.label ?? agentId}</span>
            {statusBadge ? (
              <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
            ) : null}
            {isDefault ? (
              <Badge variant="secondary">
                {t("settings.agents.action.isDefault")}
              </Badge>
            ) : null}
          </ItemTitle>
          {versionMeta ? (
            <ItemDescription
              className="font-mono text-xs tabular-nums"
              title={versionMeta}
            >
              {versionMeta}
            </ItemDescription>
          ) : null}
          {failureText && !isBusy ? (
            <ItemDescription
              className="text-destructive text-xs"
              title={lifecycleFailure?.errorDetail ?? failureText}
            >
              {failureText}
            </ItemDescription>
          ) : null}
        </ItemContent>
        <ItemActions>
          {canExpand ? (
            <CollapsibleTrigger asChild>
              <Button
                aria-label={t("settings.agents.action.expand")}
                size="sm"
                type="button"
                variant="ghost"
              >
                {open ? (
                  <ChevronDown data-icon="inline-start" />
                ) : (
                  <ChevronRight data-icon="inline-start" />
                )}
                {t("settings.agents.action.expand")}
              </Button>
            </CollapsibleTrigger>
          ) : null}
          {isAvailable && !isDefault ? (
            <Button
              onClick={() => setDefaultAgentId(agentId).catch(() => undefined)}
              size="sm"
              type="button"
              variant="ghost"
            >
              {t("settings.agents.action.setDefault")}
            </Button>
          ) : null}
          {isBusy && busyAction ? (
            <Button
              aria-label={
                canCancelBusy
                  ? t("settings.agents.action.cancel")
                  : busyStatusText
              }
              disabled={!canCancelBusy}
              onClick={canCancelBusy ? handleCancel : undefined}
              size="sm"
              type="button"
              variant="outline"
            >
              <Loader2 className="animate-spin" data-icon="inline-start" />
              {busyStatusText}
            </Button>
          ) : null}
          {!(isDetected || probe?.installedButBroken) &&
          canInstall &&
          !isBusy ? (
            <Button
              onClick={() => {
                handleLifecycle("install").catch(() => undefined);
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              <Download data-icon="inline-start" />
              {t("settings.agents.action.install")}
            </Button>
          ) : null}
          {/* Broken install: repair via update plan (self / reinstall / script). */}
          {!isDisabled && probe?.installedButBroken && canInstall && !isBusy ? (
            <Button
              onClick={() => {
                handleLifecycle("update").catch(() => undefined);
              }}
              size="sm"
              type="button"
              variant="default"
            >
              <ArrowUpCircle data-icon="inline-start" />
              {t("settings.agents.action.update")}
            </Button>
          ) : null}
          {!isDisabled &&
          isDetected &&
          canInstall &&
          probe?.updateOffered &&
          !probe.installedButBroken &&
          !isBusy ? (
            <Button
              onClick={() => {
                handleLifecycle("update").catch(() => undefined);
              }}
              size="sm"
              type="button"
              variant="default"
            >
              <ArrowUpCircle data-icon="inline-start" />
              {t("settings.agents.action.update")}
            </Button>
          ) : null}
          {isDetected ? (
            <Button
              onClick={toggleDisabled}
              size="sm"
              type="button"
              variant={isDisabled ? "default" : "outline"}
            >
              {isDisabled
                ? t("settings.agents.action.enable")
                : t("settings.agents.action.disable")}
            </Button>
          ) : null}
          {/* Website is always the rightmost action when shown. */}
          {!isDetected && entry?.homepageUrl ? (
            <Button asChild size="icon-sm" variant="outline">
              <a
                aria-label={t("settings.agents.action.website")}
                href={entry.homepageUrl}
                onAuxClick={handleWebsiteClick}
                onClick={handleWebsiteClick}
                rel="noreferrer"
              >
                <ExternalLink data-icon="inline-start" />
              </a>
            </Button>
          ) : null}
        </ItemActions>

        {open && canExpand ? (
          <CollapsibleContent asChild forceMount>
            <div className="w-full space-y-3 px-(--card-spacing) pb-3">
              {probe ? (
                <div className="space-y-1 text-muted-foreground text-xs">
                  {/* Version lives on the row (`a → b`); don't repeat here. */}
                  {probe.updateMode === "reinstall" && probe.detected ? (
                    <div>{t("settings.agents.lifecycle.updateHint")}</div>
                  ) : null}
                  {probe.installs.length > 0 ? (
                    <div className="space-y-1">
                      <div>{t("settings.agents.lifecycle.installs")}</div>
                      <ul className="space-y-0.5">
                        {probe.installs.map((inst) => (
                          <li
                            className="truncate font-mono"
                            key={inst.path}
                            title={inst.path}
                          >
                            [{inst.source}] {inst.path}
                            {inst.version ? ` (${inst.version})` : ""}
                            {inst.isPathDefault ? " *" : ""}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {isDetected ? <AgentExpandedDetails agentId={agentId} /> : null}
            </div>
          </CollapsibleContent>
        ) : null}
      </Item>
    </Collapsible>
  );
}
