import { Button } from "@pier/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@pier/ui/card.tsx";
import { FieldSeparator, FieldSet } from "@pier/ui/field.tsx";
import { ItemGroup, ItemSeparator } from "@pier/ui/item.tsx";
import { Spinner } from "@pier/ui/spinner.tsx";
import { AGENT_CATALOG, getAgentCatalogEntry } from "@shared/agent-catalog.ts";
import { applyPermissionMode } from "@shared/contracts/agent.ts";
import { RefreshCw } from "lucide-react";
import { Fragment, useEffect } from "react";
import { AgentIcon } from "@/components/agent-icons/index.tsx";
import { useT } from "@/i18n/use-t.ts";
import { AgentRow } from "@/pages/settings/components/agent-row.tsx";
import { SelectRow } from "@/pages/settings/components/rows/select-row.tsx";
import { SwitchRow } from "@/pages/settings/components/rows/switch-row.tsx";
import { useAgentDetectStore } from "@/stores/agent-detect.store.ts";
import { useAgentPreferencesStore } from "@/stores/agent-preferences.store.ts";

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

  return (
    <fieldset className="flex flex-wrap gap-2">
      <legend className="sr-only">{t("settings.row.defaultAgent")}</legend>
      <button
        aria-pressed={autoIsActive}
        className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors hover:bg-muted aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-primary"
        onClick={() => setDefaultAgentId(null).catch(() => undefined)}
        type="button"
      >
        {t("settings.agents.defaultPick.auto")}
      </button>
      <button
        aria-pressed={isBlank}
        className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors hover:bg-muted aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-primary"
        onClick={() => setDefaultAgentId("blank").catch(() => undefined)}
        type="button"
      >
        {t("settings.agents.defaultPick.blank")}
      </button>
      {activeDetectedIds.map((id) => {
        const entry = getAgentCatalogEntry(id);
        const isActive = defaultAgentId === id;
        return (
          <button
            aria-pressed={isActive}
            className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors hover:bg-muted aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-primary"
            key={id}
            onClick={() => setDefaultAgentId(id).catch(() => undefined)}
            type="button"
          >
            <AgentIcon agentId={id} size={14} />
            {entry?.label ?? id}
          </button>
        );
      })}
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
        setEnabled(next).catch(() => undefined);
      }}
    />
  );
}

function AgentListCard() {
  const t = useT();
  const detectedIds = useAgentDetectStore((s) => s.detectedIds);
  const isRefreshing = useAgentDetectStore((s) => s.isRefreshing);
  const refresh = useAgentDetectStore((s) => s.refresh);
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
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{t("settings.agents.list.title")}</CardTitle>
        <Button
          disabled={isRefreshing}
          onClick={() => refresh().catch(() => undefined)}
          size="sm"
          type="button"
          variant="ghost"
        >
          {isRefreshing ? (
            <Spinner className="size-3.5" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          {t("settings.agents.list.refresh")}
        </Button>
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

export function AgentsSection() {
  const t = useT();
  const ensureDetected = useAgentDetectStore((s) => s.ensureDetected);

  useEffect(() => {
    ensureDetected().catch(() => undefined);
  }, [ensureDetected]);

  return (
    <div className="px-4 pb-4" id="agents">
      <h1 className="mb-4 text-xl">{t("settings.section.agents")}</h1>
      <div className="flex flex-col gap-4">
        <Card>
          <CardContent>
            <FieldSet>
              <div>
                <div className="mb-2 font-medium text-sm">
                  {t("settings.row.defaultAgent")}
                </div>
                <DefaultAgentPicker />
              </div>
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
