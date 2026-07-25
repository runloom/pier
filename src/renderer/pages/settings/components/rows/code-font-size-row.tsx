import { useState } from "react";
import { useT } from "@/i18n/use-t.ts";
import { InputRow } from "@/pages/settings/components/rows/input-row.tsx";
import { useFontStore } from "@/stores/font.store.ts";

const MIN = 8;
const MAX = 32;

function clampToValid(raw: string, fallback: number): number {
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) {
    return fallback;
  }
  return Math.min(MAX, Math.max(MIN, n));
}

export function CodeFontSizeRow() {
  const t = useT();
  const persisted = useFontStore((s) => s.codeFontSize);
  const setCodeFontSize = useFontStore((s) => s.setCodeFontSize);
  const [draft, setDraft] = useState(String(persisted));

  const [prev, setPrev] = useState(persisted);
  if (persisted !== prev) {
    setPrev(persisted);
    setDraft(String(persisted));
  }

  return (
    <InputRow
      description={t("settings.row.codeFontSizeDesc")}
      id="settings-code-font-size"
      inputClassName="w-24"
      inputMode="numeric"
      label={t("settings.row.codeFontSize")}
      max={MAX}
      min={MIN}
      onBlur={(raw) => {
        const next = clampToValid(raw, persisted);
        setDraft(String(next));
        if (next !== persisted) {
          setCodeFontSize(next).catch(() => undefined);
        }
      }}
      onChange={setDraft}
      placeholder={t("settings.row.codeFontSizePlaceholder")}
      step={1}
      type="number"
      value={draft}
    />
  );
}
