import type {
  PierFileTreeGitStatus,
  PierFileTreeItem,
} from "@pier/ui/file-tree.tsx";
import type {
  GitReviewFileStatus,
  GitReviewIndexEntry,
} from "@shared/contracts/git-review.ts";

function treeStatus(status: GitReviewFileStatus): PierFileTreeGitStatus {
  return status === "conflicted" ? "modified" : status;
}

function inheritedStatus(status: PierFileTreeGitStatus): PierFileTreeGitStatus {
  return status === "added" || status === "untracked" ? status : "modified";
}

export function gitReviewTreeModel(
  entries: readonly GitReviewIndexEntry[],
  collidingFileLabel: (name: string) => string
): {
  entryByPath: ReadonlyMap<string, GitReviewIndexEntry>;
  items: PierFileTreeItem[];
} {
  const items = new Map<string, PierFileTreeItem>();
  const entryByPath = new Map<string, GitReviewIndexEntry>();
  const directoryPaths = new Set<string>();
  const reservedPaths = new Set(entries.map((entry) => entry.path));
  for (const entry of entries) {
    for (const directory of ancestorDirectories(entry.path)) {
      directoryPaths.add(directory);
      reservedPaths.add(directory);
    }
  }
  for (const entry of entries) {
    const status = treeStatus(entry.status);
    const displayPath = directoryPaths.has(entry.path)
      ? collidingFileDisplayPath(entry.path, collidingFileLabel, reservedPaths)
      : entry.path;
    entryByPath.set(displayPath, entry);
    const segments = displayPath.split("/");
    segments.pop();
    let directory = "";
    for (const segment of segments) {
      directory = directory ? `${directory}/${segment}` : segment;
      const existing = items.get(directory);
      const nextStatus = inheritedStatus(status);
      items.set(directory, {
        gitStatus:
          existing?.gitStatus === undefined || existing.gitStatus === nextStatus
            ? nextStatus
            : "modified",
        hasChildren: true,
        kind: "directory",
        loadState: "loaded",
        path: directory,
      });
    }
    items.set(displayPath, {
      gitStatus: status,
      kind: "file",
      path: displayPath,
    });
  }
  return { entryByPath, items: [...items.values()] };
}

function ancestorDirectories(path: string): string[] {
  const directories: string[] = [];
  let cursor = 0;
  while (true) {
    const slash = path.indexOf("/", cursor);
    if (slash < 0) {
      return directories;
    }
    directories.push(path.slice(0, slash));
    cursor = slash + 1;
  }
}

function collidingFileDisplayPath(
  path: string,
  collidingFileLabel: (name: string) => string,
  reservedPaths: Set<string>
): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const label = collidingFileLabel(name).replaceAll("/", "∕");
  let candidate = `${path}/${label}`;
  let suffix = 2;
  while (reservedPaths.has(candidate)) {
    candidate = `${path}/${label} ${suffix}`;
    suffix += 1;
  }
  reservedPaths.add(candidate);
  return candidate;
}
