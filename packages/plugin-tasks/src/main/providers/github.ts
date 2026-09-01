import type { HeuristicColumnId } from "../../shared/columns.ts";
import { STANDARD_LABELS } from "../../shared/constants.ts";
import { formatIssueKey, parseIssueKey, parseRepo } from "../../shared/rpc.ts";
import type { TaskBoardParams, TaskCard } from "../../shared/types.ts";
import { type GraphqlIssue, shapeBoard, viewerCanWrite } from "./github-map.ts";
import { fetchProjectColumnByIssueKey } from "./github-projects.ts";
import type { TrackerProvider } from "./types.ts";

const GITHUB_GRAPHQL = "https://api.github.com/graphql";
const GITHUB_API = "https://api.github.com";

const ISSUE_FIELDS = `
  number
  title
  url
  state
  closed
  repository { nameWithOwner viewerPermission }
  assignees(first: 3) { nodes { login avatarUrl } }
  labels(first: 20) { nodes { name color } }
  milestone { title }
`;

const BLOCKED_BY_FIELDS = `
  blockedBy(first: 20) {
    nodes {
      ... on Issue {
        number
        title
        url
        closed
        repository { nameWithOwner }
      }
    }
  }
`;

const CLOSING_PR_FIELDS = `
  closedByPullRequestsReferences(first: 10) {
    nodes { number title url merged state }
  }
`;

interface GraphqlSearchData {
  search?: {
    nodes?: Array<GraphqlIssue | null>;
    pageInfo?: { endCursor?: string; hasNextPage?: boolean };
  };
}

export function createGithubProvider(input: {
  fetchImpl?: typeof fetch;
  getToken: () => Promise<string | null>;
}): TrackerProvider {
  const fetchImpl = input.fetchImpl ?? fetch;

  const authed = async (url: string, init?: RequestInit): Promise<Response> => {
    const token = await input.getToken();
    if (!token) {
      throw new Error("not authorized");
    }
    const headers = new Headers(init?.headers);
    headers.set("Accept", "application/vnd.github+json");
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("User-Agent", "pier.tasks");
    headers.set("X-GitHub-Api-Version", "2022-11-28");
    return fetchImpl(url, { ...init, headers });
  };

  const graphql = async <T>(
    query: string,
    variables: Record<string, unknown>
  ): Promise<T> => {
    const response = await authed(GITHUB_GRAPHQL, {
      body: JSON.stringify({ query, variables }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const body: unknown = await response.json();
    if (!response.ok) {
      throw new Error(`GitHub GraphQL HTTP ${response.status}`);
    }
    if (
      body &&
      typeof body === "object" &&
      "errors" in body &&
      Array.isArray(body.errors) &&
      body.errors.length > 0
    ) {
      const message = body.errors
        .map((error) =>
          error && typeof error === "object" && "message" in error
            ? String(error.message)
            : "GraphQL error"
        )
        .join("; ");
      throw new Error(message);
    }
    if (body && typeof body === "object" && "data" in body) {
      return body.data as T;
    }
    throw new Error("GitHub GraphQL returned no data");
  };

  const restJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
    const response = await authed(url, init);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GitHub ${response.status}: ${text.slice(0, 180)}`);
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  };

  const searchIssues = async (
    params: TaskBoardParams,
    withDeps: boolean
  ): Promise<GraphqlIssue[]> => {
    const parsed = parseRepo(params.repo);
    const terms = [`repo:${parsed.owner}/${parsed.name}`, "is:issue"];
    if (params.milestone) {
      terms.push(`milestone:"${params.milestone.replaceAll('"', "")}"`);
    }
    if (params.label) {
      terms.push(`label:"${params.label.replaceAll('"', "")}"`);
    }
    const query = `query($search: String!, $after: String) {
      search(query: $search, type: ISSUE, first: 50, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          ... on Issue {
            ${ISSUE_FIELDS}
            ${withDeps ? BLOCKED_BY_FIELDS : ""}
            ${withDeps ? CLOSING_PR_FIELDS : ""}
          }
        }
      }
    }`;
    const nodes: GraphqlIssue[] = [];
    let after: string | undefined;
    for (let page = 0; page < 2; page += 1) {
      const data = await graphql<GraphqlSearchData>(query, {
        after: after ?? null,
        search: terms.join(" "),
      });
      for (const node of data.search?.nodes ?? []) {
        if (node?.number) {
          nodes.push(node);
        }
      }
      if (!data.search?.pageInfo?.hasNextPage) {
        break;
      }
      after = data.search.pageInfo.endCursor;
    }
    return nodes;
  };

  const emptyCard = (
    itemKey: string,
    extra: Partial<TaskCard> & Pick<TaskCard, "number" | "title" | "url">
  ): TaskCard => ({
    assignee: null,
    blockers: [],
    externalBlockedByCount: 0,
    externalBlockers: [],
    key: itemKey,
    labels: [],
    linkedPRs: [],
    milestone: null,
    openBlockedByCount: 0,
    repo: `${parseIssueKey(itemKey).owner}/${parseIssueKey(itemKey).repo}`,
    ...extra,
  });

  return {
    async addDependency(blockedKey, blockerKey) {
      const blocked = parseIssueKey(blockedKey);
      const blocker = parseIssueKey(blockerKey);
      const blockerIssue = await restJson<{ id: number }>(
        `${GITHUB_API}/repos/${blocker.owner}/${blocker.repo}/issues/${blocker.number}`
      );
      await restJson(
        `${GITHUB_API}/repos/${blocked.owner}/${blocked.repo}/issues/${blocked.number}/dependencies/blocked_by`,
        {
          body: JSON.stringify({ issue_id: blockerIssue.id }),
          method: "POST",
        }
      );
    },
    async createIssue(params, input) {
      const parsed = parseRepo(params.repo);
      const created = await restJson<{
        html_url: string;
        number: number;
        title: string;
      }>(`${GITHUB_API}/repos/${parsed.owner}/${parsed.name}/issues`, {
        body: JSON.stringify({
          body: input.body ?? "",
          labels: params.label ? [params.label] : undefined,
          milestone: params.milestone,
          title: input.title,
        }),
        method: "POST",
      });
      return {
        assignee: null,
        blockers: [],
        externalBlockedByCount: 0,
        externalBlockers: [],
        key: formatIssueKey(parsed.owner, parsed.name, created.number),
        labels: params.label ? [{ name: params.label }] : [],
        linkedPRs: [],
        milestone: params.milestone ?? null,
        number: created.number,
        openBlockedByCount: 0,
        repo: params.repo,
        title: created.title,
        url: created.html_url,
      };
    },
    async createStandardLabels(repo) {
      const parsed = parseRepo(repo);
      for (const name of STANDARD_LABELS) {
        const response = await authed(
          `${GITHUB_API}/repos/${parsed.owner}/${parsed.name}/labels`,
          {
            body: JSON.stringify({ name }),
            method: "POST",
          }
        );
        if (!(response.ok || response.status === 422)) {
          throw new Error(`Could not create label ${name}`);
        }
      }
    },
    async fetchBoard(params) {
      let dependencySource: "label" | "native" = "native";
      let issues: GraphqlIssue[];
      try {
        issues = await searchIssues(params, true);
      } catch {
        issues = await searchIssues(params, false);
        dependencySource = "label";
      }
      const permission = issues[0]?.repository?.viewerPermission;
      let columnByKey: Map<string, HeuristicColumnId> | undefined;
      if (params.projectId) {
        try {
          columnByKey = await fetchProjectColumnByIssueKey({
            graphql,
            projectId: params.projectId,
            repo: params.repo,
          });
        } catch {
          columnByKey = undefined;
        }
      }
      return shapeBoard(params, issues, viewerCanWrite(permission, true), {
        ...(columnByKey ? { columnByKey } : {}),
        dependencySource,
      });
    },
    async removeDependency(blockedKey, blockerKey) {
      const blocked = parseIssueKey(blockedKey);
      const blocker = parseIssueKey(blockerKey);
      const blockerIssue = await restJson<{ id: number }>(
        `${GITHUB_API}/repos/${blocker.owner}/${blocker.repo}/issues/${blocker.number}`
      );
      await restJson(
        `${GITHUB_API}/repos/${blocked.owner}/${blocked.repo}/issues/${blocked.number}/dependencies/blocked_by/${blockerIssue.id}`,
        { method: "DELETE" }
      );
    },
    async setAssignees(itemKey, logins) {
      const parsed = parseIssueKey(itemKey);
      const updated = await restJson<{
        assignees?: Array<{ avatar_url?: string; login: string }>;
        html_url: string;
        number: number;
        title: string;
      }>(
        `${GITHUB_API}/repos/${parsed.owner}/${parsed.repo}/issues/${parsed.number}`,
        {
          body: JSON.stringify({ assignees: [...logins] }),
          method: "PATCH",
        }
      );
      const assignee = updated.assignees?.[0];
      return emptyCard(itemKey, {
        assignee: assignee
          ? { avatarUrl: assignee.avatar_url, login: assignee.login }
          : null,
        number: updated.number,
        title: updated.title,
        url: updated.html_url,
      });
    },
    async setClosed(itemKey, closed) {
      const parsed = parseIssueKey(itemKey);
      const updated = await restJson<{
        html_url: string;
        number: number;
        title: string;
      }>(
        `${GITHUB_API}/repos/${parsed.owner}/${parsed.repo}/issues/${parsed.number}`,
        {
          body: JSON.stringify({ state: closed ? "closed" : "open" }),
          method: "PATCH",
        }
      );
      return emptyCard(itemKey, {
        number: updated.number,
        title: updated.title,
        url: updated.html_url,
      });
    },
    async viewerLogin() {
      const user = await restJson<{ login?: string }>(`${GITHUB_API}/user`);
      return user.login ?? null;
    },
  };
}
