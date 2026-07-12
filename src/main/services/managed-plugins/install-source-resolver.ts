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
 * Priority: official index 与 bundled 中版本较新者；同版本优先官方资产。
 * HTTP is only attempted when the operations context has both an
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
  assetUrl: string;
  officialIndexSequence: number;
  packageUrl: string;
  sha256: string;
  size: number;
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

export async function resolveInstallSource(
  ctx: OperationsContext,
  bundled: BundledPluginRegistration
): Promise<ResolvedInstallSource> {
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
  return {
    archivePath: bundled.archivePath,
    logKind: "install-from-bundle",
    packageUrl: `bundled://${bundled.id}/${bundled.version}`,
    sha256: bundled.sha256,
    ...(bundled.size ? { size: bundled.size } : {}),
    version: bundled.version,
  };
}

export async function resolveOfficialUpdateSource(
  ctx: OperationsContext,
  id: string
): Promise<
  | { ok: true; source: ResolvedOfficialUpdateSource }
  | { ok: false; error: OfficialUpdateSourceFailure }
> {
  try {
    if (ctx.officialIndexRefresh) {
      await ctx.officialIndexRefresh();
    }
  } catch (err) {
    return {
      error: {
        code: "network",
        message: `failed to refresh official plugin index: ${(err as Error).message}`,
      },
      ok: false,
    };
  }
  const index = ctx.officialIndexProvider();
  const entry = index?.plugins[id];
  if (!(index && entry)) {
    return {
      error: {
        code: "not_found",
        message: `no official update source for plugin: ${id}`,
      },
      ok: false,
    };
  }
  const targetVersion = entry.latest;
  const asset = entry.versions[targetVersion];
  if (!asset) {
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
  try {
    const download = await downloadOfficialPluginAsset({
      assetUrl: asset.assetUrl,
      fetch: ctx.assetFetcher,
      maxRedirects: 3,
    });
    if (download.body.length !== asset.size) {
      return {
        error: {
          code: "hash_mismatch",
          message: `size mismatch: expected ${asset.size}, got ${download.body.length}`,
        },
        ok: false,
      };
    }
    const hash = createHash("sha256").update(download.body).digest("hex");
    if (hash !== asset.sha256) {
      return {
        error: {
          code: "hash_mismatch",
          message: `sha256 mismatch: expected ${asset.sha256}, got ${hash}`,
        },
        ok: false,
      };
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
        officialIndexSequence: index.sequence,
        packageUrl: download.finalUrl,
        sha256: asset.sha256,
        size: asset.size,
        version: targetVersion,
      },
    };
  } catch (err) {
    return {
      error: {
        code: "network",
        message: `failed to download official plugin update: ${(err as Error).message}`,
      },
      ok: false,
    };
  }
}
