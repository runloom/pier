import type { ExternalRendererPluginContext } from "@pier/plugin-api/renderer";
import { Button } from "@pier/ui/button.tsx";
import { Checkbox } from "@pier/ui/checkbox.tsx";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
import {
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@pier/ui/field.tsx";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@pier/ui/input-group.tsx";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@pier/ui/item.tsx";
import { type JSX, useEffect, useState } from "react";
import type {
  SourceEmptyReason,
  SourceStatus,
  TrackerCatalogItem,
} from "../shared/types.ts";
import { openConnectDialog } from "./connect-dialog.tsx";
import { formatUnknownError, type Translate } from "./translate.ts";

export function SourceSetup({
  context,
  onDone,
  reason,
  status,
  t,
}: {
  context: ExternalRendererPluginContext;
  onDone: () => void;
  reason: SourceEmptyReason;
  status: SourceStatus;
  t: Translate;
}): JSX.Element {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linearTeams, setLinearTeams] = useState<TrackerCatalogItem[]>([]);
  const [jiraProjects, setJiraProjects] = useState<TrackerCatalogItem[]>([]);
  const [manual, setManual] = useState("");

  useEffect(() => {
    if (reason === "linear-need-team") {
      context.rpc
        .invoke<{ teams?: TrackerCatalogItem[] }>("source.listLinearTeams")
        .then((result) => setLinearTeams(result.teams ?? []))
        .catch(() => setLinearTeams([]));
    }
    if (reason === "jira-need-project") {
      context.rpc
        .invoke<{ projects?: TrackerCatalogItem[] }>("source.listJiraProjects")
        .then((result) => setJiraProjects(result.projects ?? []))
        .catch(() => setJiraProjects([]));
    }
  }, [context, reason]);

  const run = (work: () => Promise<void>): void => {
    setPending(true);
    work()
      .then(() => {
        setError(null);
        onDone();
      })
      .catch((caught: unknown) => {
        setError(formatUnknownError(caught));
      })
      .finally(() => {
        setPending(false);
      });
  };

  return (
    <Empty className="h-full rounded-none border-0">
      <EmptyHeader>
        <EmptyTitle>{setupTitle(reason, t)}</EmptyTitle>
        <EmptyDescription>{setupBody(reason, t)}</EmptyDescription>
      </EmptyHeader>
      {reason === "github-no-remote" ? null : (
        <EmptyContent>
          {error ? <FieldError>{error}</FieldError> : null}
          {reason === "github-need-auth" ? (
            <Button
              disabled={pending}
              onClick={() =>
                run(async () => {
                  await context.rpc.invoke("connection.authorize");
                })
              }
              type="button"
            >
              {t("pier.tasks.connection.authorize", "Authorize GitHub")}
            </Button>
          ) : null}
          {reason === "linear-need-auth" && status.credential.linearProbed ? (
            <Button
              disabled={pending}
              onClick={() =>
                run(async () => {
                  await context.rpc.invoke("connection.authorizeLinear");
                })
              }
              type="button"
            >
              {t(
                "pier.tasks.connection.authorizeLinear",
                "Use Linear key on this device"
              )}
            </Button>
          ) : null}
          {reason === "linear-need-auth" || reason === "jira-need-auth" ? (
            <Button
              disabled={pending}
              onClick={() =>
                openConnectDialog({
                  context,
                  onDone,
                  provider: reason === "jira-need-auth" ? "jira" : "linear",
                  t,
                  ...(reason === "jira-need-auth"
                    ? {
                        jiraBaseUrl: status.credential.jiraBaseUrl ?? "",
                      }
                    : {}),
                })
              }
              type="button"
              variant={
                reason === "linear-need-auth" && status.credential.linearProbed
                  ? "outline"
                  : "default"
              }
            >
              {t("pier.tasks.panel.connect", "Connect")}
            </Button>
          ) : null}
          {reason === "linear-need-team" ? (
            <CatalogPicker
              catalog={linearTeams}
              keys={status.linearTeamKeys}
              manual={manual}
              onManualChange={setManual}
              onToggle={(key, checked) => {
                run(async () => {
                  const next = checked
                    ? [...status.linearTeamKeys, key]
                    : status.linearTeamKeys.filter((item) => item !== key);
                  await context.rpc.invoke("source.setLinearTeams", {
                    keys: next,
                  });
                });
              }}
              pending={pending}
              placeholder="ENG"
              t={t}
            />
          ) : null}
          {reason === "jira-need-project" ? (
            <CatalogPicker
              catalog={jiraProjects}
              keys={status.jiraProjectKeys}
              manual={manual}
              onManualChange={setManual}
              onToggle={(key, checked) => {
                run(async () => {
                  const next = checked
                    ? [...status.jiraProjectKeys, key]
                    : status.jiraProjectKeys.filter((item) => item !== key);
                  await context.rpc.invoke("source.setJiraProjects", {
                    keys: next,
                  });
                });
              }}
              pending={pending}
              placeholder="PROJ"
              t={t}
            />
          ) : null}
        </EmptyContent>
      )}
    </Empty>
  );
}

function setupTitle(reason: SourceEmptyReason, t: Translate): string {
  if (reason === "github-no-remote") {
    return t(
      "pier.tasks.panel.githubNoRemoteTitle",
      "No GitHub remote on this folder"
    );
  }
  if (reason === "github-need-auth") {
    return t(
      "pier.tasks.panel.githubNeedAuthTitle",
      "Authorize GitHub to load issues"
    );
  }
  if (reason === "linear-need-auth") {
    return t(
      "pier.tasks.panel.linearNeedAuthTitle",
      "Connect Linear to load issues"
    );
  }
  if (reason === "linear-need-team") {
    return t(
      "pier.tasks.panel.linearNeedTeamTitle",
      "Pick Linear teams to show"
    );
  }
  if (reason === "jira-need-auth") {
    return t(
      "pier.tasks.panel.jiraNeedAuthTitle",
      "Connect Jira to load issues"
    );
  }
  return t(
    "pier.tasks.panel.jiraNeedProjectTitle",
    "Pick a Jira project to show"
  );
}

function setupBody(reason: SourceEmptyReason, t: Translate): string {
  if (reason === "github-no-remote") {
    return t(
      "pier.tasks.panel.githubNoRemoteBody",
      "GitHub issues load from this folder's GitHub remote. Add a remote, or switch to Linear or Jira."
    );
  }
  if (reason === "github-need-auth") {
    return t(
      "pier.tasks.panel.githubNeedAuthBody",
      "Pier uses a GitHub login already on this device after you grant access."
    );
  }
  if (reason === "linear-need-auth") {
    return t(
      "pier.tasks.panel.linearNeedAuthBody",
      "Open Linear to create an access key, then paste it back here. Teams are picked automatically when it works."
    );
  }
  if (reason === "linear-need-team") {
    return t(
      "pier.tasks.panel.linearNeedTeamBody",
      "Choose the Linear teams this panel should list."
    );
  }
  if (reason === "jira-need-auth") {
    return t(
      "pier.tasks.panel.jiraNeedAuthBody",
      "Create an API token at Atlassian, then paste the site URL and token here. Projects are picked automatically when they load."
    );
  }
  return t(
    "pier.tasks.panel.jiraNeedProjectBody",
    "Choose the Jira projects this panel should list."
  );
}

function CatalogPicker({
  catalog,
  keys,
  manual,
  onManualChange,
  onToggle,
  pending,
  placeholder,
  t,
}: {
  catalog: readonly TrackerCatalogItem[];
  keys: readonly string[];
  manual: string;
  onManualChange: (value: string) => void;
  onToggle: (key: string, checked: boolean) => void;
  pending: boolean;
  placeholder: string;
  t: Translate;
}): JSX.Element {
  const known = new Set(catalog.map((item) => item.key));
  const extras = keys
    .filter((key) => !known.has(key))
    .map((key) => ({ key, name: key }));
  const rows = [...catalog, ...extras];
  return (
    <FieldGroup className="w-full gap-3">
      {rows.length > 0 ? (
        <ItemGroup className="gap-2">
          {rows.map((item) => {
            const id = `pier-tasks-source-${item.key}`;
            return (
              <Item key={item.key} size="sm" variant="outline">
                <Checkbox
                  checked={keys.includes(item.key)}
                  disabled={pending}
                  id={id}
                  onCheckedChange={(value) => {
                    onToggle(item.key, value === true);
                  }}
                />
                <ItemContent className="min-w-0">
                  <ItemTitle>
                    <FieldLabel htmlFor={id}>{item.name}</FieldLabel>
                  </ItemTitle>
                  {item.name === item.key ? null : (
                    <ItemDescription className="font-mono">
                      {item.key}
                    </ItemDescription>
                  )}
                </ItemContent>
              </Item>
            );
          })}
        </ItemGroup>
      ) : (
        <FieldDescription>
          {t(
            "pier.tasks.panel.catalogEmpty",
            "Nothing was returned. Add a key below."
          )}
        </FieldDescription>
      )}
      <InputGroup>
        <InputGroupInput
          onChange={(event) => onManualChange(event.target.value)}
          placeholder={placeholder}
          value={manual}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            disabled={pending || manual.trim().length === 0}
            onClick={() => {
              onToggle(manual.trim(), true);
              onManualChange("");
            }}
            type="button"
            variant="outline"
          >
            {t("pier.tasks.connection.addKey", "Add")}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </FieldGroup>
  );
}
