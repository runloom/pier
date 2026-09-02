import type { HeuristicColumnId } from "../../shared/columns.ts";
import { formatIssueKey } from "../../shared/rpc.ts";
import { projectStatusColumnId } from "./github-map.ts";

interface ProjectItemNode {
  content?: {
    number?: number;
    repository?: { nameWithOwner?: string };
  } | null;
  fieldValues?: {
    nodes?: Array<{
      field?: { name?: string };
      name?: string;
    } | null>;
  };
}

interface ProjectNodeData {
  node?: {
    items?: {
      nodes?: Array<ProjectItemNode | null>;
      pageInfo?: { endCursor?: string; hasNextPage?: boolean };
    };
  } | null;
}

export async function fetchProjectColumnByIssueKey(input: {
  graphql: <T>(query: string, variables: Record<string, unknown>) => Promise<T>;
  projectId: string;
  repo: string;
}): Promise<Map<string, HeuristicColumnId>> {
  const result = new Map<string, HeuristicColumnId>();
  let after: string | undefined;
  const query = `query($id: ID!, $after: String) {
    node(id: $id) {
      ... on ProjectV2 {
        items(first: 50, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            content {
              ... on Issue {
                number
                repository { nameWithOwner }
              }
            }
            fieldValues(first: 20) {
              nodes {
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                  field { ... on ProjectV2SingleSelectField { name } }
                }
              }
            }
          }
        }
      }
    }
  }`;
  for (let page = 0; page < 4; page += 1) {
    const data = await input.graphql<ProjectNodeData>(query, {
      after: after ?? null,
      id: input.projectId,
    });
    for (const node of data.node?.items?.nodes ?? []) {
      const number = node?.content?.number;
      const repo = node?.content?.repository?.nameWithOwner ?? input.repo;
      if (!number) {
        continue;
      }
      const status = node.fieldValues?.nodes?.find((field) => {
        const name = field?.field?.name?.toLowerCase() ?? "";
        return name === "status" || name === "state";
      })?.name;
      const columnId = projectStatusColumnId(status);
      if (!columnId) {
        continue;
      }
      const [owner, name] = repo.split("/");
      result.set(formatIssueKey(owner ?? "", name ?? "", number), columnId);
    }
    if (!data.node?.items?.pageInfo?.hasNextPage) {
      break;
    }
    after = data.node.items.pageInfo.endCursor;
  }
  return result;
}
