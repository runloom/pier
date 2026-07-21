import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSshHostStore } from "../../../packages/plugin-ssh/src/main/host-store.ts";
import { registerSshRpcHandlers } from "../../../packages/plugin-ssh/src/main/rpc-handlers.ts";
import {
  parseSshConfigHosts,
  toImportCandidates,
} from "../../../packages/plugin-ssh/src/main/ssh-config-import.ts";
import { testSshConnection } from "../../../packages/plugin-ssh/src/main/test-connection.ts";
import {
  buildSshCommand,
  describeSshTarget,
  type SshHost,
  sshHostSchema,
  sshTargetArgs,
} from "../../../packages/plugin-ssh/src/shared/hosts.ts";

function host(overrides: Partial<SshHost> = {}): SshHost {
  return {
    host: "example.com",
    id: "host-1",
    name: "Example",
    ...overrides,
  };
}

describe("buildSshCommand", () => {
  it("builds a bare target without optional fields", () => {
    expect(buildSshCommand(host())).toBe("ssh -- example.com");
  });

  it("includes user, port, and identity file", () => {
    expect(
      buildSshCommand(
        host({ identityFile: "~/.ssh/id_ed25519", port: 2222, user: "root" })
      )
    ).toBe("ssh -p 2222 -i '~/.ssh/id_ed25519' -- root@example.com");
  });

  it("quotes arguments with spaces and single quotes", () => {
    expect(buildSshCommand(host({ identityFile: "/tmp/o'brien key" }))).toBe(
      "ssh -i '/tmp/o'\\''brien key' -- example.com"
    );
  });

  it("terminates option parsing and rejects option-shaped destinations", () => {
    expect(sshTargetArgs(host())).toEqual(["--", "example.com"]);
    expect(
      sshHostSchema.safeParse(host({ host: "-oProxyCommand=touch /tmp/pwned" }))
        .success
    ).toBe(false);
    expect(
      sshHostSchema.safeParse(host({ user: "-oProxyCommand=touch" })).success
    ).toBe(false);
  });
});

describe("describeSshTarget", () => {
  it("formats user@host:port", () => {
    expect(describeSshTarget(host({ port: 2222, user: "root" }))).toBe(
      "root@example.com:2222"
    );
    expect(describeSshTarget(host())).toBe("example.com");
  });
});

describe("testSshConnection", () => {
  it("terminates an active probe when its lifecycle is aborted", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-ssh-bin-"));
    const executable = join(dir, "ssh");
    await writeFile(
      executable,
      "#!/usr/bin/env node\nsetInterval(() => undefined, 1000);\n",
      "utf8"
    );
    await chmod(executable, 0o755);
    const controller = new AbortController();

    const resultPromise = testSshConnection(
      host(),
      { PATH: `${dir}:${process.env.PATH ?? ""}` },
      controller.signal
    );
    controller.abort();

    await expect(resultPromise).resolves.toEqual({
      detail: "cancelled",
      ok: false,
    });
    await rm(dir, { force: true, recursive: true });
  });
});

describe("parseSshConfigHosts", () => {
  it("parses aliases with options and skips wildcards", () => {
    const blocks = parseSshConfigHosts(
      [
        "# personal boxes",
        "Host dev staging.example",
        "  HostName dev.internal",
        "  User deploy",
        "  Port 2200",
        '  IdentityFile "~/.ssh/work key"',
        "",
        "Host *",
        "  ServerAliveInterval 60",
        "Host prod !prod",
        "Host solo",
      ].join("\n")
    );
    expect(blocks).toEqual([
      {
        alias: "dev",
        hostName: "dev.internal",
        identityFile: "~/.ssh/work key",
        port: 2200,
        user: "deploy",
      },
      {
        alias: "staging.example",
        hostName: "dev.internal",
        identityFile: "~/.ssh/work key",
        port: 2200,
        user: "deploy",
      },
      { alias: "solo" },
    ]);
  });

  it("ignores invalid ports", () => {
    const blocks = parseSshConfigHosts(
      ["Host dev", "  Port 99999", "Host dev2", "  Port abc"].join("\n")
    );
    expect(blocks).toEqual([{ alias: "dev" }, { alias: "dev2" }]);
  });
});

describe("toImportCandidates", () => {
  it("keeps the alias as connect target and skips existing targets", () => {
    const existing = [host({ host: "dev", id: "existing", user: "deploy" })];
    const candidates = toImportCandidates(
      [
        { alias: "dev", hostName: "dev.internal", user: "deploy" },
        { alias: "fresh", port: 22 },
      ],
      existing
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      host: "fresh",
      name: "fresh",
    });
    expect(candidates[0]).not.toHaveProperty("port");
    expect(candidates[0]?.id).toBeTruthy();
  });

  it("deduplicates repeated aliases and lets OpenSSH resolve their options", () => {
    const candidates = toImportCandidates(
      [
        { alias: "prod", user: "deploy" },
        { alias: "prod", identityFile: "~/.ssh/other", user: "root" },
      ],
      []
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ host: "prod", name: "prod" });
    expect(candidates[0]).not.toHaveProperty("user");
    expect(candidates[0]).not.toHaveProperty("identityFile");
  });
});

describe("createSshHostStore", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) {
      await rm(dir, { force: true, recursive: true });
    }
  });

  async function tempStorePath(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "pier-ssh-test-"));
    tempDirs.push(dir);
    return join(dir, "hosts.json");
  }

  it("starts empty when the file is missing and persists upserts", async () => {
    const filePath = await tempStorePath();
    const onChanged = vi.fn();
    const store = createSshHostStore({
      filePath,
      onChanged,
      warn: () => undefined,
    });
    await store.init();
    expect(store.list()).toEqual([]);

    await store.upsert(host());
    expect(onChanged).toHaveBeenCalledWith({ hosts: [host()] });
    const persisted = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    expect(persisted).toEqual({ hosts: [host()] });

    const reloaded = createSshHostStore({
      filePath,
      onChanged: () => undefined,
      warn: () => undefined,
    });
    await reloaded.init();
    expect(reloaded.list()).toEqual([host()]);
  });

  it("updates in place on upsert with the same id and removes by id", async () => {
    const store = createSshHostStore({
      filePath: await tempStorePath(),
      onChanged: () => undefined,
      warn: () => undefined,
    });
    await store.init();
    await store.upsert(host());
    await store.upsert(host({ name: "Renamed" }));
    expect(store.list()).toEqual([host({ name: "Renamed" })]);
    await store.remove("host-1");
    expect(store.list()).toEqual([]);
  });

  it("serializes concurrent mutations without losing hosts", async () => {
    const filePath = await tempStorePath();
    const store = createSshHostStore({
      filePath,
      onChanged: () => undefined,
      warn: () => undefined,
    });
    await store.init();

    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        store.upsert(
          host({
            host: `host-${index}.example`,
            id: `host-${index}`,
            name: `Host ${index}`,
          })
        )
      )
    );

    expect(store.list()).toHaveLength(20);
    const persisted = JSON.parse(await readFile(filePath, "utf8")) as {
      hosts: SshHost[];
    };
    expect(persisted.hosts).toHaveLength(20);
  });

  it("does not update memory when persistence fails", async () => {
    let shouldFail = true;
    const store = createSshHostStore({
      filePath: await tempStorePath(),
      onChanged: () => undefined,
      persistSnapshot: async () => {
        if (shouldFail) {
          throw new Error("disk full");
        }
      },
      warn: () => undefined,
    });
    await store.init();

    await expect(store.upsert(host())).rejects.toThrow("disk full");
    expect(store.list()).toEqual([]);

    shouldFail = false;
    await expect(store.upsert(host())).resolves.toEqual({ hosts: [host()] });
    expect(store.list()).toEqual([host()]);
  });

  it("starts empty and warns when the file is corrupt", async () => {
    const filePath = await tempStorePath();
    const warn = vi.fn();
    const first = createSshHostStore({
      filePath,
      onChanged: () => undefined,
      warn: () => undefined,
    });
    await first.init();
    await first.upsert(host());

    const { writeFile } = await import("node:fs/promises");
    await writeFile(filePath, "{not json", "utf8");
    const store = createSshHostStore({
      filePath,
      onChanged: () => undefined,
      warn,
    });
    await store.init();
    expect(store.list()).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });
});

describe("registerSshRpcHandlers", () => {
  async function setup(): Promise<{
    abortController: AbortController;
    invoke: (method: string, payload?: unknown) => Promise<unknown>;
    testConnection: ReturnType<typeof vi.fn>;
  }> {
    const handlers = new Map<string, (payload: unknown) => Promise<unknown>>();
    const dir = await mkdtemp(join(tmpdir(), "pier-ssh-rpc-"));
    const store = createSshHostStore({
      filePath: join(dir, "hosts.json"),
      onChanged: () => undefined,
      warn: () => undefined,
    });
    await store.init();
    const abortController = new AbortController();
    const testConnection = vi.fn(() => Promise.resolve({ ok: true }));
    registerSshRpcHandlers({
      processEnv: {},
      rpc: {
        handle: (method, handler) => handlers.set(method, handler),
      },
      signal: abortController.signal,
      store,
      testConnection: testConnection as never,
    });
    return {
      abortController,
      invoke: (method, payload) => {
        const handler = handlers.get(method);
        if (!handler) {
          throw new Error(`no handler: ${method}`);
        }
        return handler(payload ?? null);
      },
      testConnection,
    };
  }

  it("rejects malformed upsert payloads", async () => {
    const { invoke } = await setup();
    await expect(
      invoke("hosts.upsert", { host: { id: "x" } })
    ).rejects.toThrow();
  });

  it("round-trips snapshot, upsert, import, and remove", async () => {
    const { invoke } = await setup();
    await expect(invoke("hosts.snapshot")).resolves.toEqual({ hosts: [] });
    await invoke("hosts.upsert", { host: host() });
    await invoke("hosts.import", {
      hosts: [host({ host: "second", id: "host-2", name: "Second" })],
    });
    const snapshot = (await invoke("hosts.snapshot")) as {
      hosts: SshHost[];
    };
    expect(snapshot.hosts.map((entry) => entry.id)).toEqual([
      "host-1",
      "host-2",
    ]);
    await invoke("hosts.remove", { hostId: "host-1" });
    await expect(invoke("hosts.snapshot")).resolves.toEqual({
      hosts: [host({ host: "second", id: "host-2", name: "Second" })],
    });
  });

  it("routes testConnection to the resolved host and fails on unknown ids", async () => {
    const { abortController, invoke, testConnection } = await setup();
    await invoke("hosts.upsert", { host: host() });
    await expect(
      invoke("hosts.testConnection", { hostId: "host-1" })
    ).resolves.toEqual({ ok: true });
    expect(testConnection).toHaveBeenCalledWith(
      host(),
      {},
      abortController.signal
    );
    await expect(
      invoke("hosts.testConnection", { hostId: "missing" })
    ).rejects.toThrow(/not found/);
  });

  it("keeps repeated import submissions idempotent", async () => {
    const { invoke } = await setup();
    const imported = host({ host: "prod", id: "candidate-a", name: "prod" });

    await invoke("hosts.import", { hosts: [imported] });
    await invoke("hosts.import", {
      hosts: [{ ...imported, id: "candidate-b" }],
    });

    await expect(invoke("hosts.snapshot")).resolves.toEqual({
      hosts: [imported],
    });
  });
});
