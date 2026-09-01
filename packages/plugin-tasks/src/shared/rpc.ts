import { z } from "zod/mini";

export const emptyRpcPayloadSchema = z.unknown();

const optionalNonEmptyString = z.optional(z.string().check(z.minLength(1)));
const optionalProvider = z.optional(z.enum(["github", "linear", "jira"]));

export const boardParamsSchema = z.object({
  label: optionalNonEmptyString,
  milestone: optionalNonEmptyString,
  projectId: optionalNonEmptyString,
  provider: optionalProvider,
  repo: z.string().check(z.minLength(1)),
});

export const projectionPayloadSchema = z.object({
  params: z.optional(boardParamsSchema),
});

export const setStatusPayloadSchema = z.object({
  columnId: z.string().check(z.minLength(1)),
  confirm: z.optional(z.boolean()),
  itemKey: z.string().check(z.minLength(1)),
  params: boardParamsSchema,
  rankAfterKey: optionalNonEmptyString,
  rankBeforeKey: optionalNonEmptyString,
  sortOrder: z.optional(z.number()),
});

export const refreshPayloadSchema = z.object({
  params: boardParamsSchema,
});

export const bindingPayloadSchema = z.object({
  projectRootPath: z.string().check(z.minLength(1)),
});

export const optionalPathPayloadSchema = z.object({
  projectRootPath: optionalNonEmptyString,
});

export const sourcePayloadSchema = z.object({
  lastJiraProject: optionalNonEmptyString,
  lastLinearProject: z.optional(z.string()),
  lastLinearTeam: optionalNonEmptyString,
  lastSource: optionalProvider,
  projectRootPath: z.string().check(z.minLength(1)),
});

export const linearTeamKeyPayloadSchema = z.object({
  teamKey: z.string().check(z.minLength(1)),
});

export const catalogKeysPayloadSchema = z.object({
  keys: z.array(z.string()),
});

export const createLabelsPayloadSchema = z.object({
  projectRootPath: z.string().check(z.minLength(1)),
  repo: z.string().check(z.minLength(3)),
});

export const createItemPayloadSchema = z.object({
  body: z.optional(z.string()),
  params: boardParamsSchema,
  title: z.string().check(z.minLength(1)),
});

export const assignPayloadSchema = z.object({
  itemKey: z.string().check(z.minLength(1)),
  login: z.nullable(z.string()),
  params: boardParamsSchema,
});

export const closePayloadSchema = z.object({
  confirm: z.optional(z.boolean()),
  itemKey: z.string().check(z.minLength(1)),
  params: boardParamsSchema,
});

export const depPayloadSchema = z.object({
  blockedKey: z.string().check(z.minLength(1)),
  blockerKey: z.string().check(z.minLength(1)),
  params: boardParamsSchema,
});

export const startWorkPayloadSchema = z.object({
  agentId: optionalNonEmptyString,
  itemKey: z.string().check(z.minLength(1)),
  params: boardParamsSchema,
  projectRootPath: optionalNonEmptyString,
});

export const pruneWorktreePayloadSchema = z.object({
  itemKey: z.string().check(z.minLength(1)),
  params: boardParamsSchema,
});

export const startAllReadyPayloadSchema = z.object({
  agentId: optionalNonEmptyString,
  limit: z.optional(z.number()),
  params: boardParamsSchema,
  projectRootPath: optionalNonEmptyString,
});

export const providerTokenPayloadSchema = z.object({
  provider: z.enum(["github", "jira", "linear"]),
  token: z.string().check(z.minLength(1)),
});

export const jiraBaseUrlPayloadSchema = z.object({
  url: z.string().check(z.minLength(8)),
});

export const revokeProviderPayloadSchema = z.object({
  provider: z.enum(["github", "jira", "linear"]),
});

export function parseIssueKey(itemKey: string): {
  number: number;
  owner: string;
  repo: string;
} {
  const match = /^([^/]+)\/([^#]+)#(\d+)$/.exec(itemKey);
  if (!match) {
    throw new Error(`invalid task key: ${itemKey}`);
  }
  return {
    number: Number(match[3]),
    owner: match[1] ?? "",
    repo: match[2] ?? "",
  };
}

export function parseTaskItemKey(itemKey: string): {
  number: number;
  owner: string;
  repo: string;
} {
  try {
    return parseIssueKey(itemKey);
  } catch {
    const linear = /^([A-Za-z][A-Za-z0-9]+)-(\d+)$/.exec(itemKey.trim());
    if (linear) {
      const team = linear[1] ?? "";
      return { number: Number(linear[2]), owner: team, repo: team };
    }
    return { number: 0, owner: "", repo: itemKey };
  }
}

export function formatIssueKey(
  owner: string,
  repo: string,
  number: number
): string {
  return `${owner}/${repo}#${number}`;
}

export function parseRepo(repo: string): { name: string; owner: string } {
  const match = /^([^/]+)\/([^/]+)$/.exec(repo.trim());
  if (!match) {
    throw new Error(`invalid repository: ${repo}`);
  }
  return { name: match[2] ?? "", owner: match[1] ?? "" };
}
