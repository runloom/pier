/**
 * 文件 tab 短标题消歧（VS Code 系 + Pier multi-worktree）。
 *
 * 仅在冲突时加后缀；无冲突永不装饰。完整路径仍走 tooltip。
 *
 * 冲突范围：
 * - 同 group：同 basename 且身份不同（任意 root/path）→ 消歧
 * - 跨 group（同窗）：仅不同 root 的同 basename → 消歧（并排对比 worktree）
 * - 跨 group 同 root 不同 path：不消歧（靠分栏空间）
 */

export interface FileTabDisambiguationEntry {
  groupId: string;
  panelId: string;
  /** 磁盘相对 root 的路径（POSIX 或含 `\`，内部统一按段拆）。 */
  path: string;
  /** 工作区 / worktree 根绝对路径。 */
  root: string;
}

function pathSegments(path: string): string[] {
  return path.split(/[\\/]/).filter(Boolean);
}

export function fileTabBasename(path: string): string {
  const segments = pathSegments(path);
  return segments.at(-1) ?? path;
}

export function fileTabRootLabel(root: string): string {
  const segments = pathSegments(root);
  return segments.at(-1) ?? root;
}

function identityKey(entry: FileTabDisambiguationEntry): string {
  return `${entry.root}\0${entry.path}`;
}

/** 两 tab 是否应互相消歧（同窗规则）。 */
export function fileTabsShouldDisambiguate(
  left: FileTabDisambiguationEntry,
  right: FileTabDisambiguationEntry
): boolean {
  if (left.panelId === right.panelId) {
    return false;
  }
  if (fileTabBasename(left.path) !== fileTabBasename(right.path)) {
    return false;
  }
  if (identityKey(left) === identityKey(right)) {
    return false;
  }
  if (left.groupId === right.groupId) {
    return true;
  }
  return left.root !== right.root;
}

function parentSegments(path: string): string[] {
  const segments = pathSegments(path);
  return segments.slice(0, -1);
}

function labelUniqueInCluster(
  entry: FileTabDisambiguationEntry,
  cluster: readonly FileTabDisambiguationEntry[],
  labelFor: (item: FileTabDisambiguationEntry) => string
): boolean {
  const selfLabel = labelFor(entry);
  return !cluster.some(
    (other) =>
      other.panelId !== entry.panelId &&
      fileTabBasename(other.path) === fileTabBasename(entry.path) &&
      labelFor(other) === selfLabel
  );
}

/**
 * 最短可区分的相对路径父段（由近及远）。
 * 无父段时退回 root 叶子名。
 */
function pathDisambiguator(
  entry: FileTabDisambiguationEntry,
  cluster: readonly FileTabDisambiguationEntry[]
): string {
  const parents = parentSegments(entry.path);
  if (parents.length === 0) {
    return fileTabRootLabel(entry.root);
  }
  for (let take = 1; take <= parents.length; take += 1) {
    const labelFor = (item: FileTabDisambiguationEntry) =>
      parentSegments(item.path).slice(-take).join("/");
    if (labelUniqueInCluster(entry, cluster, labelFor)) {
      return parents.slice(-take).join("/");
    }
  }
  return parents.join("/");
}

/**
 * 多 root 时：先加深 root 段，再试 path 父段，再试 root+path，直到簇内唯一。
 * 覆盖「两个 …/pier 克隆 + 相同相对路径」——仅 root 叶子会撞。
 */
function multiRootDisambiguator(
  entry: FileTabDisambiguationEntry,
  cluster: readonly FileTabDisambiguationEntry[]
): string {
  const rootSegs = pathSegments(entry.root);
  const parents = parentSegments(entry.path);

  for (let take = 1; take <= rootSegs.length; take += 1) {
    const labelFor = (item: FileTabDisambiguationEntry) =>
      pathSegments(item.root).slice(-take).join("/");
    if (labelUniqueInCluster(entry, cluster, labelFor)) {
      return rootSegs.slice(-take).join("/");
    }
  }

  for (let take = 1; take <= parents.length; take += 1) {
    const labelFor = (item: FileTabDisambiguationEntry) =>
      parentSegments(item.path).slice(-take).join("/");
    if (labelUniqueInCluster(entry, cluster, labelFor)) {
      return parents.slice(-take).join("/");
    }
  }

  for (
    let rootTake = 1;
    rootTake <= Math.max(rootSegs.length, 1);
    rootTake += 1
  ) {
    for (
      let pathTake = 1;
      pathTake <= Math.max(parents.length, 1);
      pathTake += 1
    ) {
      const labelFor = (item: FileTabDisambiguationEntry) => {
        const rootPart = pathSegments(item.root).slice(-rootTake).join("/");
        const pathPart = parentSegments(item.path).slice(-pathTake).join("/");
        return pathPart.length > 0 ? `${rootPart}/${pathPart}` : rootPart;
      };
      if (labelUniqueInCluster(entry, cluster, labelFor)) {
        return labelFor(entry);
      }
    }
  }

  // 最后兜底：规范化后的完整 root（含前缀差异，分隔符已在 register 归一）+ 父 path。
  // 用 entry.root 原文段拼接，避免仅 join(segments) 丢前导差异后仍撞。
  const rootJoined = entry.root.length > 0 ? entry.root : rootSegs.join("/");
  return parents.length > 0 ? `${rootJoined}/${parents.join("/")}` : rootJoined;
}

function disambiguatorFor(
  entry: FileTabDisambiguationEntry,
  cluster: readonly FileTabDisambiguationEntry[]
): string {
  const roots = new Set(cluster.map((item) => item.root));
  if (roots.size > 1) {
    return multiRootDisambiguator(entry, cluster);
  }
  return pathDisambiguator(entry, cluster);
}

/**
 * 返回 panelId → 展示短标题。
 * 无冲突时为 basename；冲突时为 `basename · disambiguator`。
 */
export function disambiguateFileTabTitles(
  entries: readonly FileTabDisambiguationEntry[]
): Map<string, string> {
  const result = new Map<string, string>();
  for (const entry of entries) {
    const basename = fileTabBasename(entry.path);
    const peers = entries.filter((other) =>
      fileTabsShouldDisambiguate(entry, other)
    );
    if (peers.length === 0) {
      result.set(entry.panelId, basename);
      continue;
    }
    const cluster = [entry, ...peers];
    const extra = disambiguatorFor(entry, cluster);
    result.set(entry.panelId, `${basename} · ${extra}`);
  }
  return result;
}
