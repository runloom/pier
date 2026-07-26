import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  BundledPluginRegistration,
  OperationsContext,
} from "./install-operations.ts";
import { downloadOfficialPluginAsset } from "./official-index.ts";
import { selectNewestVersion } from "./version.ts";

/**
 * Chooses which archive to install for a bundled plugin id.
 *
 * Production priority: official index 与 bundled 中版本较新者；同版本优先官方资产。
 * Development priority: **always** workspace bundled package when available.
 * That isolates local plugin work from published GitHub release assets so
 * "Install" never re-pins an older official tgz over the package under
 * packages/plugin-*.
 *
 * HTTP is only attempted (prod) when the operations context has both an
 * `officialIndexProvider` result (with matching entry) AND an `assetFetcher`.
 * Any failure (download, redirect budget, size mismatch, sha256 mismatch)
 * falls back to the bundled archive so first-launch offline installs still
 * succeed.
 */

export interface ResolvedInstallSource {
  archivePath: string;
  logKind: "install-from-bundle" | "install";
  packageUrl: string;
  sha256: string;
  size?: number;
  version: string;
}

export interface ResolvedOfficialUpdateSource {
  archivePath: string;
  /** Present for HTTP official assets; omitted for bundled archives. */
  assetUrl?: string;
  /** Official index sequence when the asset came from the signed index. */
  officialIndexSequence?: number;
  packageUrl: string;
  sha256: string;
  size?: number;
  version: string;
}

export interface OfficialUpdateSourceFailure {
  code:
    | "engine_incompatible"
    | "hash_mismatch"
    | "network"
    | "not_found"
    | "internal_error";
  message: string;
}

function bundledInstallSource(
  bundled: BundledPluginRegistration
): ResolvedInstallSource {
  return {
    archivePath: bundled.archivePath,
    logKind: "install-from-bundle",
    packageUrl: `bundled://${bundled.id}/${bundled.version}`,
    sha256: bundled.sha256,
    ...(bundled.size ? { size: bundled.size } : {}),
    version: bundled.version,
  };
}

function bundledUpdateSource(
  bundled: BundledPluginRegistration,
  officialIndexSequence?: number
): ResolvedOfficialUpdateSource {
  return {
    archivePath: bundled.archivePath,
    packageUrl: `bundled://${bundled.id}/${bundled.version}`,
    sha256: bundled.sha256,
    version: bundled.version,
    ...(bundled.size ? { size: bundled.size } : {}),
    ...(officialIndexSequence === undefined ? {} : { officialIndexSequence }),
  };
}

export async function resolveInstallSource(
  ctx: OperationsContext,
  bundled: BundledPluginRegistration
): Promise<ResolvedInstallSource> {
  // Workspace mode: never pull official release assets — pin to dist-pkg in repo.
  // Release mode (including `PIER_PLUGIN_MODE=release` under electron-vite) may
  // still fetch the official index so developers can simulate production install.
  if (ctx.pluginMode === "workspace") {
    return bundledInstallSource(bundled);
  }

  if (ctx.officialIndexRefresh) {
    await ctx.officialIndexRefresh().catch(() => {
      /* fall through to bundled */
    });
  }
  const index = ctx.officialIndexProvider();
  const entry = index?.plugins[bundled.id];
  const fetcher = ctx.assetFetcher;
  const newestVersion = selectNewestVersion([entry?.latest, bundled.version]);
  if (entry && fetcher && newestVersion === entry.latest) {
    const targetVersion = entry.latest;
    const asset = entry.versions[targetVersion];
    if (asset) {
      try {
        const download = await downloadOfficialPluginAsset({
          assetUrl: asset.assetUrl,
          fetch: fetcher,
          maxRedirects: 3,
        });
        if (download.body.length !== asset.size) {
          throw new Error(
            `size mismatch: expected ${asset.size}, got ${download.body.length}`
          );
        }
        const hash = createHash("sha256").update(download.body).digest("hex");
        if (hash !== asset.sha256) {
          throw new Error(
            `sha256 mismatch: expected ${asset.sha256}, got ${hash}`
          );
        }
        const stagedPath = join(
          ctx.paths.stagingDir,
          `${bundled.id}-${targetVersion}-${ctx.now()}.tgz`
        );
        await writeFile(stagedPath, download.body);
        return {
          archivePath: stagedPath,
          logKind: "install",
          packageUrl: download.finalUrl,
          sha256: asset.sha256,
          size: asset.size,
          version: targetVersion,
        };
      } catch {
        /* fall through to bundled */
      }
    }
  }
  return bundledInstallSource(bundled);
}

/**
 * Resolves the archive for an already-installed plugin update.
 *
 * Target version matches catalog: max(official.latest, bundled.version).
 * Same-version prefers the official HTTP asset when available (install parity);
 * otherwise uses the app-bundled tgz. This avoids catalog showing "Update"
 * while update() no-ops on an older official latest.
 */
export async function resolveOfficialUpdateSource(
  ctx: OperationsContext,
  id: string
): Promise<
  | { ok: true; source: ResolvedOfficialUpdateSource }
  | { ok: false; error: OfficialUpdateSourceFailure }
> {
  if (ctx.officialIndexRefresh) {
    await ctx.officialIndexRefresh().catch(() => {
      /* fall through to cached index + bundled, same as install */
    });
  }
  const index = ctx.officialIndexProvider();
  const entry = index?.plugins[id];
  const bundled = ctx.bundledPlugins.find((candidate) => candidate.id === id);
  const targetVersion = selectNewestVersion([entry?.latest, bundled?.version]);
  if (!targetVersion) {
    return {
      error: {
        code: "not_found",
        message: `no update source for plugin: ${id}`,
      },
      ok: false,
    };
  }

  // Prefer official HTTP when it owns the newest target (install parity).
  if (entry && entry.latest === targetVersion && ctx.assetFetcher) {
    const asset = entry.versions[targetVersion];
    if (asset) {
      try {
        const download = await downloadOfficialPluginAsset({
          assetUrl: asset.assetUrl,
          fetch: ctx.assetFetcher,
          maxRedirects: 3,
        });
        if (download.body.length !== asset.size) {
          throw new Error(
            `size mismatch: expected ${asset.size}, got ${download.body.length}`
          );
        }
        const hash = createHash("sha256").update(download.body).digest("hex");
        if (hash !== asset.sha256) {
          throw new Error(
            `sha256 mismatch: expected ${asset.sha256}, got ${hash}`
          );
        }
        const stagedPath = join(
          ctx.paths.stagingDir,
          `${id}-${targetVersion}-${ctx.now()}.tgz`
        );
        await writeFile(stagedPath, download.body);
        return {
          ok: true,
          source: {
            archivePath: stagedPath,
            assetUrl: asset.assetUrl,
            officialIndexSequence: index?.sequence,
            packageUrl: download.finalUrl,
            sha256: asset.sha256,
            size: asset.size,
            version: targetVersion,
          },
        };
      } catch (err) {
        // Same version available as bundled → offline / corrupt download can
        // still promote from the ship-with-app archive (install parity).
        // Stamp index sequence only here: the signed index listed this version
        // and we fell back after a failed HTTP fetch of that asset.
        if (bundled?.version === targetVersion) {
          return {
            ok: true,
            source: bundledUpdateSource(bundled, index?.sequence),
          };
        }
        const message = err instanceof Error ? err.message : String(err);
        const isIntegrity =
          message.includes("size mismatch") ||
          message.includes("sha256 mismatch");
        return {
          error: {
            code: isIntegrity ? "hash_mismatch" : "network",
            message: isIntegrity
              ? message
              : `failed to download official plugin update: ${message}`,
          },
          ok: false,
        };
      }
    }
  }

  // Pure bundled target (newer than official latest, or no official entry).
  // Do not stamp officialIndexSequence — the archive did not come from the
  // signed index asset for this version.
  if (bundled && bundled.version === targetVersion) {
    return {
      ok: true,
      source: bundledUpdateSource(bundled),
    };
  }

  if (entry?.latest === targetVersion) {
    if (!entry.versions[targetVersion]) {
      return {
        error: {
          code: "not_found",
          message: `official index missing asset for ${id}@${targetVersion}`,
        },
        ok: false,
      };
    }
    if (!ctx.assetFetcher) {
      return {
        error: {
          code: "network",
          message: "official plugin asset fetcher is not configured",
        },
        ok: false,
      };
    }
  }

  return {
    error: {
      code: "not_found",
      message: `no update source for plugin: ${id}@${targetVersion}`,
    },
    ok: false,
  };
}
