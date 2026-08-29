/**
 * 候选版本更新目标解析（设置「接收候选版本」开启时）。
 *
 * 为什么不用 electron-updater 的 allowPrerelease：本仓库 GitHub Releases 混有
 * 插件 prerelease（plugin-<tail>-v*），allowPrerelease 未设 channel 时直接取
 * Atom feed 第一条（可能是插件 tag → 拿不到 latest-mac.yml 硬错）；设 channel="rc"
 * 又会跳过更新的稳定版（候选用户等不到晋升后的正式版）。因此宿主自行解析：
 * 只认宿主 tag，semver 全序取最大；最大是候选才切换 feed 指向该 tag。
 * 规格：docs/superpowers/specs/2026-08-29-host-release-candidate-gold-standard.md
 */
import { gt, lte, valid } from "semver";

/** 与 electron-builder.yml publish.owner/repo 对齐（客户端运行时无法读该文件）。 */
export const HOST_RELEASE_OWNER = "runloom";
export const HOST_RELEASE_REPO = "pier";

const HOST_RELEASE_TAG_RE = /^v\d+\.\d+\.\d+(-rc\.\d+)?$/;
const CANDIDATE_SUFFIX_RE = /-rc\.\d+$/;

export type HostUpdateTarget =
  | { kind: "latest" }
  | { kind: "candidate"; tag: string };

/**
 * 从 release tag 全集里选更新目标。
 * - 只认宿主 tag（vX.Y.Z / vX.Y.Z-rc.N）；插件等其它 tag 忽略
 * - semver 全序最大者为稳定版 → 走默认 Latest 通道
 * - 最大者为候选且比当前版本新 → 指向该候选 tag
 */
export function pickHostUpdateTarget(
  tagNames: readonly string[],
  currentVersion: string
): HostUpdateTarget {
  const hostTags = tagNames.filter((tag) => HOST_RELEASE_TAG_RE.test(tag));
  if (hostTags.length === 0) {
    return { kind: "latest" };
  }
  const newest = hostTags.reduce((max, tag) =>
    gt(tag.slice(1), max.slice(1)) ? tag : max
  );
  if (!CANDIDATE_SUFFIX_RE.test(newest)) {
    return { kind: "latest" };
  }
  const current = valid(currentVersion);
  if (current && lte(newest.slice(1), current)) {
    return { kind: "latest" };
  }
  return { kind: "candidate", tag: newest };
}

/** electron-updater setFeedURL 目标：候选钉到具体 tag 的 generic feed。 */
export function feedConfigForTarget(
  target: HostUpdateTarget
):
  | { provider: "generic"; url: string }
  | { owner: string; provider: "github"; repo: string } {
  if (target.kind === "candidate") {
    return {
      provider: "generic",
      url: `https://github.com/${HOST_RELEASE_OWNER}/${HOST_RELEASE_REPO}/releases/download/${target.tag}`,
    };
  }
  return {
    owner: HOST_RELEASE_OWNER,
    provider: "github",
    repo: HOST_RELEASE_REPO,
  };
}

interface GithubReleaseEntry {
  draft?: boolean;
  tag_name?: string;
}

/** release 列表按 created_at 倒序且混有插件 tag；截断发生在过滤之前，页宽必须取满。 */
const RELEASES_PAGE_SIZE = 100;
/** 网络黑洞不得挂死更新检查（single-flight 会堵住后续检查）；超时走降级 Latest。 */
const RELEASES_FETCH_TIMEOUT_MS = 10_000;

async function fetchReleaseTagsPage(
  fetchImpl: typeof fetch,
  page: number
): Promise<{ full: boolean; tags: string[] }> {
  const url = `https://api.github.com/repos/${HOST_RELEASE_OWNER}/${HOST_RELEASE_REPO}/releases?per_page=${RELEASES_PAGE_SIZE}&page=${page}`;
  const response = await fetchImpl(url, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "pier-app-update",
    },
    signal: AbortSignal.timeout(RELEASES_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`GitHub releases API ${response.status} for ${url}`);
  }
  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload)) {
    throw new Error("GitHub releases API returned a non-array payload");
  }
  const tags: string[] = [];
  for (const entry of payload as GithubReleaseEntry[]) {
    if (entry && entry.draft !== true && typeof entry.tag_name === "string") {
      tags.push(entry.tag_name);
    }
  }
  return { full: payload.length >= RELEASES_PAGE_SIZE, tags };
}

/**
 * 拉最近 release 的 tag 列表（排除 draft）。失败抛错，由调用方降级 Latest。
 * 首页全被插件 release 挤占时补拉第二页，保证密集插件发版不会把宿主 tag
 * 挤出可见窗口（列表按 created_at 倒序，越后的页只会更旧）。
 */
export async function fetchHostReleaseTags(options?: {
  fetchImpl?: typeof fetch;
}): Promise<string[]> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const firstPage = await fetchReleaseTagsPage(fetchImpl, 1);
  const hasHostTag = firstPage.tags.some((tag) =>
    HOST_RELEASE_TAG_RE.test(tag)
  );
  if (hasHostTag || !firstPage.full) {
    return firstPage.tags;
  }
  const secondPage = await fetchReleaseTagsPage(fetchImpl, 2);
  return [...firstPage.tags, ...secondPage.tags];
}

export async function resolveHostUpdateTarget(options: {
  currentVersion: string;
  fetchImpl?: typeof fetch;
}): Promise<HostUpdateTarget> {
  const tags = await fetchHostReleaseTags(
    options.fetchImpl ? { fetchImpl: options.fetchImpl } : undefined
  );
  return pickHostUpdateTarget(tags, options.currentVersion);
}
