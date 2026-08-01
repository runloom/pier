import { Card, CardContent } from "@pier/ui/card.tsx";
import { FieldSeparator, FieldSet } from "@pier/ui/field.tsx";
import type { PanelCloseFocusPolicy } from "@shared/contracts/preferences.ts";
import { useState } from "react";
import { useT } from "@/i18n/use-t.ts";
import { InputRow } from "@/pages/settings/components/rows/input-row.tsx";
import { SelectRow } from "@/pages/settings/components/rows/select-row.tsx";
import { useWorkspacePreferencesStore } from "@/stores/workspace-preferences.store.ts";
import { useWorktreePreferencesStore } from "@/stores/worktree-preferences.store.ts";
import { LspSettingsCard } from "./lsp-settings-card.tsx";

const PANEL_CLOSE_FOCUS_POLICY_OPTIONS = [
  "adjacent",
  "recent",
] satisfies PanelCloseFocusPolicy[];

function WorktreeRootPathRow() {
  const t = useT();
  const persisted = useWorktreePreferencesStore((s) => s.worktreeRootPath);
  const setWorktreeRootPath = useWorktreePreferencesStore(
    (s) => s.setWorktreeRootPath
  );
  const [draft, setDraft] = useState(persisted);
  const [prev, setPrev] = useState(persisted);
  if (persisted !== prev) {
    setPrev(persisted);
    setDraft(persisted);
  }

  return (
    <InputRow
      description={t("settings.row.worktreeRootPathDesc")}
      id="settings-worktree-root-path"
      inputClassName="w-[360px] font-mono"
      label={t("settings.row.worktreeRootPath")}
      onBlur={(raw) => {
        const next = raw.trim();
        setDraft(next);
        if (next !== persisted) {
          setWorktreeRootPath(next).catch(() => undefined);
        }
      }}
      onChange={setDraft}
      placeholder={t("settings.row.worktreeRootPathPlaceholder")}
      value={draft}
    />
  );
}

function PanelCloseFocusPolicyRow() {
  const t = useT();
  const panelCloseFocusPolicy = useWorkspacePreferencesStore(
    (s) => s.panelCloseFocusPolicy
  );
  const setPanelCloseFocusPolicy = useWorkspacePreferencesStore(
    (s) => s.setPanelCloseFocusPolicy
  );

  return (
    <SelectRow<PanelCloseFocusPolicy>
      description={t("settings.row.panelCloseFocusPolicyDesc")}
      id="settings-panel-close-focus-policy"
      label={t("settings.row.panelCloseFocusPolicy")}
      onChange={(next) => {
        setPanelCloseFocusPolicy(next).catch(() => undefined);
      }}
      options={PANEL_CLOSE_FOCUS_POLICY_OPTIONS.map((value) => ({
        value,
        label: t(`settings.panelCloseFocusPolicy.${value}`),
      }))}
      triggerWidth="w-[200px]"
      value={panelCloseFocusPolicy}
    />
  );
}

/**
 * 工作区 section: 承载宿主级工作区偏好(worktree 目录、关标签聚焦等)。它是 host
 * preferences 而非插件设置, 因此不走 PluginConfigurationSection。
 */
export function WorkspaceSection() {
  const t = useT();
  return (
    <div className="px-4 pb-4" id="workspace">
      <h1 className="mb-4 text-xl">{t("settings.section.workspace")}</h1>
      <Card>
        <CardContent>
          <FieldSet>
            <WorktreeRootPathRow />
            <FieldSeparator />
            <PanelCloseFocusPolicyRow />
          </FieldSet>
        </CardContent>
      </Card>
      <div className="mt-4">
        <LspSettingsCard />
      </div>
    </div>
  );
}
