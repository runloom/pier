import { Button } from "@pier/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@pier/ui/card.tsx";
import {
  Field,
  FieldLabel,
  FieldSeparator,
  FieldSet,
} from "@pier/ui/field.tsx";
import { ItemGroup, ItemSeparator } from "@pier/ui/item.tsx";
import { ToggleGroup, ToggleGroupItem } from "@pier/ui/toggle-group.tsx";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@pier/ui/tooltip.tsx";
import { cn } from "@pier/ui/utils.ts";
import { AgentIcon } from "@plugins/api/components/agent-icons/index.tsx";
import { AGENT_CATALOG, getAgentCatalogEntry } from "@shared/agent-catalog.ts";
import {
  type AgentKind,
  applyPermissionMode,
} from "@shared/contracts/agent.ts";
import { Loader2, RefreshCw } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { useT } from "@/i18n/use-t.ts";
import { AgentRow } from "@/pages/settings/components/agent-row.tsx";
import { SelectRow } from "@/pages/settings/components/rows/select-row.tsx";
import { SwitchRow } from "@/pages/settings/components/rows/switch-row.tsx";
import { useAgentDetectStore } from "@/stores/agent-detect.store.ts";
import { useAgentLifecycleStore } from "@/stores/agent-lifecycle.store.ts";
import { useAgentPreferencesStore } from "@/stores/agent-preferences.store.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";

const PERMISSION_MODE_OPTIONS: Array<{
  value: "yolo" | "manual";
  labelKey: string;
}> = [
  { value: "manual", labelKey: "settings.agents.permissionMode.manual" },
  { value: "yolo", labelKey: "settings.agents.permissionMode.yolo" },
];

function DefaultAgentPicker() {
  const t = useT();
  const defaultAgentId = useAgentPreferencesStore((s) => s.defaultAgentId);
  const disabledAgentIds = useAgentPreferencesStore((s) => s.disabledAgentIds);
  const setDefaultAgentId = useAgentPreferencesStore(
    (s) => s.setDefaultAgentId
  );
  const detectedIds = useAgentDetectStore((s) => s.detectedIds);

  const activeDetectedIds = detectedIds.filter(
    (id) => !disabledAgentIds.includes(id)
  );

  const isBlank = defaultAgentId === "blank";

  // Auto is active when no agent is chosen (null), or the chosen agent is no
  // longer available (not detected / disabled) and thus falls back to auto.
  // "blank" is a distinct, explicit choice — never an auto-fallback case.
  const autoIsActive =
    defaultAgentId === null ||
    (!isBlank &&
      (!detectedIds.includes(defaultAgentId) ||
        disabledAgentIds.includes(defaultAgentId)));

  let selectedValue: AgentKind | "auto" | "blank" = "auto";
  if (isBlank) {
    selectedValue = "blank";
  } else if (!autoIsActive && defaultAgentId) {
    selectedValue = defaultAgentId;
  }

  return (
    <fieldset>
      <legend className="sr-only">{t("settings.row.defaultAgent")}</legend>
      <ToggleGroup
        className="flex-wrap"
        onValueChange={(value) => {
          if (!value) return;
          let nextValue: AgentKind | "blank" | null = value as AgentKind;
          if (value === "auto") {
            nextValue = null;
          } else if (value === "blank") {
            nextValue = "blank";
          }
          setDefaultAgentId(nextValue).catch(() => undefined);
        }}
        type="single"
        value={selectedValue ?? "auto"}
        variant="outline"
      >
        <ToggleGroupItem value="auto">
          {t("settings.agents.defaultPick.auto")}
        </ToggleGroupItem>
        <ToggleGroupItem value="blank">
          {t("settings.agents.defaultPick.blank")}
        </ToggleGroupItem>
        {activeDetectedIds.map((id) => {
          const entry = getAgentCatalogEntry(id);
          return (
            <ToggleGroupItem key={id} value={id}>
              <AgentIcon agentId={id} />
              {entry?.label ?? id}
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>
    </fieldset>
  );
}

function PermissionModeRow() {
  const t = useT();
  const agentDefaultArgs = useAgentPreferencesStore((s) => s.agentDefaultArgs);
  const agentDefaultEnv = useAgentPreferencesStore((s) => s.agentDefaultEnv);
  const agentPermissionMode = useAgentPreferencesStore(
    (s) => s.agentPermissionMode
  );
  const setAgentPermissionMode = useAgentPreferencesStore(
    (s) => s.setAgentPermissionMode
  );

  return (
    <SelectRow<"yolo" | "manual">
      description={t("settings.row.agentPermissionModeDesc")}
      id="settings-agent-permission-mode"
      label={t("settings.row.agentPermissionMode")}
      onChange={(next: "yolo" | "manual") => {
        const applied = applyPermissionMode(
          next,
          agentDefaultArgs,
          agentDefaultEnv
        );
        setAgentPermissionMode({
          agentDefaultArgs: applied.args,
          agentDefaultEnv: applied.env,
          mode: next,
        }).catch(() => undefined);
      }}
      options={PERMISSION_MODE_OPTIONS.map(({ value, labelKey }) => ({
        value,
        label: t(labelKey),
      }))}
      triggerWidth="w-[140px]"
      value={agentPermissionMode}
    />
  );
}

function AgentStatusHooksRow() {
  const t = useT();
  const enabled = useAgentPreferencesStore((s) => s.agentStatusHooks);
  const setEnabled = useAgentPreferencesStore((s) => s.setAgentStatusHooks);
  return (
    <SwitchRow
      checked={enabled}
      description={t("settings.agents.statusHooks.description")}
      id="agent-status-hooks"
      label={t("settings.agents.statusHooks.label")}
      onCheckedChange={(next) => {
        setEnabled(next).catch((err: unknown) => {
          showAppAlert({
            body: err instanceof Error ? err.message : String(err),
            title: t("settings.agents.statusHooks.failed"),
          }).catch(() => undefined);
        });
      }}
    />
  );
}

function AgentListCard() {
  const t = useT();
  const detectedIds = useAgentDetectStore((s) => s.detectedIds);
  const detectedIdSet = new Set(detectedIds);
  const orderedEntries = AGENT_CATALOG.map((entry, index) => ({
    entry,
    index,
  }))
    .sort((left, right) => {
      const leftRank = detectedIdSet.has(left.entry.id) ? 0 : 1;
      const rightRank = detectedIdSet.has(right.entry.id) ? 0 : 1;
      return leftRank - rightRank || left.index - right.index;
    })
    .map(({ entry }) => entry);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.agents.list.title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-0">
        <ItemGroup className="gap-0">
          {orderedEntries.map((entry, index) => (
            <Fragment key={entry.id}>
              {index > 0 ? (
                <ItemSeparator className="mx-(--card-spacing) my-0 data-horizontal:w-auto" />
              ) : null}
              <AgentRow agentId={entry.id} />
            </Fragment>
          ))}
        </ItemGroup>
      </CardContent>
    </Card>
  );
}

/** Page-top actions — mirror plugins: Update all (default) + icon refresh. */
function AgentsToolbar() {
  const t = useT();
  const isRefreshing = useAgentDetectStore((s) => s.isRefreshing);
  const refresh = useAgentDetectStore((s) => s.refresh);
  const isProbing = useAgentLifecycleStore((s) => s.isProbing);
  const updatingAll = useAgentLifecycleStore((s) =>
    Object.values(s.jobById).some((j) => j?.action === "update")
  );
  const probeLifecycle = useAgentLifecycleStore((s) => s.probe);
  const runMany = useAgentLifecycleStore((s) => s.runMany);
  // Primitive count only — never select updatableIds() (new array → infinite re-render).
  const disabledAgentIds = useAgentPreferencesStore((s) => s.disabledAgentIds);
  const disabledSet = useMemo(
    () => new Set(disabledAgentIds),
    [disabledAgentIds]
  );
  const updatableCount = useAgentLifecycleStore((s) => {
    let n = 0;
    for (const probe of Object.values(s.probesById)) {
      if (
        probe &&
        !disabledSet.has(probe.agentId) &&
        // Same eligibility as Update all (versioned newer / broken only).
        (probe.updateAvailable === true || probe.installedButBroken === true) &&
        probe.support === "full" &&
        probe.canInstall
      ) {
        n += 1;
      }
    }
    return n;
  });

  const headerBusy = isRefreshing || isProbing || updatingAll;
  const showUpdateAll = updatableCount > 0;

  const handleRefreshAndCheck = useCallback(() => {
    // Still check latest for disabled agents so re-enable shows correct state immediately.
    refresh()
      .then(() => probeLifecycle(undefined, { force: true, checkLatest: true }))
      .then(() => {
        toast.success(t("settings.agents.list.refreshSuccess"));
      })
      .catch((err: unknown) => {
        showAppAlert({
          title: t("settings.agents.list.refreshFailed"),
          body: err instanceof Error ? err.message : String(err),
        });
      });
  }, [probeLifecycle, refresh, t]);

  const handleUpdateAll = useCallback(() => {
    const ids = useAgentLifecycleStore.getState().updatableIds();
    if (ids.length === 0) {
      return;
    }
    runMany(ids, "update")
      .then((results) => {
        const failures = results.filter((r) => !r.ok);
        if (failures.length === 0) {
          toast.success(t("settings.agents.list.updateAllDone"));
          return;
        }
        return showAppAlert({
          title: t("settings.agents.list.updateAllPartial"),
          body: failures
            .map((f) => {
              const code = f.errorCode ?? "command_failed";
              const msg = t(`settings.agents.lifecycle.errors.${code}`);
              const detail = f.errorDetail?.trim();
              return detail
                ? `${f.agentId}: ${msg} (${detail})`
                : `${f.agentId}: ${msg}`;
            })
            .join("\n"),
        });
      })
      .catch((err: unknown) => {
        showAppAlert({
          title: t("settings.agents.list.updateAllPartial"),
          body: err instanceof Error ? err.message : String(err),
        });
      });
  }, [runMany, t]);

  return (
    <div className="flex shrink-0 items-center gap-2">
      {showUpdateAll ? (
        <Button
          disabled={headerBusy}
          onClick={handleUpdateAll}
          size="sm"
          type="button"
          variant="default"
        >
          {updatingAll ? (
            <Loader2
              aria-hidden
              className="animate-spin"
              data-icon="inline-start"
            />
          ) : null}
          {t("settings.agents.list.updateAll")}
          {updatableCount > 0 ? ` (${updatableCount})` : ""}
        </Button>
      ) : null}
      <TooltipProvider delayDuration={0} disableHoverableContent>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={t("settings.agents.list.refresh")}
              disabled={headerBusy}
              onClick={handleRefreshAndCheck}
              size="icon-sm"
              type="button"
              variant="outline"
            >
              <RefreshCw
                aria-hidden
                className={cn(headerBusy && !updatingAll && "animate-spin")}
                data-icon="inline-start"
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("settings.agents.list.refresh")}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

export function AgentsSection() {
  const t = useT();
  const ensureDetected = useAgentDetectStore((s) => s.ensureDetected);
  const probeLifecycle = useAgentLifecycleStore((s) => s.probe);

  useEffect(() => {
    // Check latest for all agents (including disabled) so re-enable is instant.
    // Disabled rows hide update UI / counts only.
    ensureDetected()
      .then(() => probeLifecycle(undefined, { checkLatest: true }))
      .catch(() => undefined);
  }, [ensureDetected, probeLifecycle]);

  return (
    <div className="px-4 pb-4" id="agents">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-xl">{t("settings.section.agents")}</h1>
        <AgentsToolbar />
      </div>
      <div className="flex flex-col gap-4">
        <Card>
          <CardContent>
            <FieldSet>
              <Field>
                <FieldLabel>{t("settings.row.defaultAgent")}</FieldLabel>
                <DefaultAgentPicker />
              </Field>
              <FieldSeparator />
              <PermissionModeRow />
              <FieldSeparator />
              <AgentStatusHooksRow />
            </FieldSet>
          </CardContent>
        </Card>
        <AgentListCard />
      </div>
    </div>
  );
}
