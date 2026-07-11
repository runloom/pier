import { Card, CardContent } from "@pier/ui/card.tsx";
import { FieldSet } from "@pier/ui/field.tsx";
import { useState } from "react";
import { useT } from "@/i18n/use-t.ts";
import { InputRow } from "@/pages/settings/components/rows/input-row.tsx";
import { useWorktreePreferencesStore } from "@/stores/worktree-preferences.store.ts";

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

/**
 * 工作区 section: 承载宿主级工作区偏好(worktree 目录等)。它是 host
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
          </FieldSet>
        </CardContent>
      </Card>
    </div>
  );
}
