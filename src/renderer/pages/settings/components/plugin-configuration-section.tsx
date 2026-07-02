import { Badge } from "@pier/ui/badge.tsx";
import { Button } from "@pier/ui/button.tsx";
import { Card, CardContent } from "@pier/ui/card.tsx";
import { FieldSeparator, FieldSet } from "@pier/ui/field.tsx";
import type {
  PluginConfigurationProperty,
  PluginRegistryEntry,
} from "@shared/contracts/plugin.ts";
import type { JsonValue } from "@shared/contracts/plugin-settings.ts";
import { effectiveConfigurationValue } from "@shared/plugin-settings.ts";
import i18next from "i18next";
import { RotateCcw } from "lucide-react";
import { Fragment, type ReactNode, useState } from "react";
import { toast } from "sonner";
import { useT } from "@/i18n/use-t.ts";
import {
  resolvePluginConfigurationTitle,
  resolvePluginSettingDisplay,
} from "@/lib/plugins/display.ts";
import { InputRow } from "@/pages/settings/components/rows/input-row.tsx";
import { SelectRow } from "@/pages/settings/components/rows/select-row.tsx";
import { SwitchRow } from "@/pages/settings/components/rows/switch-row.tsx";
import { usePluginRegistryStore } from "@/stores/plugin-registry.store.ts";
import { usePluginSettingsStore } from "@/stores/plugin-settings.store.ts";

/** 组内排序：order 升序（缺省按 key 字典序垫底），同 order 按 key 字典序。 */
export function sortedConfigurationKeys(
  properties: Record<string, PluginConfigurationProperty>
): string[] {
  return Object.keys(properties).sort((a, b) => {
    const orderA = properties[a]?.order ?? Number.MAX_SAFE_INTEGER;
    const orderB = properties[b]?.order ?? Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) {
      return orderA - orderB;
    }
    return a.localeCompare(b);
  });
}

async function writeSetting(
  key: string,
  value: JsonValue,
  failedText: string
): Promise<void> {
  try {
    await usePluginSettingsStore.getState().set(key, value);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    toast.error(failedText, { description: message });
  }
}

function SettingRowShell({
  children,
  modified,
  modifiedLabel,
  onReset,
  resetLabel,
}: {
  children: ReactNode;
  modified: boolean;
  modifiedLabel: string;
  onReset: () => void;
  resetLabel: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">{children}</div>
      {modified ? (
        <>
          <Badge variant="secondary">{modifiedLabel}</Badge>
          <Button
            aria-label={resetLabel}
            onClick={onReset}
            size="xs"
            title={resetLabel}
            type="button"
            variant="ghost"
          >
            <RotateCcw />
          </Button>
        </>
      ) : null}
    </div>
  );
}

function StringSettingRow({
  description,
  effective,
  id,
  label,
  max,
  min,
  onCommit,
  type,
}: {
  description?: string | undefined;
  effective: string;
  id: string;
  label: string;
  max?: number | undefined;
  min?: number | undefined;
  /** 返回 clamp/规整后的最终值，供输入框无条件回弹展示。 */
  onCommit: (raw: string) => string;
  type: "number" | "text";
}) {
  const [draft, setDraft] = useState(effective);
  const [prev, setPrev] = useState(effective);
  if (effective !== prev) {
    setPrev(effective);
    setDraft(effective);
  }
  return (
    <InputRow
      {...(description === undefined ? {} : { description })}
      id={id}
      inputClassName="w-[180px]"
      label={label}
      {...(max === undefined ? {} : { max })}
      {...(min === undefined ? {} : { min })}
      onBlur={(raw) => setDraft(onCommit(raw))}
      onChange={setDraft}
      type={type}
      value={draft}
    />
  );
}

function numberFromDraft(
  raw: string,
  property: PluginConfigurationProperty,
  fallback: number
): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const floored =
    property.minimum === undefined
      ? parsed
      : Math.max(property.minimum, parsed);
  return property.maximum === undefined
    ? floored
    : Math.min(property.maximum, floored);
}

function PluginSettingRow({
  entry,
  property,
  settingKey,
}: {
  entry: PluginRegistryEntry;
  property: PluginConfigurationProperty;
  settingKey: string;
}) {
  const t = useT();
  const userValue = usePluginSettingsStore((s) => s.values[settingKey]);
  const display = resolvePluginSettingDisplay(
    entry.manifest,
    settingKey,
    i18next.language
  );
  const effective = effectiveConfigurationValue(property, userValue);
  const modified =
    userValue !== undefined &&
    JSON.stringify(effective) !== JSON.stringify(property.default);
  const failedText = t("settings.pluginConfiguration.writeFailed");
  const rowId = `plugin-setting-${settingKey}`;

  let control: ReactNode;
  if (property.type === "boolean") {
    control = (
      <SwitchRow
        checked={effective === true}
        description={display.description}
        id={rowId}
        label={display.label}
        onCheckedChange={(next) => writeSetting(settingKey, next, failedText)}
      />
    );
  } else if (property.enum) {
    control = (
      <SelectRow<string>
        description={display.description}
        id={rowId}
        label={display.label}
        onChange={(next) => writeSetting(settingKey, next, failedText)}
        options={property.enum.map((value, index) => ({
          label: display.enumDescriptions?.[index] ?? value,
          value,
        }))}
        triggerWidth="w-[180px]"
        value={String(effective)}
      />
    );
  } else if (property.type === "number") {
    control = (
      <StringSettingRow
        description={display.description}
        effective={String(effective)}
        id={rowId}
        label={display.label}
        max={property.maximum}
        min={property.minimum}
        onCommit={(raw) => {
          const next = numberFromDraft(raw, property, Number(effective));
          if (next !== effective) {
            writeSetting(settingKey, next, failedText);
          }
          return String(next);
        }}
        type="number"
      />
    );
  } else {
    control = (
      <StringSettingRow
        description={display.description}
        effective={String(effective)}
        id={rowId}
        label={display.label}
        onCommit={(raw) => {
          if (raw !== effective) {
            writeSetting(settingKey, raw, failedText);
          }
          return raw;
        }}
        type="text"
      />
    );
  }

  return (
    <SettingRowShell
      modified={modified}
      modifiedLabel={t("settings.pluginConfiguration.modified")}
      onReset={() => {
        usePluginSettingsStore
          .getState()
          .reset(settingKey)
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            toast.error(failedText, { description: message });
          });
      }}
      resetLabel={t("settings.pluginConfiguration.resetToDefault")}
    >
      {control}
    </SettingRowShell>
  );
}

export function PluginConfigurationSection({ pluginId }: { pluginId: string }) {
  const entry = usePluginRegistryStore((s) =>
    s.plugins.find((item) => item.manifest.id === pluginId)
  );
  const configuration = entry?.manifest.configuration;
  if (!(entry && configuration)) {
    // 插件在本 section 激活期间被禁用 — settings-dialog 的 fallback effect 会切走。
    return null;
  }
  const keys = sortedConfigurationKeys(configuration.properties);
  return (
    <div className="px-4 pb-4" id={`plugin-configuration-${pluginId}`}>
      <h1 className="mb-4 text-xl">
        {resolvePluginConfigurationTitle(entry, i18next.language)}
      </h1>
      <Card>
        <CardContent>
          <FieldSet>
            {keys.map((settingKey, index) => {
              const property = configuration.properties[settingKey];
              if (!property) {
                return null;
              }
              return (
                <Fragment key={settingKey}>
                  {index > 0 ? <FieldSeparator /> : null}
                  <PluginSettingRow
                    entry={entry}
                    property={property}
                    settingKey={settingKey}
                  />
                </Fragment>
              );
            })}
          </FieldSet>
        </CardContent>
      </Card>
    </div>
  );
}
