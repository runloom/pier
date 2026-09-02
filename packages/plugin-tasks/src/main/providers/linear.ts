import type { TaskColumnId } from "../../shared/columns.ts";
import type { TaskBoardParams, TaskCard } from "../../shared/types.ts";
import {
  deriveLinearStates,
  type LinearWorkflowState,
  shapeLinearBoard,
} from "./linear-board.ts";
import { postLinearGraphql } from "./linear-graphql.ts";
import type { TrackerProvider } from "./types.ts";

interface LinearRelatedIssue {
  completedAt?: string | null;
  identifier: string;
  state?: { type?: string };
  title: string;
  url: string;
}

interface LinearRelationNode {
  id?: string;
  issue?: LinearRelatedIssue;
  relatedIssue?: LinearRelatedIssue;
  type?: string;
}

interface LinearIssue {
  assignee?: { name?: string } | null;
  identifier: string;
  inverseRelations?: { nodes?: LinearRelationNode[] };
  relations?: { nodes?: LinearRelationNode[] };
  sortOrder?: number;
  state?: { id?: string; name?: string; type?: string };
  title: string;
  url: string;
}

function linearIssueIsDone(issue: LinearRelatedIssue | undefined): boolean {
  if (!issue) {
    return true;
  }
  if (issue.completedAt) {
    return true;
  }
  return issue.state?.type === "completed" || issue.state?.type === "canceled";
}

function blockersFromRelations(
  issue: LinearIssue,
  repo: string
): Array<{ key: string; repo: string; title: string; url: string }> {
  const byKey = new Map<
    string,
    { key: string; repo: string; title: string; url: string }
  >();
  const add = (related: LinearRelatedIssue | undefined) => {
    if (!related || linearIssueIsDone(related)) {
      return;
    }
    byKey.set(related.identifier, {
      key: related.identifier,
      repo,
      title: related.title,
      url: related.url,
    });
  };
  for (const node of issue.inverseRelations?.nodes ?? []) {
    if (node.type === "blocks") {
      add(node.issue);
    }
  }
  for (const node of issue.relations?.nodes ?? []) {
    if (node.type === "blockedBy" || node.type === "blocked") {
      add(node.relatedIssue);
    }
  }
  return [...byKey.values()];
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
    repo: partial.key.split("#")[0] ?? "",
    ...partial,
  };
}

async function resolveLinearIssueId(
  graphql: <T>(query: string, variables: Record<string, unknown>) => Promise<T>,
  team: string,
  itemKey: string
): Promise<string> {
  const number = Number(itemKey.split("-").at(-1) ?? 0);
  const data = await graphql<{
    issues?: { nodes?: Array<{ id: string }> };
  }>(
    `query($team: String!, $number: Float!) {
      issues(
        filter: { team: { key: { eq: $team } }, number: { eq: $number } }
        first: 1
      ) { nodes { id } }
    }`,
    { number, team }
  );
  const id = data.issues?.nodes?.[0]?.id;
  if (!id) {
    throw new Error("Linear issue not found");
  }
  return id;
}

export function createLinearProvider(input: {
  fetchImpl?: typeof fetch;
  getToken: () => Promise<string | null>;
}): TrackerProvider {
  const fetchImpl = input.fetchImpl ?? fetch;

  const graphql = async <T>(
    query: string,
    variables: Record<string, unknown>
  ): Promise<T> =>
    postLinearGraphql<T>({
      fetchImpl,
      getToken: input.getToken,
      query,
      variables,
    });

  const issueFields = `
    identifier
    title
    url
    sortOrder
    state { id name type }
    assignee { name }
    relations(first: 20) {
      nodes {
        type
        relatedIssue {
          identifier title url completedAt state { type }
        }
      }
    }
    inverseRelations(first: 20) {
      nodes {
        type
        issue { identifier title url completedAt state { type } }
      }
    }
  `;

  const fetchIssues = async (
    params: TaskBoardParams
  ): Promise<LinearIssue[]> => {
    const data = params.projectId
      ? await graphql<{ issues?: { nodes?: LinearIssue[] } }>(
          `query($team: String!, $projectId: ID!) {
            issues(
              filter: {
                team: { key: { eq: $team } }
                project: { id: { eq: $projectId } }
              }
              first: 80
            ) { nodes { ${issueFields} } }
          }`,
          { projectId: params.projectId, team: params.repo }
        )
      : await graphql<{ issues?: { nodes?: LinearIssue[] } }>(
          `query($team: String!) {
            issues(filter: { team: { key: { eq: $team } } }, first: 80) {
              nodes { ${issueFields} }
            }
          }`,
          { team: params.repo }
        );
    return data.issues?.nodes ?? [];
  };

  const fetchStates = async (team: string): Promise<LinearWorkflowState[]> => {
    try {
      const data = await graphql<{
        teams?: {
          nodes?: Array<{
            states?: { nodes?: LinearWorkflowState[] };
          }>;
        };
      }>(
        `query($key: String!) {
          teams(filter: { key: { eq: $key } }, first: 1) {
            nodes { states(first: 50) { nodes { id name type position } } }
          }
        }`,
        { key: team }
      );
      return data.teams?.nodes?.[0]?.states?.nodes ?? [];
    } catch {
      return [];
    }
  };

  const shape = (
    params: TaskBoardParams,
    issues: LinearIssue[],
    states: LinearWorkflowState[]
  ) => {
    const cards = issues.map((issue) => {
      const number = Number(issue.identifier.split("-").at(-1) ?? 0);
      const openBlockers = blockersFromRelations(issue, params.repo);
      const stateId =
        issue.state?.id ?? `type:${issue.state?.type ?? "unstarted"}`;
      const card: TaskCard = {
        assignee: issue.assignee?.name ? { login: issue.assignee.name } : null,
        blockers: openBlockers,
        externalBlockedByCount: 0,
        externalBlockers: [],
        key: issue.identifier,
        labels: [],
        linkedPRs: [],
        milestone: params.milestone ?? null,
        number,
        openBlockedByCount: openBlockers.length,
        repo: params.repo,
        ...(typeof issue.sortOrder === "number"
          ? { sortOrder: issue.sortOrder }
          : {}),
        title: issue.title,
        url: issue.url,
      };
      return { card, stateId };
    });
    const catalog = states.length > 0 ? states : deriveLinearStates(issues);
    return shapeLinearBoard(params, catalog, cards);
  };

  return {
    createIssue: async (params, input) => {
      const team = await graphql<{
        teams?: { nodes?: Array<{ id: string }> };
      }>(
        `query($key: String!) {
          teams(filter: { key: { eq: $key } }, first: 1) { nodes { id } }
        }`,
        { key: params.repo }
      );
      const teamId = team.teams?.nodes?.[0]?.id;
      if (!teamId) {
        throw new Error("Linear team not found");
      }
      const data = await graphql<{
        issueCreate?: { issue?: LinearIssue };
      }>(
        `mutation($title: String!, $teamId: String!) {
          issueCreate(input: { title: $title, teamId: $teamId }) {
            issue { identifier title url }
          }
        }`,
        { teamId, title: input.title }
      );
      const issue = data.issueCreate?.issue;
      if (!issue) {
        throw new Error("Linear did not create the task");
      }
      return emptyCard({
        key: issue.identifier,
        number: Number(issue.identifier.split("-").at(-1) ?? 0),
        title: issue.title,
        url: issue.url,
      });
    },
    createStandardLabels: async () => undefined,
    async fetchBoard(params) {
      const [issues, states] = await Promise.all([
        fetchIssues(params),
        fetchStates(params.repo),
      ]);
      return shape(params, issues, states);
    },
    addDependency: async (blockedKey, blockerKey, params) => {
      const team = params?.repo ?? "";
      const [blockedId, blockerId] = await Promise.all([
        resolveLinearIssueId(graphql, team, blockedKey),
        resolveLinearIssueId(graphql, team, blockerKey),
      ]);
      await graphql(
        `mutation($issueId: String!, $relatedIssueId: String!) {
          issueRelationCreate(input: {
            issueId: $issueId
            relatedIssueId: $relatedIssueId
            type: blocks
          }) { success }
        }`,
        { issueId: blockerId, relatedIssueId: blockedId }
      );
    },
    removeDependency: async (blockedKey, blockerKey, params) => {
      const team = params?.repo ?? "";
      const data = await graphql<{
        issue?: {
          inverseRelations?: {
            nodes?: Array<{
              id: string;
              issue?: { identifier?: string };
              type?: string;
            }>;
          };
          relations?: {
            nodes?: Array<{
              id: string;
              relatedIssue?: { identifier?: string };
              type?: string;
            }>;
          };
        };
      }>(
        `query($id: String!) {
          issue(id: $id) {
            relations(first: 50) {
              nodes { id type relatedIssue { identifier } }
            }
            inverseRelations(first: 50) {
              nodes { id type issue { identifier } }
            }
          }
        }`,
        { id: await resolveLinearIssueId(graphql, team, blockedKey) }
      );
      const relation =
        data.issue?.inverseRelations?.nodes?.find(
          (node) =>
            node.type === "blocks" && node.issue?.identifier === blockerKey
        ) ??
        data.issue?.relations?.nodes?.find(
          (node) =>
            (node.type === "blockedBy" || node.type === "blocked") &&
            node.relatedIssue?.identifier === blockerKey
        );
      if (!relation) {
        return;
      }
      await graphql(
        "mutation($id: String!) { issueRelationDelete(id: $id) { success } }",
        { id: relation.id }
      );
    },
    setAssignees: async (itemKey, logins, params) => {
      const issueId = await resolveLinearIssueId(
        graphql,
        params?.repo ?? "",
        itemKey
      );
      let assigneeId: string | null = null;
      if (logins[0]) {
        const viewer = await graphql<{
          viewer?: { id?: string; name?: string };
        }>("query { viewer { id name } }", {});
        if (viewer.viewer?.name === logins[0] && viewer.viewer.id) {
          assigneeId = viewer.viewer.id;
        } else {
          const users = await graphql<{
            users?: { nodes?: Array<{ id: string; name?: string }> };
          }>(
            `query($name: String!) {
              users(filter: { displayName: { eq: $name } }, first: 1) {
                nodes { id name }
              }
            }`,
            { name: logins[0] }
          );
          assigneeId = users.users?.nodes?.[0]?.id ?? null;
        }
      }
      await graphql(
        `mutation($id: String!, $assigneeId: String) {
          issueUpdate(id: $id, input: { assigneeId: $assigneeId }) {
            success
          }
        }`,
        { assigneeId, id: issueId }
      );
      return emptyCard({ key: itemKey, number: 0, title: itemKey, url: "" });
    },
    setClosed: async (itemKey, closed, params) =>
      setLinearState(graphql, itemKey, closed ? "done" : "todo", params),
    setColumnStatus: async (itemKey, columnId, params, options) =>
      setLinearState(graphql, itemKey, columnId, params, options?.sortOrder),
    viewerLogin: async () => {
      const data = await graphql<{ viewer?: { name?: string } }>(
        "query { viewer { name } }",
        {}
      );
      return data.viewer?.name ?? null;
    },
  };
}

function heuristicLinearType(
  columnId: TaskColumnId
): "canceled" | "completed" | "started" | "unstarted" | undefined {
  if (columnId === "done" || columnId === "completed") {
    return "completed";
  }
  if (columnId === "inProgress" || columnId === "started") {
    return "started";
  }
  if (columnId === "todo" || columnId === "unstarted") {
    return "unstarted";
  }
  if (columnId === "canceled") {
    return "canceled";
  }
  return;
}

async function setLinearState(
  graphql: <T>(query: string, variables: Record<string, unknown>) => Promise<T>,
  itemKey: string,
  columnId: TaskColumnId,
  params: TaskBoardParams | undefined,
  sortOrder?: number
): Promise<TaskCard> {
  const issueId = await resolveLinearIssueId(
    graphql,
    params?.repo ?? "",
    itemKey
  );
  const issue = await graphql<{
    issue?: {
      state?: { id?: string; type?: string };
      team?: { states?: { nodes?: Array<{ id: string; type?: string }> } };
    };
  }>(
    `query($id: String!) {
      issue(id: $id) {
        state { id type }
        team { states(first: 50) { nodes { id type } } }
      }
    }`,
    { id: issueId }
  );
  const states = issue.issue?.team?.states?.nodes ?? [];
  const type = heuristicLinearType(columnId);
  const stateId =
    states.find((state) => state.id === columnId)?.id ??
    (type ? states.find((state) => state.type === type)?.id : undefined) ??
    (type ? undefined : columnId);
  if (!stateId) {
    throw new Error("Linear workflow state not found");
  }
  const write = (input: Record<string, unknown>) =>
    graphql(
      `mutation($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) { success }
      }`,
      { id: issueId, input }
    );
  // Team.setIssueSortOrderOnStateChange rewrites rank on a state change.
  // A combined { stateId, sortOrder } input loses the drop index; write
  // rank in a second mutation so the gap the user saw is what we persist.
  if (issue.issue?.state?.id !== stateId) {
    await write({ stateId });
  }
  if (typeof sortOrder === "number") {
    await write({ sortOrder });
  }
  return emptyCard({ key: itemKey, number: 0, title: itemKey, url: "" });
}
