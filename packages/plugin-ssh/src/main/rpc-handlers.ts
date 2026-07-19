import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  type SshHost,
  type SshImportCandidatesResult,
  type SshTestConnectionResult,
  sshHostRemovePayloadSchema,
  sshHostsImportPayloadSchema,
  sshHostTestPayloadSchema,
  sshHostUpsertPayloadSchema,
} from "../shared/hosts.ts";
import type { SshHostStore } from "./host-store.ts";
import {
  parseSshConfigHosts,
  toImportCandidates,
} from "./ssh-config-import.ts";
import { testSshConnection } from "./test-connection.ts";

interface RegisterSshRpcHandlersOptions {
  processEnv: Readonly<Record<string, string | undefined>>;
  rpc: {
    handle(
      method: string,
      handler: (payload: unknown) => Promise<unknown>
    ): void;
  };
  signal?: AbortSignal;
  store: SshHostStore;
  testConnection?: typeof testSshConnection;
}

function requireHost(store: SshHostStore, hostId: string): SshHost {
  const host = store.list().find((entry) => entry.id === hostId);
  if (!host) {
    throw new Error(`ssh host not found: ${hostId}`);
  }
  return host;
}

export function registerSshRpcHandlers(
  options: RegisterSshRpcHandlersOptions
): void {
  const testConnection = options.testConnection ?? testSshConnection;

  options.rpc.handle("hosts.snapshot", () =>
    Promise.resolve(options.store.snapshot())
  );

  options.rpc.handle("hosts.upsert", async (payload) => {
    const { host } = sshHostUpsertPayloadSchema.parse(payload);
    return await options.store.upsert(host);
  });

  options.rpc.handle("hosts.remove", async (payload) => {
    const { hostId } = sshHostRemovePayloadSchema.parse(payload);
    return await options.store.remove(hostId);
  });

  options.rpc.handle("hosts.import", async (payload) => {
    const { hosts } = sshHostsImportPayloadSchema.parse(payload);
    return await options.store.importHosts(hosts);
  });

  options.rpc.handle(
    "hosts.importCandidates",
    async (): Promise<SshImportCandidatesResult> => {
      const configPath = join(homedir(), ".ssh", "config");
      let content: string;
      try {
        content = await readFile(configPath, "utf8");
      } catch {
        return { candidates: [] };
      }
      return {
        candidates: toImportCandidates(
          parseSshConfigHosts(content),
          options.store.list()
        ),
      };
    }
  );

  options.rpc.handle(
    "hosts.testConnection",
    async (payload): Promise<SshTestConnectionResult> => {
      const { hostId } = sshHostTestPayloadSchema.parse(payload);
      return await testConnection(
        requireHost(options.store, hostId),
        options.processEnv,
        options.signal
      );
    }
  );
}
