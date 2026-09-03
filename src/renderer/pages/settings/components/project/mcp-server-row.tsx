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
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@pier/ui/item.tsx";
import { AgentIcon } from "@plugins/api/components/agent-icons/index.tsx";
import {
  type McpOwnership,
  type McpServerListing,
  type McpServerView,
  PIER_MANAGED_MCP_SERVER_NAME,
} from "@shared/contracts/agent/assets.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import { ChevronDown } from "lucide-react";
import type { useT } from "@/i18n/use-t.ts";
import { agentLabel, McpAvailabilitySummary } from "./mcp-agent-chips.tsx";

export const MEMORY_PROJECT_SETTINGS_TAB = "pier.memory.project";

function ScopeBadge({
  ownership,
  scopeLabel,
  t,
}: {
  ownership?: McpOwnership;
  scopeLabel?: McpServerListing["scopeLabel"];
  t: ReturnType<typeof useT>;
}) {
  let key = "settings.projects.mcpScopeUser";
  if (ownership === "pier-managed") {
    key = "settings.projects.mcpScopePier";
  } else if (scopeLabel === "project" || ownership === "project") {
    key = "settings.projects.mcpScopeProject";
  }
  return (
    <Badge size="xs" variant="outline">
      {t(key)}
    </Badge>
  );
}

function TransportBadge({
  transport,
  t,
}: {
  t: ReturnType<typeof useT>;
  transport: McpServerListing["transport"] | McpServerView["transport"];
}) {
  if (transport === "stdio") {
    return (
      <Badge size="xs" variant="outline">
        {t("settings.projects.mcpTransportStdio")}
      </Badge>
    );
  }
  if (transport === "http") {
    return (
      <Badge size="xs" variant="outline">
        {t("settings.projects.mcpTransportHttp")}
      </Badge>
    );
  }
  if (transport === "mixed") {
    return (
      <Badge size="xs" variant="outline">
        {t("settings.projects.mcpTransportMixed")}
      </Badge>
    );
  }
  return null;
}

function MetaBadges({
  server,
  t,
}: {
  server: McpServerView;
  t: ReturnType<typeof useT>;
}) {
  return (
    <>
      <ScopeBadge ownership={server.ownership} t={t} />
      <TransportBadge t={t} transport={server.transport} />
      {server.enabled === "off" ? (
        <Badge size="xs" variant="outline">
          {t("settings.projects.mcpEnabledOff")}
        </Badge>
      ) : null}
      {server.enabled === "mixed" ? (
        <Badge size="xs" variant="outline">
          {t("settings.projects.mcpEnabledMixed")}
        </Badge>
      ) : null}
    </>
  );
}

function primaryDisplayPath(server: McpServerView): string | undefined {
  if (server.ownership === "project") {
    const project = server.listings.find(
      (listing) => listing.scopeLabel === "project"
    );
    if (project) return project.displayPath;
  }
  return server.listings[0]?.displayPath;
}

export function McpServerRow({
  canOpenMemory,
  onOpenListing,
  onOpenMemory,
  server,
  t,
}: {
  canOpenMemory: boolean;
  onOpenListing: (listing: McpServerListing) => void;
  onOpenMemory: () => void;
  server: McpServerView;
  t: ReturnType<typeof useT>;
}) {
  const listings = server.listings;
  const sole = listings.length === 1 ? listings[0] : null;
  const rowPath = primaryDisplayPath(server);
  const mixedScopes = listings.some(
    (listing) => listing.scopeLabel !== listings[0]?.scopeLabel
  );
  const isPierManaged = server.ownership === "pier-managed";
  const title =
    server.name === PIER_MANAGED_MCP_SERVER_NAME
      ? t("settings.projects.mcpPierManagedTitle")
      : server.name;

  function renderActions() {
    if (isPierManaged && canOpenMemory) {
      return (
        <Button
          onClick={onOpenMemory}
          size="sm"
          type="button"
          variant="outline"
        >
          {t("settings.projects.mcpOpenMemory")}
        </Button>
      );
    }
    if (sole) {
      return (
        <Button
          onClick={() => {
            onOpenListing(sole);
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          {t("settings.projects.mcpOpen")}
        </Button>
      );
    }
    return (
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
                key={`${listing.entryId}:${listing.agentId}:${listing.displayPath}`}
                onSelect={() => {
                  onOpenListing(listing);
                }}
              >
                <AgentIcon agentId={listing.agentId as AgentKind} size={14} />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span className="truncate font-medium">
                      {agentLabel(listing.agentId)}
                    </span>
                    {mixedScopes || isPierManaged ? (
                      <ScopeBadge scopeLabel={listing.scopeLabel} t={t} />
                    ) : null}
                    <TransportBadge t={t} transport={listing.transport} />
                    {listing.enabled ? null : (
                      <Badge size="xs" variant="outline">
                        {t("settings.projects.mcpEnabledOff")}
                      </Badge>
                    )}
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
    );
  }

  return (
    <Item className="border" size="sm" variant="outline">
      <ItemContent>
        <ItemTitle className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span
            className={
              server.name === PIER_MANAGED_MCP_SERVER_NAME
                ? "text-sm"
                : "font-mono text-sm"
            }
          >
            {title}
          </span>
          {server.name === PIER_MANAGED_MCP_SERVER_NAME ? (
            <span className="font-mono text-muted-foreground text-xs">
              {server.name}
            </span>
          ) : null}
          <MetaBadges server={server} t={t} />
        </ItemTitle>
        <ItemDescription>
          <span className="flex min-w-0 flex-col gap-1">
            {rowPath ? (
              <span
                className="truncate font-mono text-muted-foreground text-xs"
                title={rowPath}
              >
                {rowPath}
              </span>
            ) : null}
            <McpAvailabilitySummary
              effects={server.effects}
              gaps={server.gaps}
              t={t}
            />
          </span>
        </ItemDescription>
      </ItemContent>
      <ItemActions>{renderActions()}</ItemActions>
    </Item>
  );
}
