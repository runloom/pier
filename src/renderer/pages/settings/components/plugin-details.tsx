import { Badge } from "@pier/ui/badge.tsx";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { useT } from "@/i18n/use-t.ts";
import {
  resolvePluginCommandDisplay,
  resolvePluginPanelDisplay,
  resolvePluginTerminalStatusItemDisplay,
} from "@/lib/plugins/display.ts";
import { ContributionTable } from "./contribution-table.tsx";

export interface CommandContributionRow {
  category?: string;
  id: string;
  title: string;
}

export interface PanelContributionRow {
  description?: string;
  id: string;
  title: string;
}

export type TerminalStatusContributionRow = PanelContributionRow;

export function commandContributionRows(
  entry: PluginRegistryEntry,
  locale: string
): CommandContributionRow[] {
  return entry.manifest.commands.map((command) => {
    const display = resolvePluginCommandDisplay(
      entry.manifest,
      command,
      locale
    );
    return {
      id: command.id,
      title: display.title,
      ...(display.category ? { category: display.category } : {}),
    };
  });
}

export function panelContributionRows(
  entry: PluginRegistryEntry,
  locale: string
): PanelContributionRow[] {
  return entry.manifest.panels.map((panel) => {
    const display = resolvePluginPanelDisplay(entry.manifest, panel, locale);
    return {
      id: panel.id,
      title: display.title,
      ...(display.description ? { description: display.description } : {}),
    };
  });
}

export function terminalStatusContributionRows(
  entry: PluginRegistryEntry,
  locale: string
): TerminalStatusContributionRow[] {
  return entry.manifest.terminalStatusItems.map((item) => {
    const display = resolvePluginTerminalStatusItemDisplay(
      entry.manifest,
      item,
      locale
    );
    return {
      id: item.id,
      title: display.title,
      ...(display.description ? { description: display.description } : {}),
    };
  });
}

function countLabel(
  count: number,
  singularKey: string,
  pluralKey: string,
  t: ReturnType<typeof useT>
): string | null {
  if (count === 0) {
    return null;
  }
  return t(count === 1 ? singularKey : pluralKey, { count });
}

export function contributionSummary(
  entry: PluginRegistryEntry,
  t: ReturnType<typeof useT>
) {
  const parts = [
    countLabel(
      entry.manifest.commands.length,
      "settings.plugins.contributionSummary.command",
      "settings.plugins.contributionSummary.commands",
      t
    ),
    countLabel(
      entry.manifest.panels.length,
      "settings.plugins.contributionSummary.panel",
      "settings.plugins.contributionSummary.panels",
      t
    ),
    countLabel(
      entry.manifest.terminalStatusItems.length,
      "settings.plugins.contributionSummary.terminalStatusItem",
      "settings.plugins.contributionSummary.terminalStatusItems",
      t
    ),
  ].filter(Boolean);
  return parts.length > 0
    ? parts.join(" · ")
    : t("settings.plugins.contributionSummary.none");
}

function permissionLabel(
  permission: string,
  t: ReturnType<typeof useT>
): string {
  return t(`settings.plugins.permissionLabels.${permission}`, {
    defaultValue: permission,
    nsSeparator: false,
  });
}

function isHttpUrl(value: string): boolean {
  return value.startsWith("https://") || value.startsWith("http://");
}

interface PluginMetaRow {
  href?: string;
  label: string;
  value: string;
}

function pluginMetaRows(
  entry: PluginRegistryEntry,
  t: ReturnType<typeof useT>
): PluginMetaRow[] {
  const rows: PluginMetaRow[] = [
    { label: t("settings.plugins.pluginId"), value: entry.manifest.id },
    { label: t("settings.plugins.version"), value: entry.manifest.version },
    {
      label: t("settings.plugins.publisher"),
      value: entry.manifest.publisher ?? t("settings.plugins.none"),
    },
  ];
  if (entry.manifest.homepage) {
    rows.push({
      label: t("settings.plugins.homepage"),
      value: entry.manifest.homepage,
      ...(isHttpUrl(entry.manifest.homepage)
        ? { href: entry.manifest.homepage }
        : {}),
    });
  }
  if (entry.manifest.repository) {
    rows.push({
      label: t("settings.plugins.repository"),
      value: entry.manifest.repository,
      ...(isHttpUrl(entry.manifest.repository)
        ? { href: entry.manifest.repository }
        : {}),
    });
  }
  return rows;
}

function PluginMeta({ entry }: { entry: PluginRegistryEntry }) {
  const t = useT();
  return (
    <div className="grid gap-2 text-xs sm:grid-cols-3">
      {pluginMetaRows(entry, t).map((row) => (
        <div className="min-w-0" key={row.label}>
          <div className="font-medium text-muted-foreground">{row.label}</div>
          {row.href ? (
            <a
              className="inline-flex max-w-full items-center gap-1 text-primary hover:underline"
              href={row.href}
              rel="noreferrer"
              target="_blank"
              title={row.value}
            >
              <span className="truncate">{row.value}</span>
              <ExternalLink aria-hidden className="size-3 shrink-0" />
            </a>
          ) : (
            <div className="truncate" title={row.value}>
              {row.value}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ContributionTableSection({
  headers,
  rows,
  title,
}: {
  headers: string[];
  rows: ReactNode[][];
  title: string;
}) {
  if (rows.length === 0) {
    return null;
  }
  return (
    <div className="min-w-0">
      <div className="mb-1 font-medium text-muted-foreground">{title}</div>
      <ContributionTable headers={headers} rows={rows} />
    </div>
  );
}

function idCell(id: string): ReactNode {
  return (
    <code className="whitespace-nowrap font-mono" key={`${id}-id`}>
      {id}
    </code>
  );
}

export function PluginDetails({
  commandContributions,
  entry,
  panelContributions,
  terminalStatusContributions,
}: {
  commandContributions: CommandContributionRow[];
  entry: PluginRegistryEntry;
  panelContributions: PanelContributionRow[];
  terminalStatusContributions: TerminalStatusContributionRow[];
}) {
  const t = useT();
  const commandRows: ReactNode[][] = commandContributions.map((row) => [
    row.title,
    idCell(row.id),
    row.category ?? "",
  ]);
  const panelRows: ReactNode[][] = panelContributions.map((row) => [
    row.title,
    idCell(row.id),
    row.description ?? "",
  ]);
  const terminalStatusRows: ReactNode[][] = terminalStatusContributions.map(
    (row) => [row.title, idCell(row.id), row.description ?? ""]
  );

  return (
    <div className="basis-full space-y-4 border-border/60 border-t pt-3 text-xs">
      <PluginMeta entry={entry} />
      <ContributionTableSection
        headers={[
          t("settings.plugins.table.title"),
          t("settings.plugins.table.id"),
          t("settings.plugins.table.category"),
        ]}
        rows={commandRows}
        title={t("settings.plugins.commands")}
      />
      <ContributionTableSection
        headers={[
          t("settings.plugins.table.title"),
          t("settings.plugins.table.id"),
          t("settings.plugins.table.description"),
        ]}
        rows={panelRows}
        title={t("settings.plugins.panels")}
      />
      <ContributionTableSection
        headers={[
          t("settings.plugins.table.title"),
          t("settings.plugins.table.id"),
          t("settings.plugins.table.description"),
        ]}
        rows={terminalStatusRows}
        title={t("settings.plugins.terminalStatusItems")}
      />
      <div className="min-w-0">
        <div className="mb-1 font-medium text-muted-foreground">
          {t("settings.plugins.permissions")}
        </div>
        <div className="flex flex-wrap gap-1">
          {entry.effectivePermissions.length > 0 ? (
            entry.effectivePermissions.map((permission) => (
              <Badge key={permission} title={permission} variant="outline">
                {permissionLabel(permission, t)}
              </Badge>
            ))
          ) : (
            <span className="text-muted-foreground">
              {t("settings.plugins.none")}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
