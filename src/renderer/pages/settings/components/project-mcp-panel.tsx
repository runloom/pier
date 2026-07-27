import { Badge } from "@pier/ui/badge.tsx";
import { Button } from "@pier/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@pier/ui/dropdown-menu.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@pier/ui/item.tsx";
import { Skeleton } from "@pier/ui/skeleton.tsx";
import { AgentIcon } from "@plugins/api/components/agent-icons/index.tsx";
import { getAgentCatalogEntry } from "@shared/agent-catalog.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import type {
  AssetRootRef,
  McpAgentEffectCell,
  McpServerListing,
  McpServerView,
} from "@shared/contracts/agent-assets.ts";
import { Cable, ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "@/i18n/use-t.ts";
import { openAbsoluteInPierEditor } from "@/lib/files/shell-path-actions.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";

function assetRootFor(
  projectRootPath: string,
  isPierHome: boolean
): AssetRootRef {
  return isPierHome ? { scope: "home" } : { scope: "project", projectRootPath };
}

function ScopeBadge({
  scopeLabel,
  t,
}: {
  scopeLabel: McpServerListing["scopeLabel"];
  t: ReturnType<typeof useT>;
}) {
  return (
    <Badge size="xs" variant="outline">
      {scopeLabel === "project"
        ? t("settings.projects.mcpScopeProject")
        : t("settings.projects.mcpScopeUser")}
    </Badge>
  );
}

function agentLabel(agentKind: string): string {
  return getAgentCatalogEntry(agentKind as AgentKind)?.label ?? agentKind;
}

/** Skills-parallel availability strip (`AgentEffectSummary`). */
function McpAvailabilitySummary({
  effects,
  t,
}: {
  effects: readonly McpAgentEffectCell[];
  t: ReturnType<typeof useT>;
}) {
  const discoverable = effects.filter(
    (cell) => cell.effect.state === "discoverable"
  );
  if (discoverable.length === 0) {
    return (
      <span className="text-muted-foreground text-xs">
        {t("settings.projects.mcpAvailableNone")}
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-1">
      {discoverable.map((cell) => (
        <span
          aria-label={agentLabel(cell.agentKind)}
          className="inline-flex size-5 items-center justify-center"
          key={cell.agentKind}
          role="img"
        >
          <AgentIcon agentId={cell.agentKind as AgentKind} size={14} />
        </span>
      ))}
    </span>
  );
}

function normalizeServers(value: unknown): McpServerView[] {
  if (!Array.isArray(value)) return [];
  const out: McpServerView[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const name = "name" in row && typeof row.name === "string" ? row.name : "";
    const listingsRaw =
      "listings" in row && Array.isArray(row.listings) ? row.listings : [];
    if (!name || listingsRaw.length === 0) continue;
    const listings: McpServerListing[] = [];
    for (const item of listingsRaw) {
      if (!item || typeof item !== "object") continue;
      const listing = item as Partial<McpServerListing>;
      if (
        typeof listing.absolutePath !== "string" ||
        typeof listing.agentId !== "string" ||
        typeof listing.agentLabel !== "string" ||
        typeof listing.displayPath !== "string" ||
        typeof listing.entryId !== "string" ||
        (listing.scopeLabel !== "project" && listing.scopeLabel !== "user")
      ) {
        continue;
      }
      listings.push({
        absolutePath: listing.absolutePath,
        agentId: listing.agentId,
        agentLabel: listing.agentLabel,
        displayPath: listing.displayPath,
        entryId: listing.entryId,
        scopeLabel: listing.scopeLabel,
      });
    }
    if (listings.length === 0) continue;
    const effectsRaw =
      "effects" in row && Array.isArray(row.effects) ? row.effects : [];
    const effects: McpAgentEffectCell[] = [];
    for (const item of effectsRaw) {
      if (!item || typeof item !== "object") continue;
      const cell = item as Partial<McpAgentEffectCell>;
      if (typeof cell.agentKind !== "string" || !cell.effect) continue;
      if (cell.effect.state === "discoverable") {
        if (typeof cell.effect.viaRoot !== "string") continue;
        effects.push({
          agentKind: cell.agentKind,
          effect: { state: "discoverable", viaRoot: cell.effect.viaRoot },
        });
      } else if (cell.effect.state === "agent-not-installed") {
        effects.push({
          agentKind: cell.agentKind,
          effect: { state: "agent-not-installed" },
        });
      }
    }
    // Old main without effects: fall back so UI still shows declaring agents.
    const resolvedEffects =
      effects.length > 0
        ? effects
        : listings.map((listing) => ({
            agentKind: listing.agentId,
            effect: {
              state: "discoverable" as const,
              viaRoot: listing.displayPath,
            },
          }));
    out.push({ effects: resolvedEffects, listings, name });
  }
  return out;
}

export function ProjectMcpPanel({
  isPierHome,
  projectRootPath,
}: {
  isPierHome: boolean;
  projectRootPath: string;
}) {
  const t = useT();
  const [servers, setServers] = useState<McpServerView[]>([]);
  const [loading, setLoading] = useState(true);
  /** Old main returns entries only; `servers` is missing until Pier restarts. */
  const [mainNeedsReload, setMainNeedsReload] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const root = assetRootFor(projectRootPath, isPierHome);
    setLoading(true);
    setMainNeedsReload(false);
    window.pier.agentAssets.mcp
      .catalog(root)
      .then((snap) => {
        if (cancelled) return;
        const hasServersField = Array.isArray(snap?.servers);
        setMainNeedsReload(!hasServersField);
        setServers(normalizeServers(snap?.servers));
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setServers([]);
          setMainNeedsReload(false);
        }
        showAppAlert({
          title: t("settings.projects.mcpLoadFailed"),
          body: err instanceof Error ? err.message : String(err),
        }).catch(() => undefined);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectRootPath, isPierHome, t]);

  function openInPier(absolutePath: string, title?: string) {
    const result = openAbsoluteInPierEditor(absolutePath, title);
    if (!result.ok) {
      showAppAlert({
        title: t("settings.projects.mcpActionFailed"),
        body: result.reason,
      }).catch(() => undefined);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (servers.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-muted-foreground text-sm">
          {t("settings.projects.mcpNoticeBody")}
        </p>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Cable />
            </EmptyMedia>
            <EmptyTitle>
              {mainNeedsReload
                ? t("settings.projects.mcpRestartTitle")
                : t("settings.projects.mcpEmptyTitle")}
            </EmptyTitle>
            <EmptyDescription>
              {mainNeedsReload
                ? t("settings.projects.mcpRestartDescription")
                : t("settings.projects.mcpEmptyDescription")}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm">
        {t("settings.projects.mcpNoticeBody")}
      </p>
      <ItemGroup className="gap-2" data-size="sm">
        {servers.map((server) => {
          const listings = server.listings;
          const sole = listings.length === 1 ? listings[0] : null;
          const mixedScopes = listings.some(
            (listing) => listing.scopeLabel !== listings[0]?.scopeLabel
          );
          return (
            <Item
              className="border"
              key={server.name}
              size="sm"
              variant="outline"
            >
              <ItemContent>
                <ItemTitle className="font-mono text-sm">
                  {server.name}
                </ItemTitle>
                <ItemDescription>
                  <McpAvailabilitySummary effects={server.effects} t={t} />
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                {sole ? (
                  <Button
                    onClick={() => {
                      openInPier(sole.absolutePath);
                    }}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {t("settings.projects.mcpOpen")}
                  </Button>
                ) : (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" type="button" variant="outline">
                        {t("settings.projects.mcpSources")}
                        <ChevronDown data-icon="inline-end" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-72!">
                      <DropdownMenuGroup>
                        {listings.map((listing) => (
                          <DropdownMenuItem
                            className="items-start"
                            key={`${listing.entryId}:${listing.displayPath}`}
                            onSelect={() => {
                              openInPier(listing.absolutePath);
                            }}
                          >
                            <AgentIcon
                              agentId={listing.agentId as AgentKind}
                              size={14}
                            />
                            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                              <span className="flex min-w-0 items-center gap-1.5">
                                <span className="truncate font-medium">
                                  {listing.agentLabel}
                                </span>
                                {mixedScopes ? (
                                  <ScopeBadge
                                    scopeLabel={listing.scopeLabel}
                                    t={t}
                                  />
                                ) : null}
                              </span>
                              <span
                                className="truncate font-mono text-muted-foreground text-xs"
                                title={listing.displayPath}
                              >
                                {listing.displayPath}
                              </span>
                            </span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </ItemActions>
            </Item>
          );
        })}
      </ItemGroup>
    </div>
  );
}
