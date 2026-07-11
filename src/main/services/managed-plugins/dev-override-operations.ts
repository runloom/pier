import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ManagedPluginOperationResult } from "@shared/contracts/managed-plugin.ts";
import type { OperationsContext } from "./install-operations.ts";
import { validateManagedPluginPackage } from "./package-validation.ts";

export async function performSetDevOverride(
  ctx: OperationsContext,
  id: string,
  path: string
): Promise<ManagedPluginOperationResult> {
  if (!ctx.isDevRuntime) {
    await ctx.appendOperationLog({
      actorKind: "desktop-renderer",
      operation: "devOverride.set",
      pluginId: id,
      result: "denied",
      timestamp: ctx.now(),
    });
    return {
      error: {
        code: "denied" as const,
        message: "dev override is not permitted in production runtime",
      },
      ok: false as const,
    };
  }
  let devVersion: string;
  try {
    const parsed = JSON.parse(
      await readFile(join(path, "plugin.json"), "utf8")
    ) as { version?: string };
    if (typeof parsed.version !== "string") {
      throw new Error("plugin.json missing string version");
    }
    devVersion = parsed.version;
    await validateManagedPluginPackage({
      archivePath: null,
      expectedId: id,
      expectedSha256: null,
      expectedSize: null,
      expectedVersion: devVersion,
      packageDir: path,
      pierVersion: ctx.pierVersion,
    });
  } catch (error) {
    return {
      error: {
        code: "invalid_state" as const,
        message: `dev override package invalid: ${(error as Error).message}`,
      },
      ok: false as const,
    };
  }
  const entry = ctx.store.get().plugins[id];
  const registeredAt = ctx.now();
  ctx.store.mutate((state) => ({
    ...state,
    plugins: {
      ...state.plugins,
      [id]: {
        activeVersion: entry?.activeVersion ?? null,
        devOverride: { path, registeredAt, version: devVersion },
        effectiveAtStartup: entry?.effectiveAtStartup ?? null,
        enabled: entry?.enabled ?? true,
        id,
        installedVersions: entry?.installedVersions ?? {},
        lastKnownGoodVersion: entry?.lastKnownGoodVersion ?? null,
        pendingRestart: { kind: "devOverride" },
        pendingUpdate: entry?.pendingUpdate ?? null,
        source: entry?.source ?? { kind: "devOverride" },
      },
    },
  }));
  await ctx.store.flush();
  await ctx.appendOperationLog({
    actorKind: "desktop-renderer",
    operation: "devOverride.set",
    pluginId: id,
    result: "success",
    timestamp: registeredAt,
  });
  return { ok: true as const, pluginId: id, requiresRestart: true };
}

export async function performClearDevOverride(
  ctx: OperationsContext,
  id: string
): Promise<ManagedPluginOperationResult> {
  if (!ctx.isDevRuntime) {
    return {
      error: {
        code: "denied" as const,
        message: "dev override is not permitted in production runtime",
      },
      ok: false as const,
    };
  }
  const entry = ctx.store.get().plugins[id];
  if (!entry) {
    return {
      error: {
        code: "not_found" as const,
        message: `plugin ${id} not installed`,
      },
      ok: false as const,
    };
  }
  ctx.store.mutate((state) => ({
    ...state,
    plugins: {
      ...state.plugins,
      [id]: {
        ...entry,
        devOverride: null,
        pendingRestart: { kind: "devOverride" },
      },
    },
  }));
  await ctx.store.flush();
  await ctx.appendOperationLog({
    actorKind: "desktop-renderer",
    operation: "devOverride.clear",
    pluginId: id,
    result: "success",
    timestamp: ctx.now(),
  });
  return { ok: true as const, pluginId: id, requiresRestart: true };
}
