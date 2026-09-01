import type { TaskBoardParams, TaskCard } from "../../shared/types.ts";
import {
  collectJiraLanes,
  type JiraStatusLane,
  shapeJiraBoard,
} from "./jira-board.ts";
import type { TrackerProvider } from "./types.ts";

interface JiraIssue {
  fields?: {
    assignee?: { displayName?: string } | null;
    issuelinks?: Array<{
      inwardIssue?: {
        key: string;
        fields?: {
          summary?: string;
          status?: { statusCategory?: { key?: string } };
        };
      };
      outwardIssue?: { key: string; fields?: { summary?: string } };
      type?: { inward?: string };
    }>;
    status?: {
      id?: string;
      name?: string;
      statusCategory?: { key?: string };
    };
    summary?: string;
  };
  key: string;
  self?: string;
}

function emptyCard(
  partial: Pick<TaskCard, "key" | "number" | "title" | "url">
): TaskCard {
  return {
    assignee: null,
    blockers: [],
    externalBlockedByCount: 0,
    externalBlockers: [],
    labels: [],
    linkedPRs: [],
    milestone: null,
    openBlockedByCount: 0,
    repo: partial.key.split("-")[0] ?? "",
    ...partial,
  };
}

export function createJiraProvider(input: {
  baseUrl: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
  getToken: () => Promise<string | null>;
}): TrackerProvider {
  const fetchImpl = input.fetchImpl ?? fetch;

  const authed = async (
    path: string,
    init?: RequestInit
  ): Promise<Response> => {
    const [token, baseUrl] = await Promise.all([
      input.getToken(),
      input.baseUrl(),
    ]);
    if (!(token && baseUrl)) {
      throw new Error("Jira is not authorized");
    }
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("Accept", "application/json");
    return fetchImpl(`${baseUrl.replace(/\/$/, "")}${path}`, {
      ...init,
      headers,
    });
  };

  const restJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const response = await authed(path, init);
    if (!response.ok) {
      throw new Error(`Jira HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  };

  const shape = (
    params: TaskBoardParams,
    issues: JiraIssue[],
    catalog: ReadonlyArray<{ statuses?: readonly JiraStatusLane[] }>,
    persistRank: boolean
  ) => {
    const issueStatuses: JiraStatusLane[] = [];
    const cards = issues.flatMap((issue) => {
      if (typeof issue.key !== "string" || issue.key.length === 0) {
        return [];
      }
      const number = Number(issue.key.split("-").at(-1) ?? 0);
      const status = issue.fields?.status;
      const statusId =
        status?.id ?? status?.name ?? status?.statusCategory?.key ?? "todo";
      if (status) {
        issueStatuses.push({
          id: statusId,
          name: status.name ?? statusId,
          ...(status.statusCategory?.key
            ? { category: status.statusCategory.key }
            : {}),
        });
      }
      const openBlockers = (issue.fields?.issuelinks ?? [])
        .filter((link) => link.type?.inward === "is blocked by")
        .flatMap((link) => {
          const inward = link.inwardIssue;
          if (
            !inward ||
            inward.fields?.status?.statusCategory?.key === "done"
          ) {
            return [];
          }
          return [
            {
              key: inward.key,
              repo: params.repo,
              title: inward.fields?.summary ?? inward.key,
              url: "",
            },
          ];
        });
      const card: TaskCard = {
        assignee: issue.fields?.assignee?.displayName
          ? { login: issue.fields.assignee.displayName }
          : null,
        blockers: openBlockers,
        externalBlockedByCount: 0,
        externalBlockers: [],
        key: issue.key,
        labels: [],
        linkedPRs: [],
        milestone: params.milestone ?? null,
        number,
        openBlockedByCount: openBlockers.length,
        repo: params.repo,
        title: issue.fields?.summary ?? issue.key,
        url: issue.self ?? "",
      };
      return [{ card, statusId }];
    });
    const lanes = collectJiraLanes(catalog, issueStatuses);
    return shapeJiraBoard(params, lanes, cards, persistRank);
  };

  return {
    createIssue: async (params, createInput) => {
      const created = await restJson<{ key: string; self?: string }>(
        "/rest/api/3/issue",
        {
          body: JSON.stringify({
            fields: {
              project: { key: params.repo },
              summary: createInput.title,
              issuetype: { name: "Task" },
            },
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }
      );
      return emptyCard({
        key: created.key,
        number: Number(created.key.split("-").at(-1) ?? 0),
        title: createInput.title,
        url: created.self ?? "",
      });
    },
    createStandardLabels: async () => undefined,
    async fetchBoard(params) {
      const jql = `project=${params.repo}`;
      const search = (query: string) =>
        restJson<{ issues?: JiraIssue[] }>(
          `/rest/api/3/search/jql?jql=${encodeURIComponent(query)}&maxResults=80&fields=summary,status,assignee,issuelinks`
        );
      const catalog = restJson<
        Array<{
          statuses?: Array<{
            id?: string;
            name?: string;
            statusCategory?: { key?: string };
          }>;
        }>
      >(`/rest/api/3/project/${encodeURIComponent(params.repo)}/statuses`)
        .then((groups) =>
          (Array.isArray(groups) ? groups : []).map((group) => ({
            statuses: (group.statuses ?? []).flatMap((status) =>
              status.id
                ? [
                    {
                      id: status.id,
                      name: status.name ?? status.id,
                      ...(status.statusCategory?.key
                        ? { category: status.statusCategory.key }
                        : {}),
                    } satisfies JiraStatusLane,
                  ]
                : []
            ),
          }))
        )
        .catch(() => []);
      let persistRank = true;
      let result: { issues?: JiraIssue[] };
      try {
        result = await search(`${jql} ORDER BY Rank ASC`);
      } catch {
        persistRank = false;
        result = await search(jql);
      }
      return shape(params, result.issues ?? [], await catalog, persistRank);
    },
    addDependency: async (blockedKey, blockerKey) => {
      await restJson("/rest/api/3/issueLink", {
        body: JSON.stringify({
          inwardIssue: { key: blockedKey },
          outwardIssue: { key: blockerKey },
          type: { name: "Blocks" },
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
    },
    removeDependency: async (blockedKey, blockerKey) => {
      const issue = await restJson<{
        fields?: {
          issuelinks?: Array<{
            id?: string;
            inwardIssue?: { key?: string };
            type?: { inward?: string };
          }>;
        };
      }>(`/rest/api/3/issue/${blockedKey}?fields=issuelinks`);
      const link = issue.fields?.issuelinks?.find(
        (item) =>
          item.type?.inward === "is blocked by" &&
          item.inwardIssue?.key === blockerKey
      );
      if (!link?.id) {
        return;
      }
      await authed(`/rest/api/3/issueLink/${link.id}`, { method: "DELETE" });
    },
    setAssignees: async (itemKey, logins) => {
      let accountId: string | null = null;
      if (logins[0]) {
        const users = await restJson<Array<{ accountId?: string }>>(
          `/rest/api/3/user/search?query=${encodeURIComponent(logins[0])}`
        );
        accountId = users[0]?.accountId ?? null;
      }
      await authed(`/rest/api/3/issue/${itemKey}/assignee`, {
        body: JSON.stringify({ accountId }),
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      });
      return emptyCard({ key: itemKey, number: 0, title: itemKey, url: "" });
    },
    setClosed: async (itemKey, closed) =>
      transitionJira(authed, restJson, itemKey, closed ? "done" : "todo"),
    setColumnStatus: async (itemKey, columnId, _params, options) => {
      const current = await jiraStatusSnapshot(restJson, itemKey);
      const heuristic = jiraCategoryForColumn(columnId);
      const already = heuristic
        ? current.category === heuristic
        : current.id === columnId;
      if (!already) {
        await transitionJira(authed, restJson, itemKey, columnId);
      }
      await rankJiraIssue(authed, itemKey, options);
      return emptyCard({ key: itemKey, number: 0, title: itemKey, url: "" });
    },
    viewerLogin: async () => {
      const me = await restJson<{ displayName?: string }>("/rest/api/3/myself");
      return me.displayName ?? null;
    },
  };
}

function jiraCategoryForColumn(
  columnId: string
): "done" | "indeterminate" | "new" | undefined {
  if (columnId === "done") {
    return "done";
  }
  if (columnId === "inProgress") {
    return "indeterminate";
  }
  if (columnId === "todo") {
    return "new";
  }
  return;
}

async function jiraStatusSnapshot(
  restJson: <T>(path: string, init?: RequestInit) => Promise<T>,
  itemKey: string
): Promise<{ category?: string; id?: string }> {
  const issue = await restJson<{
    fields?: {
      status?: { id?: string; statusCategory?: { key?: string } };
    };
  }>(`/rest/api/3/issue/${itemKey}?fields=status`);
  return {
    ...(issue.fields?.status?.statusCategory?.key
      ? { category: issue.fields.status.statusCategory.key }
      : {}),
    ...(issue.fields?.status?.id ? { id: issue.fields.status.id } : {}),
  };
}

async function rankJiraIssue(
  authed: (path: string, init?: RequestInit) => Promise<Response>,
  itemKey: string,
  options?:
    | {
        rankAfterKey?: string;
        rankBeforeKey?: string;
      }
    | undefined
): Promise<void> {
  const body: {
    issues: string[];
    rankAfterIssue?: string;
    rankBeforeIssue?: string;
  } = { issues: [itemKey] };
  if (options?.rankBeforeKey && options.rankBeforeKey !== itemKey) {
    body.rankBeforeIssue = options.rankBeforeKey;
  } else if (options?.rankAfterKey && options.rankAfterKey !== itemKey) {
    body.rankAfterIssue = options.rankAfterKey;
  } else {
    return;
  }
  const response = await authed("/rest/agile/1.0/issue/rank", {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "PUT",
  });
  if (!(response.ok || response.status === 204)) {
    throw new Error(`Jira HTTP ${response.status}`);
  }
}

async function transitionJira(
  authed: (path: string, init?: RequestInit) => Promise<Response>,
  restJson: <T>(path: string, init?: RequestInit) => Promise<T>,
  itemKey: string,
  columnId: string
): Promise<TaskCard> {
  const data = await restJson<{
    transitions?: Array<{
      id: string;
      to?: { id?: string; statusCategory?: { key?: string } };
    }>;
  }>(`/rest/api/3/issue/${itemKey}/transitions`);
  const category = jiraCategoryForColumn(columnId);
  const transition =
    data.transitions?.find((item) => item.to?.id === columnId) ??
    (category
      ? data.transitions?.find(
          (item) => item.to?.statusCategory?.key === category
        )
      : undefined);
  if (!transition) {
    throw new Error("Jira transition not found");
  }
  const response = await authed(`/rest/api/3/issue/${itemKey}/transitions`, {
    body: JSON.stringify({ transition: { id: transition.id } }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`Jira HTTP ${response.status}`);
  }
  return emptyCard({ key: itemKey, number: 0, title: itemKey, url: "" });
}

export async function listJiraProjects(input: {
  baseUrl: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
  getToken: () => Promise<string | null>;
}): Promise<Array<{ key: string; name: string }>> {
  const [token, baseUrl] = await Promise.all([
    input.getToken(),
    input.baseUrl(),
  ]);
  if (!(token && baseUrl)) {
    throw new Error("Jira is not authorized");
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(
    `${baseUrl.replace(/\/$/, "")}/rest/api/3/project`,
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    }
  );
  if (!response.ok) {
    throw new Error(`Jira HTTP ${response.status}`);
  }
  const body: unknown = await response.json();
  if (!Array.isArray(body)) {
    return [];
  }
  return body.flatMap((project) => {
    if (
      project &&
      typeof project === "object" &&
      "key" in project &&
      typeof project.key === "string"
    ) {
      const name =
        "name" in project && typeof project.name === "string"
          ? project.name
          : project.key;
      return [{ key: project.key, name }];
    }
    return [];
  });
}
