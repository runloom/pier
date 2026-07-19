import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type SshHost,
  type SshHostsSnapshot,
  sshHostsSnapshotSchema,
} from "../shared/hosts.ts";

export interface SshHostStore {
  importHosts(hosts: readonly SshHost[]): Promise<SshHostsSnapshot>;
  init(): Promise<void>;
  list(): SshHost[];
  remove(hostId: string): Promise<SshHostsSnapshot>;
  replaceAll(hosts: readonly SshHost[]): Promise<SshHostsSnapshot>;
  snapshot(): SshHostsSnapshot;
  upsert(host: SshHost): Promise<SshHostsSnapshot>;
}

function connectIdentity(host: SshHost): string {
  return JSON.stringify([
    host.host,
    host.user ?? null,
    host.port ?? null,
    host.identityFile ?? null,
  ]);
}

interface CreateSshHostStoreOptions {
  filePath: string;
  onChanged: (snapshot: SshHostsSnapshot) => void;
  persistSnapshot?: (snapshot: SshHostsSnapshot) => Promise<void>;
  warn: (message: string, meta?: unknown) => void;
}

export function createSshHostStore(
  options: CreateSshHostStoreOptions
): SshHostStore {
  let hosts: SshHost[] = [];
  let mutationQueue: Promise<void> = Promise.resolve();

  async function persist(next: readonly SshHost[]): Promise<void> {
    const persistedSnapshot = {
      hosts: next.map((host) => ({ ...host })),
    };
    if (options.persistSnapshot) {
      await options.persistSnapshot(persistedSnapshot);
      return;
    }
    await mkdir(dirname(options.filePath), { recursive: true });
    // Write to a temp sibling then rename so a crash never truncates hosts.json.
    const tempPath = join(
      dirname(options.filePath),
      `.hosts-${process.pid}-${randomUUID()}.tmp`
    );
    try {
      await writeFile(
        tempPath,
        `${JSON.stringify(persistedSnapshot, null, 2)}\n`,
        "utf8"
      );
      await rename(tempPath, options.filePath);
    } catch (error) {
      await unlink(tempPath).catch(() => undefined);
      throw error;
    }
  }

  function snapshot(): SshHostsSnapshot {
    return { hosts: hosts.map((host) => ({ ...host })) };
  }

  function mutate(
    update: (current: readonly SshHost[]) => SshHost[]
  ): Promise<SshHostsSnapshot> {
    const operation = mutationQueue.then(async () => {
      const next = update(hosts).map((host) => ({ ...host }));
      await persist(next);
      hosts = next;
      const current = snapshot();
      try {
        options.onChanged(current);
      } catch (error) {
        options.warn("[pier.ssh] hosts changed listener failed", error);
      }
      return current;
    });
    mutationQueue = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }

  return {
    importHosts: (incoming) =>
      mutate((current) => {
        const ids = new Set(current.map((host) => host.id));
        const identities = new Set(current.map(connectIdentity));
        const next = [...current];
        for (const host of incoming) {
          const identity = connectIdentity(host);
          if (ids.has(host.id) || identities.has(identity)) {
            continue;
          }
          ids.add(host.id);
          identities.add(identity);
          next.push(host);
        }
        return next;
      }),
    async init(): Promise<void> {
      let raw: string;
      try {
        raw = await readFile(options.filePath, "utf8");
      } catch {
        return;
      }
      try {
        hosts = sshHostsSnapshotSchema.parse(JSON.parse(raw)).hosts;
      } catch (error) {
        options.warn("[pier.ssh] hosts.json unreadable, starting empty", error);
      }
    },
    list: () => hosts.map((host) => ({ ...host })),
    remove: (hostId) =>
      mutate((current) => current.filter((host) => host.id !== hostId)),
    replaceAll: (next) => mutate(() => [...next]),
    snapshot,
    upsert: (host) =>
      mutate((current) => {
        const index = current.findIndex((entry) => entry.id === host.id);
        const next = [...current];
        if (index === -1) {
          next.push(host);
        } else {
          next[index] = host;
        }
        return next;
      }),
  };
}
