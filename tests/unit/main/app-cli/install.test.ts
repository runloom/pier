import type { AppCliFs } from "@main/services/app-cli/fs.ts";
import {
  type AppCliHost,
  inspectAppCli,
  installAppCli,
  uninstallAppCli,
} from "@main/services/app-cli/install.ts";
import { describe, expect, it } from "vitest";

type Entry =
  | { kind: "dir"; writable: boolean }
  | { kind: "file"; writable: boolean }
  | { kind: "symlink"; target: string; writable: boolean };

function createMemoryFs(seed: Record<string, Entry>): AppCliFs {
  const entries = new Map<string, Entry>(Object.entries(seed));

  const get = (path: string): Entry | undefined => entries.get(path);

  return {
    canWrite(path) {
      return get(path)?.writable === true;
    },
    existsDir(path) {
      return get(path)?.kind === "dir";
    },
    existsFile(path) {
      return get(path)?.kind === "file";
    },
    kind(path) {
      const entry = get(path);
      if (!entry) {
        return "missing";
      }
      if (entry.kind === "dir") {
        return "other";
      }
      return entry.kind;
    },
    mkdirp(path) {
      entries.set(path, { kind: "dir", writable: true });
    },
    readlink(path) {
      const entry = get(path);
      if (entry?.kind !== "symlink") {
        throw new Error(`not a symlink: ${path}`);
      }
      return entry.target;
    },
    realpath(path) {
      const entry = get(path);
      if (entry?.kind === "symlink") {
        return entry.target;
      }
      if (entry) {
        return path;
      }
      throw new Error(`missing: ${path}`);
    },
    symlink(target, path) {
      entries.set(path, { kind: "symlink", target, writable: true });
    },
    unlink(path) {
      entries.delete(path);
    },
  };
}

const resources = "/Applications/Pier.app/Contents/Resources";
const sourcePath = `${resources}/bin/pier`;
const scriptPath = `${resources}/bin/pier.mjs`;

function hostWith(fs: AppCliFs, extra: Partial<AppCliHost> = {}): AppCliHost {
  return {
    fs,
    home: "/Users/me",
    isDev: false,
    pathEnv: "/opt/homebrew/bin:/usr/bin:/bin",
    platform: "darwin",
    resourcesPath: resources,
    ...extra,
  };
}

function kitFs(extra: Record<string, Entry> = {}): AppCliFs {
  return createMemoryFs({
    [sourcePath]: { kind: "file", writable: false },
    [scriptPath]: { kind: "file", writable: false },
    "/opt/homebrew/bin": { kind: "dir", writable: true },
    "/usr/local/bin": { kind: "dir", writable: false },
    ...extra,
  });
}

describe("inspectAppCli / installAppCli", () => {
  it("reports dev builds as unavailable", () => {
    const snapshot = inspectAppCli(hostWith(kitFs(), { isDev: true }));
    expect(snapshot).toMatchObject({
      action: "status",
      actionError: "dev",
      installed: false,
    });
  });

  it("installs a symlink into a writable Homebrew bin", async () => {
    const fs = kitFs();
    const snapshot = await installAppCli({
      allowAdmin: false,
      host: hostWith(fs),
    });
    expect(snapshot.actionOk).toBe(true);
    expect(snapshot.installed).toBe(true);
    expect(snapshot.linkPath).toBe("/opt/homebrew/bin/pier");
    expect(fs.readlink("/opt/homebrew/bin/pier")).toBe(sourcePath);
  });

  it("does not overwrite a foreign pier", async () => {
    const fs = kitFs({
      "/opt/homebrew/bin/pier": {
        kind: "file",
        writable: true,
      },
    });
    const snapshot = await installAppCli({
      allowAdmin: false,
      host: hostWith(fs),
    });
    expect(snapshot.actionOk).toBe(false);
    expect(snapshot.actionError).toBe("conflict");
    expect(snapshot.conflictPath).toBe("/opt/homebrew/bin/pier");
    expect(fs.kind("/opt/homebrew/bin/pier")).toBe("file");
  });

  it("asks for admin when the destination is not writable", async () => {
    const fs = kitFs({
      "/opt/homebrew/bin": { kind: "dir", writable: false },
    });
    const snapshot = await installAppCli({
      allowAdmin: false,
      host: hostWith(fs, { pathEnv: "/usr/bin:/bin" }),
    });
    expect(snapshot.actionOk).toBe(false);
    expect(snapshot.needsAdmin).toBe(true);
    expect(snapshot.linkPath).toBe("/usr/local/bin/pier");
  });

  it("runs the admin helper when allowed", async () => {
    const commands: string[] = [];
    const fs = kitFs({
      "/opt/homebrew/bin": { kind: "dir", writable: false },
    });
    const snapshot = await installAppCli({
      allowAdmin: true,
      host: hostWith(fs, {
        pathEnv: "/usr/bin:/bin",
        runAdmin: async (command) => {
          commands.push(command);
          fs.mkdirp("/usr/local/bin");
          fs.symlink(sourcePath, "/usr/local/bin/pier");
        },
      }),
    });
    expect(commands).toHaveLength(1);
    expect(commands[0]).toContain("ln -Ffs");
    expect(snapshot.installed).toBe(true);
    expect(snapshot.linkPath).toBe("/usr/local/bin/pier");
  });

  it("maps admin cancel to cancelled", async () => {
    const fs = kitFs({
      "/opt/homebrew/bin": { kind: "dir", writable: false },
    });
    const snapshot = await installAppCli({
      allowAdmin: true,
      host: hostWith(fs, {
        pathEnv: "/usr/bin:/bin",
        runAdmin: async () => {
          const err = new Error("User canceled.");
          (err as { stderr?: string }).stderr = "-128";
          throw err;
        },
      }),
    });
    expect(snapshot.actionOk).toBe(false);
    expect(snapshot.actionError).toBe("cancelled");
  });

  it("uninstalls only our symlink", async () => {
    const fs = kitFs({
      "/opt/homebrew/bin/pier": {
        kind: "symlink",
        target: sourcePath,
        writable: true,
      },
    });
    const snapshot = await uninstallAppCli({ host: hostWith(fs) });
    expect(snapshot.actionOk).toBe(true);
    expect(snapshot.installed).toBe(false);
    expect(fs.kind("/opt/homebrew/bin/pier")).toBe("missing");
  });
});
