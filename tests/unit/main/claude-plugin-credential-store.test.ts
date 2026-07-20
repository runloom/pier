import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFileBackend,
  createKeychainBackend,
  type KeychainRunner,
  resolveCredentialBackend,
} from "../../../packages/plugin-claude/src/main/credential-store.ts";

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pier-claude-cred-"));
});

afterEach(async () => {
  await rm(dir, { force: true, recursive: true });
});

describe("claude credential store", () => {
  it("file backend round-trips with 0600 and returns null when absent", async () => {
    const path = join(dir, "nested", ".credentials.json");
    const backend = createFileBackend(path);
    expect(await backend.read()).toBeNull();
    await backend.write('{"claudeAiOauth":{"accessToken":"x"}}');
    expect(await backend.read()).toBe('{"claudeAiOauth":{"accessToken":"x"}}');
  });

  it("keychain backend reads via security find and writes via add -U", async () => {
    const runner: KeychainRunner = {
      run: vi.fn(async (args: string[]) => {
        if (args[0] === "find-generic-password") return "envelope-json\n";
        return "";
      }),
    };
    const backend = createKeychainBackend({ account: "tester", runner });
    expect(await backend.read()).toBe("envelope-json");
    await backend.write("new-envelope");
    expect(runner.run).toHaveBeenCalledWith(
      expect.arrayContaining([
        "add-generic-password",
        "-U",
        "-s",
        "Claude Code-credentials",
        "-a",
        "tester",
        "-w",
        "new-envelope",
      ])
    );
  });

  it("keychain read returns null only for item-not-found, throws otherwise", async () => {
    const notFound: KeychainRunner = {
      run: vi.fn(async () => {
        const error = new Error(
          "security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain."
        ) as Error & { code?: number };
        error.code = 44;
        throw error;
      }),
    };
    expect(
      await createKeychainBackend({
        account: "tester",
        runner: notFound,
      }).read()
    ).toBeNull();

    // Locked keychain / ACL denial must throw so the materialize pre-read
    // can distinguish "absent" from "cannot read".
    const locked: KeychainRunner = {
      run: vi.fn(async () => {
        const error = new Error(
          "security: SecKeychainItemCopyContent: User interaction is not allowed."
        ) as Error & { code?: number };
        error.code = 36;
        throw error;
      }),
    };
    await expect(
      createKeychainBackend({ account: "tester", runner: locked }).read()
    ).rejects.toThrow("User interaction is not allowed");
  });

  it("resolves keychain on macOS when no credentials file exists", () => {
    const backend = resolveCredentialBackend({
      account: "tester",
      credentialsFilePath: join(dir, ".credentials.json"),
      platform: "darwin",
      runner: { run: async () => "" },
    });
    expect(backend.kind).toBe("keychain");
  });

  it("prefers the credentials file on macOS when it is present", async () => {
    const path = join(dir, ".credentials.json");
    await writeFile(path, "{}");
    const backend = resolveCredentialBackend({
      account: "tester",
      credentialsFilePath: path,
      platform: "darwin",
      runner: { run: async () => "" },
    });
    expect(backend.kind).toBe("file");
  });

  it("uses the file backend on non-macOS platforms", () => {
    const backend = resolveCredentialBackend({
      credentialsFilePath: join(dir, ".credentials.json"),
      platform: "linux",
    });
    expect(backend.kind).toBe("file");
  });

  it("resolves the keychain account from the hydrated processEnv first", async () => {
    const seen: string[][] = [];
    const backend = resolveCredentialBackend({
      credentialsFilePath: join(dir, ".credentials.json"),
      forceKind: "keychain",
      processEnv: { USER: "hydrated-user" },
      runner: {
        run: async (args: string[]) => {
          seen.push(args);
          return "value\n";
        },
      },
    });
    await backend.read();
    expect(seen[0]).toContain("hydrated-user");
  });

  it("honors an explicit forceKind override", () => {
    expect(
      resolveCredentialBackend({
        credentialsFilePath: join(dir, ".credentials.json"),
        forceKind: "file",
        platform: "darwin",
      }).kind
    ).toBe("file");
  });

  it("file backend surfaces the written bytes verbatim", async () => {
    const path = join(dir, ".credentials.json");
    const backend = createFileBackend(path);
    const payload = JSON.stringify({ claudeAiOauth: { accessToken: "abc" } });
    await backend.write(payload);
    expect(await readFile(path, "utf-8")).toBe(payload);
  });
});
