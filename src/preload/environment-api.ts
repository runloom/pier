import type {
  EnvironmentProjectRequest,
  EnvironmentSnapshotRequest,
  EnvironmentUpdateRequest,
  EnvironmentWorktreeBindingRequest,
  LocalEnvironmentState,
  LocalEnvironmentWorktreeBindingSnapshot,
} from "@shared/contracts/environment.ts";
import { PIER, PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { ipcRenderer } from "electron";
import { invokePierCommand, subscribeIpc } from "./ipc-envelope.ts";

export interface PierEnvironmentsAPI {
  onChanged(cb: (snapshot: LocalEnvironmentState) => void): () => void;
  pickProjectDirectory(): Promise<string | null>;
  project: {
    add(request: EnvironmentProjectRequest): Promise<LocalEnvironmentState>;
    remove(request: EnvironmentProjectRequest): Promise<LocalEnvironmentState>;
  };
  snapshot(
    request?: EnvironmentSnapshotRequest
  ): Promise<LocalEnvironmentState>;
  update(request: EnvironmentUpdateRequest): Promise<LocalEnvironmentState>;
  worktreeBinding(
    request: EnvironmentWorktreeBindingRequest
  ): Promise<LocalEnvironmentWorktreeBindingSnapshot | null>;
}

export const environmentsApi: PierEnvironmentsAPI = {
  onChanged: (cb) =>
    subscribeIpc<LocalEnvironmentState>(
      PIER_BROADCAST.ENVIRONMENTS_CHANGED,
      cb
    ),
  pickProjectDirectory: () =>
    ipcRenderer.invoke(PIER.ENVIRONMENT_PICK_PROJECT_DIRECTORY),
  project: {
    add: (request) =>
      invokePierCommand<LocalEnvironmentState>({
        ...request,
        type: "environment.project.add",
      }),
    remove: (request) =>
      invokePierCommand<LocalEnvironmentState>({
        ...request,
        type: "environment.project.remove",
      }),
  },
  snapshot: (request) =>
    invokePierCommand<LocalEnvironmentState>({
      ...(request ?? {}),
      type: "environment.snapshot",
    }),
  update: (request) =>
    invokePierCommand<LocalEnvironmentState>({
      ...request,
      type: "environment.update",
    }),
  worktreeBinding: (request) =>
    invokePierCommand<LocalEnvironmentWorktreeBindingSnapshot | null>({
      ...request,
      type: "environment.worktreeBinding",
    }),
};
