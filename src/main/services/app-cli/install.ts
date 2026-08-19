import { homedir } from "node:os";
import type {
  AppCliAction,
  AppCliActionError,
  AppCliSnapshot,
} from "@shared/contracts/app-cli.ts";
import { isDevRuntime } from "../../runtime-mode.ts";
import {
  buildAdminLinkCommand,
  buildAdminUnlinkCommand,
  isAdminCancelled,
  runMacAdminShell,
} from "./admin.ts";
import {
  type AppCliFs,
  createNodeAppCliFs,
  errnoFromUnknown,
  isOurCliLink,
  parentDir,
} from "./fs.ts";
import {
  packagedCliScriptPath,
  packagedCliSourcePath,
  resolveLinkCandidate,
} from "./paths.ts";

export interface AppCliHost {
  fs: AppCliFs;
  home: string;
  isDev: boolean;
  pathEnv: string;
  platform: NodeJS.Platform | string;
  resourcesPath: string;
  runAdmin?: (command: string) => Promise<void>;
}

function snapshot(
  partial: Omit<AppCliSnapshot, "action" | "actionError" | "actionOk"> & {
    action: AppCliAction;
    actionError?: AppCliActionError | null;
    actionOk?: boolean;
  }
): AppCliSnapshot {
  return {
    actionError: partial.actionError ?? null,
    actionOk: partial.actionOk ?? true,
    conflictPath: partial.conflictPath,
    detail: partial.detail,
    installed: partial.installed,
    linkPath: partial.linkPath,
    needsAdmin: partial.needsAdmin,
    sourcePath: partial.sourcePath,
    action: partial.action,
  };
}

export function createAppCliHost(
  overrides: Partial<AppCliHost> = {}
): AppCliHost {
  return {
    fs: createNodeAppCliFs(),
    home: homedir(),
    isDev: isDevRuntime(),
    pathEnv: process.env.PATH ?? "",
    platform: process.platform,
    resourcesPath: process.resourcesPath ?? "",
    runAdmin: runMacAdminShell,
    ...overrides,
  };
}

function unavailable(
  action: AppCliAction,
  error: Extract<
    AppCliActionError,
    "dev" | "missing-source" | "unsupported-platform"
  >,
  sourcePath: string | null
): AppCliSnapshot {
  return snapshot({
    action,
    actionError: error,
    actionOk: action === "status",
    conflictPath: null,
    detail: null,
    installed: false,
    linkPath: null,
    needsAdmin: false,
    sourcePath,
  });
}

function inspectBase(host: AppCliHost, action: AppCliAction): AppCliSnapshot {
  const sourcePath =
    host.resourcesPath.length > 0
      ? packagedCliSourcePath(host.resourcesPath)
      : null;
  if (host.isDev) {
    return unavailable(action, "dev", sourcePath);
  }
  if (host.platform !== "darwin") {
    return unavailable(action, "unsupported-platform", sourcePath);
  }
  const scriptPath = host.resourcesPath
    ? packagedCliScriptPath(host.resourcesPath)
    : null;
  const sourceKind = sourcePath ? host.fs.kind(sourcePath) : "missing";
  if (
    !sourcePath ||
    (sourceKind !== "file" && sourceKind !== "symlink") ||
    !scriptPath ||
    !host.fs.existsFile(scriptPath)
  ) {
    return unavailable(action, "missing-source", sourcePath);
  }

  const candidate = resolveLinkCandidate({
    canWrite: (dir) => host.fs.canWrite(dir),
    existsDir: (dir) => host.fs.existsDir(dir),
    home: host.home,
    pathEnv: host.pathEnv,
    platform: host.platform,
  });
  if (!candidate) {
    return unavailable(action, "unsupported-platform", sourcePath);
  }

  const kind = host.fs.kind(candidate.linkPath);
  if (kind === "missing") {
    return snapshot({
      action,
      conflictPath: null,
      detail: null,
      installed: false,
      linkPath: candidate.linkPath,
      needsAdmin: candidate.needsAdmin,
      sourcePath,
    });
  }
  if (isOurCliLink(host.fs, candidate.linkPath, sourcePath)) {
    const parent = parentDir(candidate.linkPath);
    return snapshot({
      action,
      conflictPath: null,
      detail: null,
      installed: true,
      linkPath: candidate.linkPath,
      needsAdmin: !host.fs.canWrite(parent),
      sourcePath,
    });
  }

  return snapshot({
    action,
    actionError: "conflict",
    actionOk: action === "status",
    conflictPath: candidate.linkPath,
    detail: null,
    installed: false,
    linkPath: candidate.linkPath,
    needsAdmin: false,
    sourcePath,
  });
}

export function inspectAppCli(
  host: AppCliHost = createAppCliHost()
): AppCliSnapshot {
  return inspectBase(host, "status");
}

async function withAdmin(
  host: AppCliHost,
  command: string
): Promise<{ cancelled: boolean; detail: string | null; ok: boolean }> {
  const run = host.runAdmin;
  if (!run) {
    return { cancelled: false, detail: "admin helper missing", ok: false };
  }
  try {
    await run(command);
    return { cancelled: false, detail: null, ok: true };
  } catch (err) {
    if (isAdminCancelled(err)) {
      return { cancelled: true, detail: null, ok: false };
    }
    return {
      cancelled: false,
      detail: err instanceof Error ? err.message : String(err),
      ok: false,
    };
  }
}

function failed(
  base: AppCliSnapshot,
  action: AppCliAction,
  detail: string | null
): AppCliSnapshot {
  return snapshot({
    ...base,
    action,
    actionError: "failed",
    actionOk: false,
    detail,
  });
}

export async function installAppCli(
  options: { allowAdmin?: boolean; host?: AppCliHost } = {}
): Promise<AppCliSnapshot> {
  const host = options.host ?? createAppCliHost();
  const base = inspectBase(host, "install");
  if (
    base.actionError === "dev" ||
    base.actionError === "unsupported-platform" ||
    base.actionError === "missing-source"
  ) {
    return base;
  }
  if (base.actionError === "conflict") {
    return snapshot({ ...base, action: "install", actionOk: false });
  }
  if (base.installed && base.sourcePath && base.linkPath) {
    return snapshot({ ...base, action: "install", actionOk: true });
  }
  if (!(base.sourcePath && base.linkPath)) {
    return failed(base, "install", "missing install path");
  }

  const existingKind = host.fs.kind(base.linkPath);
  if (
    existingKind !== "missing" &&
    !isOurCliLink(host.fs, base.linkPath, base.sourcePath)
  ) {
    return snapshot({
      ...base,
      action: "install",
      actionError: "conflict",
      actionOk: false,
      conflictPath: base.linkPath,
    });
  }

  const parent = parentDir(base.linkPath);
  const writeDirect = host.fs.existsDir(parent) && host.fs.canWrite(parent);
  if (writeDirect) {
    try {
      if (host.fs.kind(base.linkPath) !== "missing") {
        host.fs.unlink(base.linkPath);
      }
      host.fs.symlink(base.sourcePath, base.linkPath);
      return inspectBase(host, "install");
    } catch (err) {
      return failed(
        base,
        "install",
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (!options.allowAdmin) {
    return snapshot({
      ...base,
      action: "install",
      actionOk: false,
      actionError: null,
      needsAdmin: true,
    });
  }

  const admin = await withAdmin(
    host,
    buildAdminLinkCommand(base.sourcePath, base.linkPath)
  );
  if (admin.cancelled) {
    return snapshot({
      ...base,
      action: "install",
      actionError: "cancelled",
      actionOk: false,
    });
  }
  if (!admin.ok) {
    return failed(base, "install", admin.detail);
  }
  return inspectBase(host, "install");
}

export async function uninstallAppCli(
  options: { allowAdmin?: boolean; host?: AppCliHost } = {}
): Promise<AppCliSnapshot> {
  const host = options.host ?? createAppCliHost();
  const base = inspectBase(host, "uninstall");
  if (
    base.actionError === "dev" ||
    base.actionError === "unsupported-platform" ||
    base.actionError === "missing-source"
  ) {
    return base;
  }
  if (!(base.installed && base.linkPath && base.sourcePath)) {
    return snapshot({ ...base, action: "uninstall", actionOk: true });
  }
  if (!isOurCliLink(host.fs, base.linkPath, base.sourcePath)) {
    return snapshot({
      ...base,
      action: "uninstall",
      actionError: "conflict",
      actionOk: false,
    });
  }

  const parent = parentDir(base.linkPath);
  if (host.fs.canWrite(parent)) {
    try {
      host.fs.unlink(base.linkPath);
      return inspectBase(host, "uninstall");
    } catch (err) {
      const code = errnoFromUnknown(err);
      if (code !== "EACCES" && code !== "EPERM") {
        return failed(
          base,
          "uninstall",
          err instanceof Error ? err.message : String(err)
        );
      }
    }
  }

  if (!options.allowAdmin) {
    return snapshot({
      ...base,
      action: "uninstall",
      actionOk: false,
      needsAdmin: true,
    });
  }

  const admin = await withAdmin(host, buildAdminUnlinkCommand(base.linkPath));
  if (admin.cancelled) {
    return snapshot({
      ...base,
      action: "uninstall",
      actionError: "cancelled",
      actionOk: false,
    });
  }
  if (!admin.ok) {
    return failed(base, "uninstall", admin.detail);
  }
  return inspectBase(host, "uninstall");
}
