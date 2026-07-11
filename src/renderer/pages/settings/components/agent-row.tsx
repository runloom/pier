import { Badge } from "@pier/ui/badge.tsx";
import { Button } from "@pier/ui/button.tsx";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@pier/ui/collapsible.tsx";
import { Item, ItemActions, ItemContent, ItemTitle } from "@pier/ui/item.tsx";
import { Separator } from "@pier/ui/separator.tsx";
import { getAgentCatalogEntry } from "@shared/agent-catalog.ts";
import {
  type AgentKind,
  resolveEffectiveAgentDefaultArgs,
  resolveEffectiveAgentDefaultEnv,
} from "@shared/contracts/agent.ts";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { useState } from "react";
import { AgentIcon } from "@/components/agent-icons/index.tsx";
import { useT } from "@/i18n/use-t.ts";
import { InputRow } from "@/pages/settings/components/rows/input-row.tsx";
import { useAgentDetectStore } from "@/stores/agent-detect.store.ts";
import { useAgentPreferencesStore } from "@/stores/agent-preferences.store.ts";

function AgentExpandedDetails({ agentId }: { agentId: AgentKind }) {
  const t = useT();
  const entry = getAgentCatalogEntry(agentId);
  const agentCommandOverrides = useAgentPreferencesStore(
    (s) => s.agentCommandOverrides
  );
  const agentDefaultArgs = useAgentPreferencesStore((s) => s.agentDefaultArgs);
  const agentDefaultEnv = useAgentPreferencesStore((s) => s.agentDefaultEnv);
  const agentPermissionMode = useAgentPreferencesStore(
    (s) => s.agentPermissionMode
  );
  const setAgentCommandOverrides = useAgentPreferencesStore(
    (s) => s.setAgentCommandOverrides
  );
  const setAgentDefaultArgs = useAgentPreferencesStore(
    (s) => s.setAgentDefaultArgs
  );

  const persistedCmd = agentCommandOverrides[agentId] ?? "";
  const persistedArgs = resolveEffectiveAgentDefaultArgs(
    agentId,
    agentDefaultArgs,
    agentPermissionMode
  );
  const effectiveEnv = resolveEffectiveAgentDefaultEnv(
    agentId,
    agentDefaultEnv,
    agentPermissionMode
  );
  const envText = Object.entries(effectiveEnv)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");

  // Local edit drafts seeded from the store. Re-sync when the persisted value
  // changes externally while mounted (mirrors terminal-section's scrollback row)
  // so a concurrent preference update isn't clobbered by a stale on-blur save.
  const [cmdDraft, setCmdDraft] = useState(persistedCmd);
  const [prevCmd, setPrevCmd] = useState(persistedCmd);
  if (persistedCmd !== prevCmd) {
    setPrevCmd(persistedCmd);
    setCmdDraft(persistedCmd);
  }

  const [argsDraft, setArgsDraft] = useState(persistedArgs);
  const [prevArgs, setPrevArgs] = useState(persistedArgs);
  if (persistedArgs !== prevArgs) {
    setPrevArgs(persistedArgs);
    setArgsDraft(persistedArgs);
  }

  if (!entry) {
    return null;
  }

  return (
    <div className="flex basis-full flex-col gap-4 text-xs">
      <Separator />
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="min-w-0">
          <div className="font-medium text-muted-foreground">
            {t("settings.agents.row.launchCmd")}
          </div>
          <div className="truncate font-mono" title={entry.launchCmd}>
            {entry.launchCmd}
          </div>
        </div>
        <div className="min-w-0">
          <div className="font-medium text-muted-foreground">
            {t("settings.agents.row.detectCmd")}
          </div>
          <div className="truncate font-mono" title={entry.detectCmd}>
            {entry.detectCmd}
          </div>
        </div>
        <div className="min-w-0">
          <div className="font-medium text-muted-foreground">
            {t("settings.agents.row.expectedProcess")}
          </div>
          <div className="truncate font-mono" title={entry.expectedProcess}>
            {entry.expectedProcess}
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <InputRow
          description={t("settings.agents.row.commandOverrideDesc")}
          id={`agent-cmd-override-${agentId}`}
          label={t("settings.agents.row.commandOverride")}
          onBlur={(value) => {
            const next = { ...agentCommandOverrides };
            if (value.trim() === "") {
              delete next[agentId];
            } else {
              next[agentId] = value.trim();
            }
            setAgentCommandOverrides(next).catch(() => undefined);
          }}
          onChange={setCmdDraft}
          placeholder={entry.launchCmd}
          value={cmdDraft}
        />
        <InputRow
          description={t("settings.agents.row.argsDesc")}
          id={`agent-default-args-${agentId}`}
          label={t("settings.agents.row.args")}
          onBlur={(value) => {
            const next = { ...agentDefaultArgs };
            if (value.trim() === "") {
              delete next[agentId];
            } else {
              next[agentId] = value.trim();
            }
            setAgentDefaultArgs(next).catch(() => undefined);
          }}
          onChange={setArgsDraft}
          value={argsDraft}
        />
        {envText ? (
          <div className="grid grid-cols-[1fr_auto] items-center gap-3">
            <div>
              <div className="font-medium text-sm">
                {t("settings.agents.row.env")}
              </div>
              <div className="text-muted-foreground text-sm">
                {t("settings.agents.row.envDesc")}
              </div>
            </div>
            <div className="max-w-[240px] truncate rounded-md border bg-muted/40 px-3 py-1.5 font-mono text-xs">
              {envText}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function resolveStatusLabel(
  isDisabled: boolean,
  isDetected: boolean,
  t: ReturnType<typeof useT>
): string {
  if (!isDetected) {
    return t("settings.agents.status.missing");
  }
  if (isDisabled) {
    return t("settings.agents.status.disabled");
  }
  return t("settings.agents.status.detected");
}

function resolveStatusVariant(
  isDisabled: boolean,
  isDetected: boolean
): "secondary" | "outline" {
  if (!isDisabled && isDetected) {
    return "secondary";
  }
  return "outline";
}

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

  const entry = getAgentCatalogEntry(agentId);
  const isDetected = detectedIds.includes(agentId);
  const isDisabled = disabledAgentIds.includes(agentId);
  const isAvailable = isDetected && !isDisabled;
  const isDefault = isAvailable && defaultAgentId === agentId;
  const canExpand = isDetected;

  const statusLabel = resolveStatusLabel(isDisabled, isDetected, t);
  const statusVariant = resolveStatusVariant(isDisabled, isDetected);

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

  return (
    <Collapsible onOpenChange={setOpen} open={open}>
      <Item
        className="rounded-none border-0 px-(--card-spacing)"
        data-testid={`agent-row-${agentId}`}
        role="listitem"
      >
        <ItemContent className="min-w-0">
          <ItemTitle className="max-w-full">
            <AgentIcon agentId={agentId} size={16} />
            <span className="truncate">{entry?.label ?? agentId}</span>
            <Badge variant={statusVariant}>{statusLabel}</Badge>
            {isDefault ? (
              <Badge variant="secondary">
                {t("settings.agents.action.isDefault")}
              </Badge>
            ) : null}
          </ItemTitle>
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
          {!isDetected && entry?.homepageUrl ? (
            <Button asChild size="icon-sm" variant="outline">
              <a
                aria-label={t("settings.agents.action.website")}
                href={entry.homepageUrl}
                rel="noreferrer"
                target="_blank"
              >
                <ExternalLink data-icon="inline-start" />
              </a>
            </Button>
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
        </ItemActions>

        {open && canExpand ? (
          <CollapsibleContent asChild forceMount>
            <AgentExpandedDetails agentId={agentId} />
          </CollapsibleContent>
        ) : null}
      </Item>
    </Collapsible>
  );
}
