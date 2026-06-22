import { useT } from "@/i18n/use-t.ts";
import { SelectRow } from "@/pages/settings/components/rows/select-row.tsx";
import {
  LOCALE_OPTIONS,
  type LocaleValue,
} from "@/pages/settings/data/locales.ts";
import { useLocaleStore } from "@/stores/locale.store.ts";

export function LanguageRow() {
  const t = useT();
  const language = useLocaleStore((s) => s.language);
  const setLanguage = useLocaleStore((s) => s.setLanguage);
  return (
    <SelectRow<LocaleValue>
      description={t("settings.row.languageDesc")}
      id="settings-locale"
      label={t("settings.row.language")}
      onChange={(v) => {
        setLanguage(v).catch(() => undefined);
      }}
      options={LOCALE_OPTIONS.map((o) => ({
        value: o.value,
        label: t(`settings.locale.${o.value}`),
      }))}
      value={language}
    />
  );
}
