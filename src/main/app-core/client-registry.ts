import type { PierClient } from "@shared/contracts/permissions.ts";

export interface PierClientRegistry {
  get(clientId: string): PierClient | null;
  heartbeat(clientId: string): PierClient | null;
  list(): PierClient[];
  register(client: PierClient): PierClient;
  unregister(clientId: string): void;
}

export function createClientRegistry(
  now: () => number = () => Date.now()
): PierClientRegistry {
  const clients = new Map<string, PierClient>();
  return {
    get(clientId) {
      return clients.get(clientId) ?? null;
    },
    heartbeat(clientId) {
      const current = clients.get(clientId);
      if (!current) {
        return null;
      }
      const next: PierClient = { ...current, lastSeenAt: now() };
      clients.set(clientId, next);
      return next;
    },
    list() {
      return [...clients.values()];
    },
    register(client) {
      clients.set(client.id, client);
      return client;
    },
    unregister(clientId) {
      clients.delete(clientId);
    },
  };
}
