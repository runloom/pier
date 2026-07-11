import { Button } from "@pier/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@pier/ui/card.tsx";
import {
  Field,
  FieldLabel,
  FieldSeparator,
  FieldSet,
} from "@pier/ui/field.tsx";
import { ItemGroup, ItemSeparator } from "@pier/ui/item.tsx";
import { Spinner } from "@pier/ui/spinner.tsx";
import { ToggleGroup, ToggleGroupItem } from "@pier/ui/toggle-group.tsx";
import { AGENT_CATALOG, getAgentCatalogEntry } from "@shared/agent-catalog.ts";
import {
  type AgentKind,
  applyPermissionMode,
} from "@shared/contracts/agent.ts";
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
            <Spinner data-icon="inline-start" />
          ) : (
            <RefreshCw data-icon="inline-start" />
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
