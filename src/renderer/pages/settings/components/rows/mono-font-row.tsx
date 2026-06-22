import { useState } from "react";
import { useT } from "@/i18n/use-t.ts";
import { InputRow } from "@/pages/settings/components/rows/input-row.tsx";
import { useFontStore } from "@/stores/font.store.ts";

export function MonoFontRow() {
  const t = useT();
  const persisted = useFontStore((s) => s.monoFontFamily);
  const setMonoFontFamily = useFontStore((s) => s.setMonoFontFamily);
  const [draft, setDraft] = useState(persisted);

  const [prev, setPrev] = useState(persisted);
  if (persisted !== prev) {
    setPrev(persisted);
    setDraft(persisted);
  }

  return (
    <InputRow
      description={t("settings.row.monoFontFamilyDesc")}
      id="settings-mono-font"
      label={t("settings.row.monoFontFamily")}
      onBlur={() => {
        if (draft !== persisted) {
          setMonoFontFamily(draft).catch(() => undefined);
        }
      }}
      onChange={setDraft}
      placeholder={t("settings.row.monoFontFamilyPlaceholder")}
      value={draft}
    />
  );
}
