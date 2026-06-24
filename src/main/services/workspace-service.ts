import {
  clearLayout as clearLayoutState,
  readLayout as readLayoutState,
  saveLayout as saveLayoutState,
} from "../state/workspace-layout.ts";

export interface WorkspaceService {
  clearLayout(): Promise<void>;
  readLayout(): Promise<unknown | null>;
  saveLayout(layout: unknown): Promise<void>;
}

export function createWorkspaceService(): WorkspaceService {
  return {
    clearLayout: () => clearLayoutState(),
    readLayout: () => readLayoutState(),
    saveLayout: (layout) => saveLayoutState(layout),
  };
}
