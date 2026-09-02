import type { TaskColumnId } from "../../shared/columns.ts";
import type {
  TaskBoardParams,
  TaskBoardSnapshot,
  TaskCard,
} from "../../shared/types.ts";

export interface TrackerProvider {
  addDependency?(
    blockedKey: string,
    blockerKey: string,
    params?: TaskBoardParams | undefined
  ): Promise<void>;
  createIssue(
    params: TaskBoardParams,
    input: { body?: string | undefined; title: string }
  ): Promise<TaskCard>;
  createStandardLabels(repo: string): Promise<void>;
  fetchBoard(
    params: TaskBoardParams
  ): Promise<Omit<TaskBoardSnapshot, "generation">>;
  removeDependency?(
    blockedKey: string,
    blockerKey: string,
    params?: TaskBoardParams | undefined
  ): Promise<void>;
  setAssignees(
    itemKey: string,
    logins: readonly string[],
    params?: TaskBoardParams | undefined
  ): Promise<TaskCard>;
  setClosed(
    itemKey: string,
    closed: boolean,
    params?: TaskBoardParams | undefined
  ): Promise<TaskCard>;
  /**
   * Status-native trackers (Linear workflow, Jira transitions) write the
   * column itself. GitHub keeps the assignment heuristic in actions.
   */
  setColumnStatus?(
    itemKey: string,
    columnId: TaskColumnId,
    params?: TaskBoardParams | undefined,
    options?:
      | {
          rankAfterKey?: string;
          rankBeforeKey?: string;
          sortOrder?: number;
        }
      | undefined
  ): Promise<TaskCard>;
  viewerLogin(params?: TaskBoardParams | undefined): Promise<string | null>;
}
