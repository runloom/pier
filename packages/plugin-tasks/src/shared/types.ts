import type { TaskColumnId, TaskColumnKind } from "./columns.ts";

export type TaskProvider = "github" | "jira" | "linear";

export interface TaskBoardParams {
  label?: string | undefined;
  milestone?: string | undefined;
  projectId?: string | undefined;
  provider?: TaskProvider | undefined;
  repo: string;
}

export interface TaskAssignee {
  avatarUrl?: string | undefined;
  login: string;
}

export interface TaskLabel {
  color?: string | undefined;
  name: string;
}

export interface TaskBlocker {
  key: string;
  repo: string;
  title: string;
  url: string;
}

export interface LinkedPullRequest {
  merged: boolean;
  number: number;
  state: "open" | "closed" | "merged";
  title: string;
  url: string;
}

export interface TaskWorkSession {
  panelId?: string | undefined;
  path: string;
}

export interface TaskCard {
  assignee: TaskAssignee | null;
  blockers: readonly TaskBlocker[];
  externalBlockedByCount: number;
  externalBlockers: readonly TaskBlocker[];
  key: string;
  labels: readonly TaskLabel[];
  linkedPRs: readonly LinkedPullRequest[];
  milestone: string | null;
  number: number;
  openBlockedByCount: number;
  repo: string;
  sortOrder?: number;
  title: string;
  url: string;
  work?: TaskWorkSession | null;
}

export interface TaskColumn {
  id: TaskColumnId;
  items: readonly TaskCard[];
  kind?: TaskColumnKind;
  readonly: boolean;
  title: string;
}

export type TaskDependencySource = "label" | "native" | "none";

export interface TrackerCapabilities {
  columnSource: "assignment" | "project" | "status";
  createIssue: boolean;
  dependencies: TaskDependencySource;
  /** Tracker can persist in-column order (Linear sortOrder, Jira Rank). */
  persistRank?: boolean;
}

export interface TaskBoardSnapshot {
  canWrite: boolean;
  capabilities?: TrackerCapabilities;
  columnMapping: "heuristic" | "project";
  columns: readonly TaskColumn[];
  cycleKeys: readonly string[];
  fetchedAt: number;
  generation: number;
  hasCycle: boolean;
  params: TaskBoardParams;
  schemaVersion: number;
  truncated: boolean;
}

export interface TaskDagNode {
  key: string;
  title: string;
}

export interface TaskDagEdge {
  from: string;
  to: string;
}

export interface TaskDagSnapshot {
  cycleKeys: readonly string[];
  edges: readonly TaskDagEdge[];
  fetchedAt: number;
  generation: number;
  hasCycle: boolean;
  nodes: readonly TaskDagNode[];
  params: TaskBoardParams;
  schemaVersion: number;
}

export interface CredentialStatus {
  authorized: boolean;
  jiraAuthorized: boolean;
  jiraBaseUrl: string | null;
  linearAuthorized: boolean;
  linearProbed: boolean;
  login: string | null;
  probed: boolean;
}

export interface TrackerCatalogItem {
  key: string;
  name: string;
}

export interface SourceSnapshot {
  githubRepo: string | null;
  jiraProjectKeys: string[];
  lastJiraProject: string | null;
  lastLinearProject: string | null;
  lastLinearTeam: string | null;
  lastSource: TaskProvider;
  linearTeamKeys: string[];
}

export interface SourceStatus extends SourceSnapshot {
  credential: CredentialStatus;
}

export type SourceEmptyReason =
  | "github-need-auth"
  | "github-no-remote"
  | "jira-need-auth"
  | "jira-need-project"
  | "linear-need-auth"
  | "linear-need-team";
