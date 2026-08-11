import { FieldSeparator } from "@pier/ui/field.tsx";
import type { DocFontMode } from "@shared/contracts/preferences.ts";
import { useState } from "react";
import { useT } from "@/i18n/use-t.ts";
import { reportFontPreferenceUpdateFailure } from "@/pages/settings/components/rows/font-update-error.ts";
import { InputRow } from "@/pages/settings/components/rows/input-row.tsx";
import { SelectRow } from "@/pages/settings/components/rows/select-row.tsx";
import { useFontStore } from "@/stores/font.store.ts";

/**
 * Appearance: document font mode (follow UI | custom) + optional family input.
 * Consumed by Markdown preview body and docs-kind canvas reading surfaces.
 */
export function DocFontRow() {
  const t = useT();
  const docFontMode = useFontStore((s) => s.docFontMode);
  const setDocFontMode = useFontStore((s) => s.setDocFontMode);
  const persistedFamily = useFontStore((s) => s.docFontFamily);
  const setDocFontFamily = useFontStore((s) => s.setDocFontFamily);
  const [draft, setDraft] = useState(persistedFamily);
  const failedTitle = t("settings.row.fontUpdateFailed");

  const [prev, setPrev] = useState(persistedFamily);
  if (persistedFamily !== prev) {
    setPrev(persistedFamily);
    setDraft(persistedFamily);
  }

  return (
    <>
      <SelectRow<DocFontMode>
        description={t("settings.row.docFontModeDesc")}
        id="settings-doc-font-mode"
        label={t("settings.row.docFontMode")}
        onChange={(next) => {
          setDocFontMode(next).catch((err) => {
            reportFontPreferenceUpdateFailure(failedTitle, err);
          });
        }}
        options={[
          {
            label: t("settings.row.docFontModeUi"),
            value: "ui",
          },
          {
            label: t("settings.row.docFontModeCustom"),
            value: "custom",
          },
        ]}
        triggerWidth="w-[160px]"
        value={docFontMode}
      />
      {docFontMode === "custom" ? (
        <>
          <FieldSeparator />
          <InputRow
            description={t("settings.row.docFontFamilyDesc")}
            id="settings-doc-font-family"
            label={t("settings.row.docFontFamily")}
            onBlur={() => {
              if (draft !== persistedFamily) {
                setDocFontFamily(draft).catch((err) => {
                  reportFontPreferenceUpdateFailure(failedTitle, err);
                });
              }
            }}
            onChange={setDraft}
            placeholder={t("settings.row.docFontFamilyPlaceholder")}
            value={draft}
          />
        </>
      ) : null}
    </>
  );
}
