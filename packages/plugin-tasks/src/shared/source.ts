import type {
  SourceEmptyReason,
  SourceSnapshot,
  SourceStatus,
  TaskBoardParams,
  TaskProvider,
} from "./types.ts";

export function sourceBlockReason(
  status: SourceStatus,
  source: TaskProvider
): SourceEmptyReason | null {
  if (source === "linear") {
    if (!status.credential.linearAuthorized) {
      return "linear-need-auth";
    }
    return activeLinearTeam(status) ? null : "linear-need-team";
  }
  if (source === "jira") {
    if (!(status.credential.jiraAuthorized && status.credential.jiraBaseUrl)) {
      return "jira-need-auth";
    }
    return activeJiraProject(status) ? null : "jira-need-project";
  }
  if (!status.githubRepo) {
    return "github-no-remote";
  }
  return status.credential.authorized ? null : "github-need-auth";
}

export function activeLinearTeam(snapshot: SourceSnapshot): string | null {
  if (
    snapshot.lastLinearTeam &&
    snapshot.linearTeamKeys.includes(snapshot.lastLinearTeam)
  ) {
    return snapshot.lastLinearTeam;
  }
  return snapshot.linearTeamKeys[0] ?? null;
}

export function activeLinearProject(snapshot: SourceSnapshot): string | null {
  return snapshot.lastLinearProject;
}

export function activeJiraProject(snapshot: SourceSnapshot): string | null {
  if (
    snapshot.lastJiraProject &&
    snapshot.jiraProjectKeys.includes(snapshot.lastJiraProject)
  ) {
    return snapshot.lastJiraProject;
  }
  return snapshot.jiraProjectKeys[0] ?? null;
}

export function sourceBoardParams(
  snapshot: SourceSnapshot,
  source: TaskProvider = snapshot.lastSource
): TaskBoardParams | { reason: SourceEmptyReason } {
  if (source === "linear") {
    const team = activeLinearTeam(snapshot);
    if (!team) {
      return { reason: "linear-need-team" };
    }
    return {
      provider: "linear",
      repo: team,
      ...(snapshot.lastLinearProject
        ? { projectId: snapshot.lastLinearProject }
        : {}),
    };
  }
  if (source === "jira") {
    const project = activeJiraProject(snapshot);
    if (!project) {
      return { reason: "jira-need-project" };
    }
    return { provider: "jira", repo: project };
  }
  if (!snapshot.githubRepo) {
    return { reason: "github-no-remote" };
  }
  return { provider: "github", repo: snapshot.githubRepo };
}
