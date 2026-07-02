import { Button } from "@pier/ui/button.tsx";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { effectiveConfigurationValue } from "@shared/plugin-settings.ts";
import i18next from "i18next";
import { useT } from "@/i18n/use-t.ts";
import { resolvePluginSettingDisplay } from "@/lib/plugins/display.ts";
import { ContributionTable } from "@/pages/settings/components/contribution-table.tsx";
import { sortedConfigurationKeys } from "@/pages/settings/components/plugin-configuration-section.tsx";
import { pluginSectionId } from "@/pages/settings/data/appearance-nav.ts";
import { usePluginSettingsStore } from "@/stores/plugin-settings.store.ts";
import { useSettingsDialogStore } from "@/stores/settings-dialog.store.ts";

/** 详情页只读设置表 — 设置对话框是唯一编辑入口，这里只读 + 跳转。 */
export function PluginSettingsContribution({
  entry,
}: {
  entry: PluginRegistryEntry;
}) {
  const t = useT();
  const values = usePluginSettingsStore((s) => s.values);
  const configuration = entry.manifest.configuration;
  if (!configuration) {
    return null;
  }
  const rows = sortedConfigurationKeys(configuration.properties).flatMap(
    (settingKey) => {
      const property = configuration.properties[settingKey];
      if (!property) {
        return [];
      }
      const display = resolvePluginSettingDisplay(
        entry.manifest,
        settingKey,
        i18next.language
      );
      return [
        [
          display.label,
          String(effectiveConfigurationValue(property, values[settingKey])),
          display.description ?? "",
        ],
      ];
    }
  );
  return (
    <div className="min-w-0 space-y-2">
      <div className="font-medium text-muted-foreground">
        {t("settings.pluginConfiguration.settingsTable")}
      </div>
      <ContributionTable
        headers={[
          t("settings.pluginConfiguration.columns.setting"),
          t("settings.pluginConfiguration.columns.value"),
          t("settings.pluginConfiguration.columns.description"),
        ]}
        rows={rows}
      />
      <Button
        data-testid={`plugin-settings-open-${entry.manifest.id}`}
        disabled={!entry.runtime.enabled}
        onClick={() =>
          useSettingsDialogStore
            .getState()
            .setActiveSection(pluginSectionId(entry.manifest.id))
        }
        size="sm"
        type="button"
        variant="outline"
      >
        {t("settings.pluginConfiguration.openSettings")}
      </Button>
    </div>
  );
}
