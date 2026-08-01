import { LSPClient } from "@codemirror/lsp-client";
import type {
  LspSessionClosedEvent,
  LspSessionEnsureSuccess,
} from "@shared/contracts/lsp.ts";
import { fileUriFromAbsolutePath } from "@shared/lsp-uri.ts";
import { createFilesLspClientConfig } from "./client-config.ts";
import type {
  RootGeneration,
  RootSessionInput,
} from "./root-recovery-types.ts";
import { type LspFacade, SessionTransport } from "./session-coordinator.ts";
import { PierFilesWorkspace } from "./workspace-client.ts";

interface FilesLspRootGenerationInput {
  readonly ensured: LspSessionEnsureSuccess;
  readonly facade: LspFacade;
  readonly generation: number;
  readonly onClosed: (event: LspSessionClosedEvent) => void;
  readonly onDisplayFile: RootSessionInput["onDisplayFile"];
  readonly onSendFailure: () => void;
  readonly serverRoot: string;
}

export function createFilesLspRootGeneration(
  input: FilesLspRootGenerationInput
): RootGeneration {
  const workspaceHolder: { value: PierFilesWorkspace | null } = {
    value: null,
  };
  const client = new LSPClient(
    createFilesLspClientConfig({
      rootUri: fileUriFromAbsolutePath(input.serverRoot),
      workspace: (lspClient) => {
        const workspace = new PierFilesWorkspace(
          lspClient,
          input.onDisplayFile
        );
        workspaceHolder.value = workspace;
        return workspace;
      },
    })
  );
  const transport = new SessionTransport({
    facade: input.facade,
    onClosed: input.onClosed,
    onSendFailure: input.onSendFailure,
    sessionId: input.ensured.sessionId,
  });
  return {
    client,
    faulted: false,
    generation: input.generation,
    ready: false,
    serverId: input.ensured.serverId,
    sessionId: input.ensured.sessionId,
    transport,
    workspace: workspaceHolder.value,
  };
}
