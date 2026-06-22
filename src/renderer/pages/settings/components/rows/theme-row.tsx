import { useT } from "@/i18n/use-t.ts";
import { SelectRow } from "@/pages/settings/components/rows/select-row.tsx";
import {
  THEME_OPTIONS,
  type ThemeValue,
} from "@/pages/settings/data/theme-options.ts";
import { useThemeStore } from "@/stores/theme.store.ts";

export function ThemeRow() {
  const t = useT();
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  return (
    <SelectRow<ThemeValue>
      description={t("settings.row.themeDesc")}
      id="settings-theme"
      label={t("settings.row.theme")}
      onChange={(v) => {
        setTheme(v).catch(() => undefined);
      }}
      options={THEME_OPTIONS.map((o) => ({
        value: o.value,
        label: t(`settings.theme.${o.value}`),
      }))}
      value={theme}
    />
  );
}
