import {
  clearLayout as clearLayoutState,
  readLayout as readLayoutState,
  saveLayout as saveLayoutState,
} from "../state/workspace-layout.ts";

export interface WorkspaceService {
  clearLayout(recordId: string): Promise<void>;
  readLayout(recordId: string): Promise<unknown | null>;
  saveLayout(layout: unknown, recordId: string): Promise<void>;
}

export function createWorkspaceService(): WorkspaceService {
  return {
    clearLayout: (recordId) => clearLayoutState(recordId),
    readLayout: (recordId) => readLayoutState(recordId),
    saveLayout: (layout, recordId) => saveLayoutState(layout, recordId),
  };
}
