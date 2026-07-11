import { createPluginSecretsFacade } from "@main/plugins/plugin-secrets.ts";
import type { SecretsStore } from "@main/state/secrets-store.ts";
import { describe, expect, it, vi } from "vitest";

function fakeStore(): SecretsStore {
  return {
    delete: vi.fn(async () => undefined),
    flush: vi.fn(async () => undefined),
    get: vi.fn(async () => null),
    getEncrypted: vi.fn(async () => null),
    list: vi.fn(async () => []),
    set: vi.fn(async () => undefined),
    setEncrypted: vi.fn(async () => undefined),
  };
}

describe("createPluginSecretsFacade", () => {
  it("namespaces every key and always uses fail-closed encrypted writes", async () => {
    const store = fakeStore();
    const first = createPluginSecretsFacade(store, "pier.codex", {
      read: true,
      write: true,
    });
    const second = createPluginSecretsFacade(store, "pier.other", {
      read: true,
      write: true,
    });

    await first.set("account/a/auth", "secret");
    await second.get("account/a/auth");
    await first.delete("account/a/auth");

    expect(store.setEncrypted).toHaveBeenCalledWith(
      "plugin:10:pier.codex:account/a/auth",
      "secret"
    );
    expect(store.getEncrypted).toHaveBeenCalledWith(
      "plugin:10:pier.other:account/a/auth"
    );
    expect(store.delete).toHaveBeenCalledWith(
      "plugin:10:pier.codex:account/a/auth"
    );
    expect(store.set).not.toHaveBeenCalled();
  });

  it("propagates secure-storage failures and rejects empty keys", async () => {
    const store = fakeStore();
    vi.mocked(store.setEncrypted).mockRejectedValue(
      new Error("secure storage is unavailable")
    );
    const secrets = createPluginSecretsFacade(store, "pier.codex", {
      read: true,
      write: true,
    });

    await expect(secrets.set("auth", "secret")).rejects.toThrow(
      "secure storage is unavailable"
    );
    expect(() => secrets.get("")).toThrow("non-empty safe string");
  });

  it("enforces manifest-derived read and write capabilities", async () => {
    const store = fakeStore();
    const secrets = createPluginSecretsFacade(store, "pier.codex", {
      read: false,
      write: false,
    });

    expect(() => secrets.get("auth")).toThrow("read capability");
    await expect(secrets.set("auth", "secret")).rejects.toThrow(
      "write capability"
    );
    await expect(secrets.delete("auth")).rejects.toThrow("write capability");
  });
});
