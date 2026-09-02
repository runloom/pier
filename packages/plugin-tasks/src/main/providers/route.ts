import type { TaskBoardParams } from "../../shared/types.ts";
import { createGithubProvider } from "./github.ts";
import { createJiraProvider } from "./jira.ts";
import { createLinearProvider } from "./linear.ts";
import type { TrackerProvider } from "./types.ts";

export function createRoutedTrackerProvider(input: {
  getJiraBaseUrl: () => Promise<string | null>;
  getToken: (provider: "github" | "jira" | "linear") => Promise<string | null>;
}): TrackerProvider {
  const github = createGithubProvider({
    getToken: () => input.getToken("github"),
  });
  const linear = createLinearProvider({
    getToken: () => input.getToken("linear"),
  });
  const jira = createJiraProvider({
    baseUrl: input.getJiraBaseUrl,
    getToken: () => input.getToken("jira"),
  });

  const pick = (
    provider?: "github" | "jira" | "linear" | undefined
  ): TrackerProvider => {
    if (provider === "linear") {
      return linear;
    }
    if (provider === "jira") {
      return jira;
    }
    return github;
  };

  const fromParams = (params?: TaskBoardParams | undefined): TrackerProvider =>
    pick(params?.provider);

  return {
    addDependency: async (blockedKey, blockerKey, params) => {
      const provider = fromParams(params);
      if (!provider.addDependency) {
        throw new Error("dependency edits are not available");
      }
      await provider.addDependency(blockedKey, blockerKey, params);
    },
    createIssue: (params, issue) =>
      pick(params.provider).createIssue(params, issue),
    createStandardLabels: (repo) => github.createStandardLabels(repo),
    fetchBoard: (params) => pick(params.provider).fetchBoard(params),
    removeDependency: async (blockedKey, blockerKey, params) => {
      const provider = fromParams(params);
      if (!provider.removeDependency) {
        throw new Error("dependency edits are not available");
      }
      await provider.removeDependency(blockedKey, blockerKey, params);
    },
    setAssignees: (itemKey, logins, params) =>
      fromParams(params).setAssignees(itemKey, logins, params),
    setClosed: (itemKey, closed, params) =>
      fromParams(params).setClosed(itemKey, closed, params),
    setColumnStatus: async (itemKey, columnId, params, options) => {
      const inner = fromParams(params);
      if (!inner.setColumnStatus) {
        throw new Error("column status writes are not available");
      }
      return await inner.setColumnStatus(itemKey, columnId, params, options);
    },
    viewerLogin: (params) => fromParams(params).viewerLogin(params),
  };
}
