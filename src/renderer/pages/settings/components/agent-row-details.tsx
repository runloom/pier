import { Separator } from "@pier/ui/separator.tsx";
import { getAgentCatalogEntry } from "@shared/agent-catalog.ts";
import {
  type AgentKind,
  resolveEffectiveAgentDefaultArgs,
  resolveEffectiveAgentDefaultEnv,
} from "@shared/contracts/agent.ts";
import { useState } from "react";
import { useT } from "@/i18n/use-t.ts";
import { InputRow } from "@/pages/settings/components/rows/input-row.tsx";
import { useAgentLifecycleStore } from "@/stores/agent-lifecycle.store.ts";
import { useAgentPreferencesStore } from "@/stores/agent-preferences.store.ts";

function useDraft(
  persisted: string
): [string, (v: string) => void, (v: string) => void] {
  const [draft, setDraft] = useState(persisted);
  const [prev, setPrev] = useState(persisted);
  if (persisted !== prev) {
    setPrev(persisted);
    setDraft(persisted);
  }
  return [draft, setDraft, setPrev];
}

export function AgentExpandedDetails({ agentId }: { agentId: AgentKind }) {
  const t = useT();
  const entry = getAgentCatalogEntry(agentId);
  const agentCommandOverrides = useAgentPreferencesStore(
    (s) => s.agentCommandOverrides
  );
  const agentDefaultArgs = useAgentPreferencesStore((s) => s.agentDefaultArgs);
  const agentDefaultEnv = useAgentPreferencesStore((s) => s.agentDefaultEnv);
  const agentInstallCommands = useAgentPreferencesStore(
    (s) => s.agentInstallCommands
  );
  const agentUpdateCommands = useAgentPreferencesStore(
    (s) => s.agentUpdateCommands
  );
  const agentPermissionMode = useAgentPreferencesStore(
    (s) => s.agentPermissionMode
  );
  const setAgentCommandOverrides = useAgentPreferencesStore(
    (s) => s.setAgentCommandOverrides
  );
  const setAgentDefaultArgs = useAgentPreferencesStore(
    (s) => s.setAgentDefaultArgs
  );
  const setAgentInstallCommands = useAgentPreferencesStore(
    (s) => s.setAgentInstallCommands
  );
  const setAgentUpdateCommands = useAgentPreferencesStore(
    (s) => s.setAgentUpdateCommands
  );
  const probe = useAgentLifecycleStore((s) => s.probesById[agentId]);

  const persistedCmd = agentCommandOverrides[agentId] ?? "";
  const persistedArgs = resolveEffectiveAgentDefaultArgs(
    agentId,
    agentDefaultArgs,
    agentPermissionMode
  );
  const persistedInstall = agentInstallCommands[agentId] ?? "";
  const persistedUpdate = agentUpdateCommands[agentId] ?? "";
  const defaultInstall =
    probe?.defaultInstallCommand?.trim() ||
    probe?.guideCommands?.[0]?.command ||
    "";
  const defaultUpdate = probe?.defaultUpdateCommand?.trim() || "";

  const effectiveEnv = resolveEffectiveAgentDefaultEnv(
    agentId,
    agentDefaultEnv,
    agentPermissionMode
  );
  const envText = Object.entries(effectiveEnv)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");

  const [cmdDraft, setCmdDraft] = useDraft(persistedCmd);
  const [argsDraft, setArgsDraft] = useDraft(persistedArgs);
  const [installDraft, setInstallDraft] = useDraft(persistedInstall);
  const [updateDraft, setUpdateDraft] = useDraft(persistedUpdate);

  if (!entry) {
    return null;
  }

  const saveOverride = (
    value: string,
    current: Partial<Record<AgentKind, string>>,
    setNext: (next: Partial<Record<AgentKind, string>>) => Promise<void>
  ): void => {
    const next = { ...current };
    if (value.trim() === "") {
      delete next[agentId];
    } else {
      next[agentId] = value.trim();
    }
    setNext(next).catch(() => undefined);
  };

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
            saveOverride(
              value,
              agentCommandOverrides,
              setAgentCommandOverrides
            );
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
        <InputRow
          description={t("settings.agents.row.installCommandDesc")}
          id={`agent-install-cmd-${agentId}`}
          label={t("settings.agents.row.installCommand")}
          onBlur={(value) => {
            saveOverride(value, agentInstallCommands, setAgentInstallCommands);
          }}
          onChange={setInstallDraft}
          placeholder={
            defaultInstall || t("settings.agents.row.installCommandPlaceholder")
          }
          value={installDraft}
        />
        <InputRow
          description={t("settings.agents.row.updateCommandDesc")}
          id={`agent-update-cmd-${agentId}`}
          label={t("settings.agents.row.updateCommand")}
          onBlur={(value) => {
            saveOverride(value, agentUpdateCommands, setAgentUpdateCommands);
          }}
          onChange={setUpdateDraft}
          placeholder={
            defaultUpdate ||
            defaultInstall ||
            t("settings.agents.row.updateCommandPlaceholder")
          }
          value={updateDraft}
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
