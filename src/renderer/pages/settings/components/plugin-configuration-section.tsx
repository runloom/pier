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
import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";
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

  // unmount 时若草稿"从未经 onCommit 提交过"则 flush 写入, 避免切走面板时静默丢草稿。
  // 用 lastCommittedRef(而非 effective)做判据: blur/Enter 提交后 IPC 未 resolve 时
  // effective(来自 store)还没跟上, 若继续用 draft!==effective 判断会把"刚提交、
  // store 未同步"误判成"从未提交", 导致 unmount cleanup 对同一个值重复 onCommit
  // (多一次 IPC 往返 + 一次全窗口广播)。lastCommittedRef 初始化为当前 effective,
  // 并随 effective 的外部变化(其它窗口广播/reset 等)同步更新 —— 但只在这类外部
  // 变化时同步, 不能被本地未提交的 draft 变化误清空判定。
  // ref 持最新 draft/effective/onCommit, 因为 cleanup 闭包只在挂载时创建一次。
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const lastCommittedRef = useRef(effective);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  if (effective !== prev) {
    // effective 的外部变化(非本地 commit 触发)才应同步 lastCommittedRef,
    // 与上面 prev 的判断复用同一次 effective 变化检测, 避免与本地 commit 写入冲突。
    lastCommittedRef.current = effective;
  }
  useEffect(() => {
    return () => {
      if (draftRef.current !== lastCommittedRef.current) {
        // cleanup 里不能 setState, 只发起提交 IPC。
        onCommitRef.current(draftRef.current);
      }
    };
  }, []);

  return (
    <InputRow
      {...(description === undefined ? {} : { description })}
      id={id}
      inputClassName="w-[180px]"
      label={label}
      {...(max === undefined ? {} : { max })}
      {...(min === undefined ? {} : { min })}
      onBlur={(raw) => {
        const committed = onCommit(raw);
        lastCommittedRef.current = committed;
        setDraft(committed);
      }}
      onChange={setDraft}
      onEscape={() => setDraft(effective)}
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
  // 清空输入框后 trim 为空字符串: Number("")===0 是 finite, 不能当成合法输入走 clamp,
  // 否则会把 min-clamp 值当作用户意图提交。直接回退到当前生效值 (不写入)。
  if (raw.trim() === "") {
    return fallback;
  }
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
  // modified 语义与 usePluginSettingsStore 的持久化语义对齐: values 里只存用户改过的值,
  // 因此 "该 key 是否被用户覆盖" 应直接看 userValue 是否存在, 而不是比较 effective 与 default
  // (覆盖值恰好等于 default 时仍是一次用户写入, 需要展示 Modified/Reset 以便清除幽灵覆盖)。
  const modified = userValue !== undefined;
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
