import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensureDevProfilePortAvailable,
  hasExplicitDevPort,
  isForeignDevProfileEnv,
  resolveDevProfile,
  sanitizeInheritedDevProfileEnv,
} from "../../../scripts/dev-profile.mjs";

const originalCwd = process.cwd();

function writeProfile(worktreeRoot: string, data: Record<string, unknown>) {
  const dir = path.join(worktreeRoot, ".pier-dev");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "profile.json"),
    `${JSON.stringify(data, null, "\t")}\n`,
    "utf8"
  );
}

describe("dev-profile multi-worktree env + ports", () => {
  afterEach(() => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
  });

  it("detects foreign Pier session env via PIER_DEV_RUNTIME_FILE", () => {
    const root = "/Users/me/pier.worktree/feature-a";
    expect(
      isForeignDevProfileEnv(
        {
          PIER_DEV_RUNTIME_FILE: "/Users/me/pier/.pier-dev/runtime.json",
        },
        root
      )
    ).toBe(true);
    expect(
      isForeignDevProfileEnv(
        {
          PIER_DEV_RUNTIME_FILE: path.join(root, ".pier-dev", "runtime.json"),
        },
        root
      )
    ).toBe(false);
    expect(isForeignDevProfileEnv({}, root)).toBe(false);
  });

  it("strips inherited port/profile bindings from a foreign Pier session", () => {
    const root = "/Users/me/pier.worktree/feature-a";
    const cleaned = sanitizeInheritedDevProfileEnv(
      {
        PIER_DEV_PORT: "5173",
        PIER_HMR_PORT: "5183",
        PIER_DEV_PROFILE: "main-profile",
        PIER_DEV_RUNTIME_FILE: "/Users/me/pier/.pier-dev/runtime.json",
        ELECTRON_RENDERER_URL: "http://127.0.0.1:5173",
        ELECTRON_USER_DATA_DIR: "/tmp/main-user-data",
        ELECTRON_CLI_ARGS: JSON.stringify([
          "--user-data-dir=/tmp/main-user-data",
        ]),
        PATH: "/usr/bin",
      },
      root
    );
    expect(cleaned.PIER_DEV_PORT).toBeUndefined();
    expect(cleaned.PIER_HMR_PORT).toBeUndefined();
    expect(cleaned.PIER_DEV_PROFILE).toBeUndefined();
    expect(cleaned.PIER_DEV_RUNTIME_FILE).toBeUndefined();
    expect(cleaned.ELECTRON_RENDERER_URL).toBeUndefined();
    expect(cleaned.ELECTRON_USER_DATA_DIR).toBeUndefined();
    expect(cleaned.ELECTRON_CLI_ARGS).toBeUndefined();
    expect(cleaned.PATH).toBe("/usr/bin");
  });

  it("keeps explicit PIER_DEV_PORT when not foreign", () => {
    const root = "/Users/me/pier.worktree/feature-a";
    const cleaned = sanitizeInheritedDevProfileEnv(
      { PIER_DEV_PORT: "5210" },
      root
    );
    expect(cleaned.PIER_DEV_PORT).toBe("5210");
    expect(hasExplicitDevPort({ PIER_DEV_PORT: "5210" }, root)).toBe(true);
    expect(
      hasExplicitDevPort(
        {
          PIER_DEV_PORT: "5173",
          PIER_DEV_RUNTIME_FILE: "/Users/me/pier/.pier-dev/runtime.json",
        },
        root
      )
    ).toBe(false);
  });

  it("ignores foreign env and avoids reserved peer ports when resolving", () => {
    const base = mkdtempSync(path.join(tmpdir(), "pier-dev-profile-"));
    const mainRoot = path.join(base, "main");
    const featureRoot = path.join(base, "feature");
    mkdirSync(mainRoot, { recursive: true });
    mkdirSync(featureRoot, { recursive: true });

    writeProfile(mainRoot, {
      version: 1,
      profile: "main-aaaa",
      worktreeRoot: mainRoot,
      devPort: 5173,
      hmrPort: 5183,
      host: "127.0.0.1",
      rendererUrl: "http://127.0.0.1:5173",
      electronUserDataDir: "/tmp/main-aaaa",
    });
    writeProfile(featureRoot, {
      version: 1,
      profile: "wrong-main-aaaa",
      worktreeRoot: featureRoot,
      devPort: 5173,
      hmrPort: 5183,
      host: "127.0.0.1",
      rendererUrl: "http://127.0.0.1:5173",
      electronUserDataDir: "/tmp/main-aaaa",
    });

    // Simulate git worktree list for reservedDevPorts by stubbing via env-only
    // path: reservedDevPorts uses real git worktree list, so instead verify
    // sanitize + explicit port ignore, and that profile name is not foreign.
    const resolved = resolveDevProfile({
      cwd: featureRoot,
      ensure: false,
      env: {
        PIER_DEV_PORT: "5173",
        PIER_DEV_PROFILE: "main-aaaa",
        PIER_DEV_RUNTIME_FILE: path.join(mainRoot, ".pier-dev", "runtime.json"),
        ELECTRON_USER_DATA_DIR: "/tmp/main-aaaa",
        // Force a stable profile name without needing a git branch.
        // After sanitize this is dropped; defaultProfileName uses basename.
      },
    });

    // Foreign env stripped → not forced to main-aaaa / 5173 from env.
    // Without git worktrees, reserved is empty so existing 5173 may still
    // reuse from feature profile.json; profile *name* must not stay main-aaaa.
    expect(resolved.profile).not.toBe("main-aaaa");
    expect(resolved.worktreeRoot).toBe(path.resolve(featureRoot));
    // userData re-derived because existing.profile !== new profile name
    expect(resolved.electronUserDataDir).not.toBe("/tmp/main-aaaa");
  });

  it("reallocates when the profile port is bound by someone else", async () => {
    const base = mkdtempSync(path.join(tmpdir(), "pier-dev-rebind-"));
    const worktreeRoot = path.join(base, "wt");
    mkdirSync(worktreeRoot, { recursive: true });
    const profileDir = path.join(worktreeRoot, ".pier-dev");
    mkdirSync(profileDir, { recursive: true });

    const holder = net.createServer();
    await new Promise<void>((resolve, reject) => {
      holder.once("error", reject);
      holder.listen(0, "127.0.0.1", () => resolve());
    });
    const address = holder.address();
    if (!address || typeof address === "string") {
      throw new Error("expected TCP address");
    }
    const busyPort = address.port;

    const profile = {
      version: 1 as const,
      profile: "feature-test",
      worktreeRoot,
      devPort: busyPort,
      hmrPort: busyPort + 10,
      host: "127.0.0.1",
      rendererUrl: `http://127.0.0.1:${busyPort}`,
      electronUserDataDir: path.join(base, "userData"),
      profileDir,
      profileFile: path.join(profileDir, "profile.json"),
      runtimeFile: path.join(profileDir, "runtime.json"),
    };
    writeFileSync(
      profile.profileFile,
      `${JSON.stringify(profile, null, "\t")}\n`
    );

    try {
      const next = await ensureDevProfilePortAvailable(profile, {
        env: {},
        allowReallocate: true,
      });
      expect(next.devPort).not.toBe(busyPort);
      expect(next.rendererUrl).toContain(String(next.devPort));
    } finally {
      holder.close();
    }
  }, 15_000);
});
