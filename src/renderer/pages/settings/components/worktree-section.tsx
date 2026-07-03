import { useState } from "react";
import { useT } from "@/i18n/use-t.ts";
import { InputRow } from "@/pages/settings/components/rows/input-row.tsx";
import { useWorktreePreferencesStore } from "@/stores/worktree-preferences.store.ts";

export function WorktreeRootPathRow() {
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
      onEscape={() => setDraft(persisted)}
      placeholder={t("settings.row.worktreeRootPathPlaceholder")}
      value={draft}
    />
  );
}
