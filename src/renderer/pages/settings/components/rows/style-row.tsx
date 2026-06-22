import type { StylePresetId } from "@shared/contracts/preferences.ts";
import { useT } from "@/i18n/use-t.ts";
import { STYLE_PRESET_OPTIONS } from "@/pages/settings/data/style-presets.ts";
import { useThemeStore } from "@/stores/theme.store.ts";
import { SelectRow } from "./select-row.tsx";

export function StyleRow() {
  const t = useT();
  const stylePresetId = useThemeStore((s) => s.stylePresetId);
  const setStylePreset = useThemeStore((s) => s.setStylePreset);
  return (
    <SelectRow<StylePresetId>
      description={t("settings.row.stylePresetDesc")}
      id="settings-style"
      label={t("settings.row.stylePreset")}
      onChange={(v) => {
        setStylePreset(v).catch(() => undefined);
      }}
      options={STYLE_PRESET_OPTIONS.map((o) => ({
        value: o.value,
        label: t(o.labelKey),
      }))}
      triggerWidth="w-[180px]"
      value={stylePresetId}
    />
  );
}
