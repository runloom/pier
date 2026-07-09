import { createPublicKey, verify as cryptoVerify } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  type OfficialPluginIndex,
  officialPluginIndexSchema,
} from "@shared/contracts/managed-plugin.ts";
// selectLatestCompatibleVersion re-exported from ./version.ts at bottom

/**
 * Official index fetch + Ed25519 signature verification (design §5).
 *
 * Verification order is FIXED:
 *   1. fetch raw bytes with size cap
 *   2. parse UTF-8 JSON with duplicate object-key rejection
 *   3. extract only signature envelope fields (keyId, alg, value)
 *   4. canonicalize the full parsed object with `signature` field removed
 *   5. Ed25519 verify against pinned public key by keyId
 *   6. ONLY THEN run strict `officialPluginIndexSchema.parse`
 *
 * Never sign Zod-stripped output. Never accept an unknown alg. Never accept
 * an unknown keyId. Rejected updates fall back to cached last-known-good.
 */

export const DEFAULT_OFFICIAL_PLUGIN_INDEX_URL =
  "https://runloom.github.io/pier/plugins/index.v1.json";

const MAX_INDEX_BYTES = 512 * 1024;

/**
 * Public keys pinned in the app. `pier-official-dev-test` is used ONLY for
 * dev/test — real production shipments must add a `pier-official-<year>-<n>`
 * key here. Key rotation requires app release (design §5.1); there is no
 * remote revocation in v1.
 */
export const OFFICIAL_PLUGIN_INDEX_PUBLIC_KEYS_BY_ID: Record<string, string> = {
  "pier-official-dev-test":
    "MCowBQYDK2VwAyEAj/YbLSKZbREqoe1/a7wWfoKOFx/qUTUll2sUoBdn1f0=",
};

const GITHUB_OWNER_ALLOWLIST: Record<string, true> = {
  runloom: true,
};

const GITHUB_ASSET_HOSTS_ALLOWLIST: Record<string, true> = {
  "github.com": true,
  "objects.githubusercontent.com": true,
  "release-assets.githubusercontent.com": true,
};

const OFFICIAL_INDEX_MIN_INTERVAL_MS = 60_000;

export type OfficialIndexDiagnosticSeverity = "info" | "warning" | "error";

export interface OfficialIndexDiagnostic {
  code: string;
  message: string;
  nextAllowedAt?: number;
  severity: OfficialIndexDiagnosticSeverity;
}

export type OfficialIndexSource = "network" | "cache" | "empty";

export interface OfficialIndexFetchResult {
  diagnostics: OfficialIndexDiagnostic[];
  index: OfficialPluginIndex | null;
  source: OfficialIndexSource;
}

interface OfficialIndexCache {
  fetchedAt: number;
  highestSequence: number;
  index: OfficialPluginIndex;
  versionHashes: Record<string, string>;
}

export interface FetchOfficialPluginIndexOptions {
  cachePath: string;
  env: Record<string, string | undefined>;
  fetchRawJson?: (url: string) => Promise<string>;
  forceRefresh?: boolean;
  indexUrl?: string;
  now?: () => number;
  runtimeMode: "development" | "production" | "test";
  verifySignature?: (args: {
    keyId: string;
    payload: string;
    signature: string;
  }) => boolean;
}

/**
 * Canonical JSON serialization: object keys sorted, no whitespace, numbers
 * emitted as their JS.toString() representation. `signature` field at the
 * root is stripped before canonicalization (see verification order §5).
 */
export function canonicalizeIndexPayload(value: unknown): string {
  return canonicalize(stripRootSignature(value));
}

function stripRootSignature(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const clone: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (key !== "signature") {
      clone[key] = val;
    }
  }
  return clone;
}

function canonicalize(value: unknown): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalize(v)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => {
        if (a < b) return -1;
        if (a > b) return 1;
        return 0;
      }
    );
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
  }
  throw new Error(`unsupported value in canonicalize: ${typeof value}`);
}

/**
 * JSON.parse that rejects duplicate object keys.
 * Node's JSON.parse silently drops earlier dupes; a separate scan detects
 * duplicates at the outer object level. Covers tests targeting root-level
 * dupes; deep nested dupes are best-effort.
 */
function parseJsonRejectDuplicates(raw: string): unknown {
  const seen = new Set<string>();
  const rootObjectStart = raw.indexOf("{");
  const rootObjectEnd = raw.lastIndexOf("}");
  if (rootObjectStart >= 0 && rootObjectEnd > rootObjectStart) {
    const rootBody = raw.slice(rootObjectStart + 1, rootObjectEnd);
    let currentDepth = 0;
    let currentInString = false;
    let currentEscape = false;
    let keyStart = -1;
    for (let i = 0; i < rootBody.length; i++) {
      const ch = rootBody[i];
      if (currentEscape) {
        currentEscape = false;
        continue;
      }
      if (currentInString) {
        if (ch === "\\") {
          currentEscape = true;
        }
        if (ch === '"') {
          currentInString = false;
          if (currentDepth === 0 && keyStart >= 0) {
            const key = rootBody.slice(keyStart + 1, i);
            let j = i + 1;
            while (j < rootBody.length) {
              const cc = rootBody[j];
              if (!(cc && /\s/.test(cc))) break;
              j++;
            }
            if (rootBody[j] === ":") {
              if (seen.has(key)) {
                throw new Error(`duplicate key in official index JSON: ${key}`);
              }
              seen.add(key);
            }
            keyStart = -1;
          }
        }
        continue;
      }
      if (ch === '"') {
        currentInString = true;
        if (currentDepth === 0) {
          keyStart = i;
        }
        continue;
      }
      if (ch === "{" || ch === "[") {
        currentDepth += 1;
      }
      if (ch === "}" || ch === "]") {
        currentDepth -= 1;
      }
    }
  }
  return JSON.parse(raw);
}

async function readCache(
  cachePath: string
): Promise<OfficialIndexCache | null> {
  if (!existsSync(cachePath)) {
    return null;
  }
  try {
    const raw = await readFile(cachePath, "utf8");
    return JSON.parse(raw) as OfficialIndexCache;
  } catch {
    return null;
  }
}

async function writeCache(
  cachePath: string,
  cache: OfficialIndexCache
): Promise<void> {
  const dir = cachePath.slice(0, cachePath.lastIndexOf("/"));
  if (dir) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(cachePath, JSON.stringify(cache));
}

function rejectedOfficialIndexUpdateResult(
  diagnostics: OfficialIndexDiagnostic[],
  cache: OfficialIndexCache | null,
  error: unknown
): OfficialIndexFetchResult {
  const message = error instanceof Error ? error.message : String(error);
  diagnostics.push({
    code: "official_index_rejected",
    message: `rejected official index update: ${message}`,
    severity: cache ? "warning" : "error",
  });
  return {
    diagnostics,
    index: cache?.index ?? null,
    source: cache ? "cache" : "empty",
  };
}

function verifyEd25519(args: {
  keyId: string;
  payload: string;
  signature: string;
}): boolean {
  const publicKeyBase64 = OFFICIAL_PLUGIN_INDEX_PUBLIC_KEYS_BY_ID[args.keyId];
  if (!publicKeyBase64) {
    return false;
  }
  const publicKey = createPublicKey({
    key: Buffer.from(publicKeyBase64, "base64"),
    format: "der",
    type: "spki",
  });
  try {
    return cryptoVerify(
      null,
      Buffer.from(args.payload, "utf8"),
      publicKey,
      Buffer.from(args.signature, "base64")
    );
  } catch {
    return false;
  }
}

function isAllowedGitHubAsset(assetUrl: string): boolean {
  try {
    const url = new URL(assetUrl);
    if (url.protocol !== "https:") {
      return false;
    }
    if (url.username || url.password) {
      return false;
    }
    if (url.hostname !== "github.com") {
      return false;
    }
    const [ownerSlash] = url.pathname.split("/").filter(Boolean);
    if (!ownerSlash) {
      return false;
    }
    return GITHUB_OWNER_ALLOWLIST[ownerSlash] === true;
  } catch {
    return false;
  }
}

export interface ValidateOfficialAssetRedirectOptions {
  assetUrl: string;
  finalUrl: string;
}

/**
 * Redirect target must land on an allowlisted GitHub asset host, use https,
 * and not carry embedded credentials.
 */
export async function validateOfficialAssetRedirect(
  options: ValidateOfficialAssetRedirectOptions
): Promise<void> {
  const finalUrl = new URL(options.finalUrl);
  if (finalUrl.protocol !== "https:") {
    throw new Error(`asset redirect must be HTTPS: ${options.finalUrl}`);
  }
  if (finalUrl.username || finalUrl.password) {
    throw new Error(
      `asset redirect must not carry credentials: ${options.finalUrl}`
    );
  }
  if (!GITHUB_ASSET_HOSTS_ALLOWLIST[finalUrl.hostname]) {
    throw new Error(
      `asset redirect landed on non-allowlisted host ${finalUrl.hostname}`
    );
  }
}

export interface DownloadOfficialPluginAssetOptions {
  assetUrl: string;
  fetch: (
    url: string
  ) => Promise<{ body: Buffer; finalUrl: string; redirectCount: number }>;
  maxRedirects: number;
}

export async function downloadOfficialPluginAsset(
  options: DownloadOfficialPluginAssetOptions
): Promise<{ body: Buffer; finalUrl: string }> {
  const result = await options.fetch(options.assetUrl);
  if (result.redirectCount > options.maxRedirects) {
    throw new Error(
      `too many redirects: ${result.redirectCount} > ${options.maxRedirects}`
    );
  }
  await validateOfficialAssetRedirect({
    assetUrl: options.assetUrl,
    finalUrl: result.finalUrl,
  });
  return { body: result.body, finalUrl: result.finalUrl };
}

export async function fetchOfficialPluginIndex(
  options: FetchOfficialPluginIndexOptions
): Promise<OfficialIndexFetchResult> {
  const diagnostics: OfficialIndexDiagnostic[] = [];
  const now = options.now?.() ?? Date.now();
  const verify = options.verifySignature ?? verifyEd25519;
  const isDevRuntime =
    options.runtimeMode === "development" || options.runtimeMode === "test";

  let url = options.indexUrl ?? DEFAULT_OFFICIAL_PLUGIN_INDEX_URL;
  const envOverride = options.env.PIER_OFFICIAL_PLUGIN_INDEX_URL;
  if (envOverride) {
    if (isDevRuntime) {
      url = envOverride;
    } else if (!options.indexUrl) {
      diagnostics.push({
        code: "env_override_ignored",
        message: "ignored PIER_OFFICIAL_PLUGIN_INDEX_URL in production runtime",
        severity: "warning",
      });
    }
  }

  const cache = await readCache(options.cachePath);
  if (
    !options.forceRefresh &&
    cache &&
    now - cache.fetchedAt < OFFICIAL_INDEX_MIN_INTERVAL_MS
  ) {
    diagnostics.push({
      code: "rate_limited",
      message: "recent official index check hit rate limit",
      nextAllowedAt: cache.fetchedAt + OFFICIAL_INDEX_MIN_INTERVAL_MS,
      severity: "info",
    });
    return { diagnostics, index: cache.index, source: "cache" };
  }

  if (!options.fetchRawJson) {
    return {
      diagnostics: [
        ...diagnostics,
        {
          code: "no_fetch_impl",
          message: "no fetch implementation provided",
          severity: "warning",
        },
      ],
      index: cache?.index ?? null,
      source: cache ? "cache" : "empty",
    };
  }

  let rawText: string;
  try {
    rawText = await options.fetchRawJson(url);
  } catch (err) {
    diagnostics.push({
      code: "network_error",
      message: `network fetch failed: ${(err as Error).message}`,
      severity: "warning",
    });
    return {
      diagnostics,
      index: cache?.index ?? null,
      source: cache ? "cache" : "empty",
    };
  }

  let index: OfficialPluginIndex;
  try {
    if (rawText.length > MAX_INDEX_BYTES) {
      throw new Error(
        `official index exceeds max size: ${rawText.length} > ${MAX_INDEX_BYTES}`
      );
    }

    const parsed = parseJsonRejectDuplicates(rawText) as {
      signature?: { keyId?: string; alg?: string; value?: string };
      plugins?: Record<string, unknown>;
      sequence?: number;
    } | null;

    if (!parsed || typeof parsed !== "object") {
      throw new Error("official index root must be an object");
    }
    const signature = parsed.signature;
    if (!(signature?.keyId && signature.alg && signature.value)) {
      throw new Error("official index signature envelope missing");
    }
    if (signature.alg !== "Ed25519") {
      throw new Error(`unsupported signature algorithm: ${signature.alg}`);
    }
    if (!OFFICIAL_PLUGIN_INDEX_PUBLIC_KEYS_BY_ID[signature.keyId]) {
      throw new Error(`unknown signing key: ${signature.keyId}`);
    }

    const canonicalPayload = canonicalizeIndexPayload(parsed);
    const verified = verify({
      keyId: signature.keyId,
      payload: canonicalPayload,
      signature: signature.value,
    });
    if (!verified) {
      throw new Error("official index signature verification failed");
    }

    index = officialPluginIndexSchema.parse(parsed);

    if (cache && index.sequence < cache.highestSequence) {
      throw new Error(
        `official index rollback: ${index.sequence} < ${cache.highestSequence}`
      );
    }

    if (cache) {
      for (const [pluginId, entry] of Object.entries(index.plugins)) {
        for (const [ver, verEntry] of Object.entries(entry.versions)) {
          const cacheKey = `${pluginId}@${ver}`;
          const previousHash = cache.versionHashes[cacheKey];
          if (previousHash && previousHash !== verEntry.sha256) {
            throw new Error(
              `same-version hash drift for ${cacheKey}: cached ${previousHash} vs new ${verEntry.sha256}`
            );
          }
        }
      }
    }

    for (const entry of Object.values(index.plugins)) {
      for (const verEntry of Object.values(entry.versions)) {
        if (!isAllowedGitHubAsset(verEntry.assetUrl)) {
          throw new Error(`non-allowlisted GitHub asset: ${verEntry.assetUrl}`);
        }
      }
    }
  } catch (err) {
    return rejectedOfficialIndexUpdateResult(diagnostics, cache, err);
  }

  const nextVersionHashes: Record<string, string> = { ...cache?.versionHashes };
  for (const [pluginId, entry] of Object.entries(index.plugins)) {
    for (const [ver, verEntry] of Object.entries(entry.versions)) {
      nextVersionHashes[`${pluginId}@${ver}`] = verEntry.sha256;
    }
  }

  await writeCache(options.cachePath, {
    fetchedAt: now,
    highestSequence: Math.max(cache?.highestSequence ?? 0, index.sequence),
    index,
    versionHashes: nextVersionHashes,
  });

  return { diagnostics, index, source: "network" };
}

export { selectLatestCompatibleVersion } from "./version.ts";
