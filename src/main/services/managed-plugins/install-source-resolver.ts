import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  BundledPluginRegistration,
  OperationsContext,
} from "./install-operations.ts";
import { downloadOfficialPluginAsset } from "./official-index.ts";

/**
 * Chooses which archive to install for a bundled plugin id.
 *
 * Priority: HTTP fetch of the official index's latest version → bundled tgz.
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
  if (entry && fetcher) {
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
