import {
  DEFAULT_CAPABILITIES_BY_CLIENT_KIND,
  type PierClient,
} from "@shared/contracts/permissions.ts";
import { app } from "electron";
import type { PierAppCore } from "../../app-core/app-core.ts";
import { appCore } from "../../app-core/app-core.ts";
import {
  createPierLocalControlServer,
  type PierLocalControlServer,
  resolveLocalControlSocketPath,
} from "./local-control-server.ts";

export interface RegisteredLocalControl {
  close(): Promise<void>;
  socketPath: string;
}

export interface RegisterCliLocalControlArgs {
  core?: PierAppCore;
  userDataDir?: string;
}

function registerCliClient(core: PierAppCore): PierClient {
  const now = Date.now();
  return core.clients.register({
    capabilities: DEFAULT_CAPABILITIES_BY_CLIENT_KIND["cli-local"],
    createdAt: now,
    id: "cli-local",
    kind: "cli-local",
    lastSeenAt: now,
  });
}

function clientIdOf(envelope: unknown): string | null {
  if (
    envelope &&
    typeof envelope === "object" &&
    "clientId" in envelope &&
    typeof envelope.clientId === "string"
  ) {
    return envelope.clientId;
  }
  return null;
}

export async function registerCliLocalControl({
  core = appCore,
  userDataDir = app.getPath("userData"),
}: RegisterCliLocalControlArgs = {}): Promise<RegisteredLocalControl> {
  registerCliClient(core);
  const socketPath = resolveLocalControlSocketPath(userDataDir);
  const server: PierLocalControlServer = createPierLocalControlServer({
    handleRequest(envelope) {
      const clientId = clientIdOf(envelope);
      if (clientId) {
        core.clients.heartbeat(clientId);
      }
      return core.commandRouter.execute(envelope);
    },
    socketPath,
  });
  await server.start();
  return {
    close: () => server.close(),
    socketPath,
  };
}
