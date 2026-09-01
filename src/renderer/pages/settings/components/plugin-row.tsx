import { Badge } from "@pier/ui/badge.tsx";
import { Button } from "@pier/ui/button.tsx";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@pier/ui/item.tsx";
import { Skeleton } from "@pier/ui/skeleton.tsx";
import { Switch } from "@pier/ui/switch.tsx";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import i18next from "i18next";
import { Settings } from "lucide-react";
import type { ReactNode } from "react";
import { useT } from "@/i18n/use-t.ts";
import { resolvePluginDisplay } from "@/lib/plugins/display.ts";
import { resolvePluginIcon } from "@/lib/plugins/resolve-icon.tsx";
import {
  pluginHasSettingsSection,
  pluginSectionId,
} from "@/pages/settings/data/appearance-nav.ts";
import { useSettingsDialogStore } from "@/stores/settings-dialog.store.ts";

/**
 * Capability ids contain `:` (`file:read`). i18next's default nsSeparator is
 * also `:`, so interpolating the id into a key string splits the lookup.
 * Read the labels map as an object and index it instead.
 */
export function capabilityPermissionLabel(
  t: ReturnType<typeof useT>,
  capability: string
): string {
  const labels: unknown = t("settings.plugins.permissionLabels", {
    nsSeparator: false,
    returnObjects: true,
  });
  if (typeof labels !== "object" || labels === null) {
    return capability;
  }
  const value = Object.hasOwn(labels, capability)
    ? Reflect.get(labels, capability)
    : undefined;
  return typeof value === "string" && value.length > 0 ? value : capability;
}

function PluginSettingsButton({
  name,
  pluginId,
}: {
  name: string;
  pluginId: string;
}): ReactNode {
  const t = useT();
  return (
    <Button
      aria-label={t("settings.plugins.openSettingsPlugin", { name })}
      data-testid={`plugin-settings-link-${pluginId}`}
      onClick={() =>
        useSettingsDialogStore.getState().openSection(pluginSectionId(pluginId))
      }
      size="icon-sm"
      type="button"
      variant="ghost"
    >
      <Settings aria-hidden data-icon="inline-start" />
    </Button>
  );
}

export function PluginEnableSwitch({
  checked,
  disabled,
  name,
  onToggle,
}: {
  checked: boolean;
  disabled: boolean;
  name: string;
  onToggle(): void;
}): ReactNode {
  return (
    <Switch
      aria-label={name}
      checked={checked}
      disabled={disabled}
      onCheckedChange={() => onToggle()}
    />
  );
}

export function PluginRow({
  entry,
  onToggle,
  pending,
  extraActions,
}: {
  entry: PluginRegistryEntry;
  onToggle(entry: PluginRegistryEntry): void;
  pending: boolean;
  extraActions?: ReactNode;
}) {
  const t = useT();
  const canToggle = entry.runtime.canToggle;
  const display = resolvePluginDisplay(entry, i18next.language);
  const RowIcon = resolvePluginIcon(entry.manifest.id);
  const isManifestOnly = entry.runtime.kind === "manifest-only";
  const metaText = `v${entry.manifest.version} · ${entry.manifest.publisher ?? "—"}`;
  const hasSettingsSection = pluginHasSettingsSection(entry);
  const hasActions = Boolean(hasSettingsSection || extraActions || canToggle);

  return (
    <Item
      className="rounded-none border-0 px-(--card-spacing)"
      data-testid={`plugin-row-${entry.manifest.id}`}
      role="listitem"
    >
      <ItemContent className="min-w-0 gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <ItemTitle className="min-w-0 max-w-full">
            <RowIcon
              aria-hidden
              className="size-4 shrink-0 text-muted-foreground"
            />
            <span className="truncate">{display.name}</span>
            {isManifestOnly ? (
              <Badge variant="outline">
                {t("settings.plugins.status.manifestOnly")}
              </Badge>
            ) : null}
          </ItemTitle>
          <span className="shrink-0 text-muted-foreground text-xs">
            {metaText}
          </span>
        </div>
        {display.description ? (
          <ItemDescription className="text-xs">
            {display.description}
          </ItemDescription>
        ) : null}
      </ItemContent>
      {hasActions ? (
        <ItemActions className="shrink-0">
          {hasSettingsSection ? (
            <PluginSettingsButton
              name={display.name}
              pluginId={entry.manifest.id}
            />
          ) : null}
          {extraActions}
          {canToggle ? (
            <PluginEnableSwitch
              checked={entry.enabled}
              disabled={pending}
              name={display.name}
              onToggle={() => onToggle(entry)}
            />
          ) : null}
        </ItemActions>
      ) : null}
    </Item>
  );
}

/** Loading skeleton for the plugins list. */
export function PluginsLoadingState() {
  const t = useT();
  return (
    <div
      className="flex flex-col gap-3 px-(--card-spacing) py-3"
      data-testid="plugins-loading"
    >
      <div className="flex flex-col gap-1.5">
        <div className="font-medium text-sm">
          {t("settings.plugins.loadingTitle")}
        </div>
        <div className="text-muted-foreground text-sm">
          {t("settings.plugins.loadingDescription")}
        </div>
      </div>
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-20 w-full" />
    </div>
  );
}
