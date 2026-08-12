import { useState } from "react";
import { useT } from "@/i18n/use-t.ts";
import { reportFontPreferenceUpdateFailure } from "@/pages/settings/components/rows/font-update-error.ts";
import { InputRow } from "@/pages/settings/components/rows/input-row.tsx";
import { useFontStore } from "@/stores/font.store.ts";

export function UiFontRow() {
  const t = useT();
  const persisted = useFontStore((s) => s.uiFontFamily);
  const setUiFontFamily = useFontStore((s) => s.setUiFontFamily);
  const [draft, setDraft] = useState(persisted);
  const failedTitle = t("settings.row.fontUpdateFailed");

  // 跟随 store 外部变更 (如 IPC broadcast)
  const [prev, setPrev] = useState(persisted);
  if (persisted !== prev) {
    setPrev(persisted);
    setDraft(persisted);
  }

  return (
    <InputRow
      description={t("settings.row.uiFontFamilyDesc")}
      id="settings-ui-font"
      label={t("settings.row.uiFontFamily")}
      onBlur={() => {
        if (draft !== persisted) {
          setUiFontFamily(draft).catch((err) => {
            reportFontPreferenceUpdateFailure(failedTitle, err);
          });
        }
      }}
      onChange={setDraft}
      placeholder={t("settings.row.uiFontFamilyPlaceholder")}
      value={draft}
    />
  );
}
