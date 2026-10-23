/**
 * Active git review tree expand/collapse handlers (one per mounted panel).
 * Context-menu actions call through this (no toolbar, no default shortcuts).
 *
 * More than one review tree can be mounted in the same renderer (split panels
 * for different worktrees). Handlers therefore carry their panel / scope
 * identity so a right-click always drives the tree it came from, never the
 * most recently mounted one.
 */

/** Returns false when the tree API is not attached yet (callers retry). */
type TreeFolderAction = (rootPath?: string) => boolean;

type TreeFolderKind = "collapseAll" | "expandAll";

export interface GitReviewTreeFolderOwner {
  /** Review tree expansion scope (`contextId` of the review source). */
  contextId?: string | null;
  /** Dockview panel instance id hosting the tree. */
  panelId?: string | null;
}

interface TreeFolderRegistration extends GitReviewTreeFolderOwner {
  collapseAll: TreeFolderAction;
  expandAll: TreeFolderAction;
}

const registrations = new Map<number, TreeFolderRegistration>();
let nextSequence = 0;

function liveRegistrations(): TreeFolderRegistration[] {
  // `Map` iterates in insertion order, which is registration order.
  return [...registrations.values()];
}

function pickOwner(
  owner: GitReviewTreeFolderOwner | undefined
): TreeFolderRegistration | null {
  const entries = liveRegistrations();
  const last = entries.at(-1);
  if (last === undefined) {
    return null;
  }
  const panelId = owner?.panelId;
  if (panelId) {
    const match = entries.findLast((entry) => entry.panelId === panelId);
    if (match) {
      return match;
    }
  }
  const contextId = owner?.contextId;
  if (contextId) {
    const match = entries.findLast((entry) => entry.contextId === contextId);
    if (match) {
      return match;
    }
  }
  // A specified owner that is no longer mounted must not drive an unrelated
  // tree; only ownerless invocations fall back to the most recent tree.
  if (panelId || contextId) {
    return null;
  }
  return last;
}

/** Register the active panel's expand/collapse handlers (not command IDs). */
export function registerGitReviewTreeFolderHandlers(options: {
  collapseAll: TreeFolderAction;
  expandAll: TreeFolderAction;
  contextId?: string | null;
  panelId?: string | null;
}): () => void {
  const { collapseAll, expandAll, contextId, panelId } = options;
  nextSequence += 1;
  const sequence = nextSequence;
  registrations.set(sequence, {
    collapseAll,
    expandAll,
    ...(contextId ? { contextId } : {}),
    ...(panelId ? { panelId } : {}),
  });
  return () => {
    registrations.delete(sequence);
  };
}

export async function collapseGitReviewTreeFolders(
  rootPath?: string,
  owner?: GitReviewTreeFolderOwner
): Promise<boolean> {
  return applyFor("collapseAll", rootPath, owner);
}

export async function expandGitReviewTreeFolders(
  rootPath?: string,
  owner?: GitReviewTreeFolderOwner
): Promise<boolean> {
  return applyFor("expandAll", rootPath, owner);
}

/**
 * The tree API ref can be empty for a frame after a menu closes / panel
 * remounts; retry briefly before giving up so the action is not a silent no-op.
 * Cumulative 288ms.
 */
const TREE_FOLDER_RETRY_DELAYS_MS = [0, 16, 32, 80, 160];

/**
 * Invocations run one at a time so a retried action can never land after a
 * newer one and invert the user's last intent.
 */
let invocationChain: Promise<unknown> = Promise.resolve();

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const result = invocationChain.then(task, task);
  invocationChain = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

async function applyFor(
  kind: TreeFolderKind,
  rootPath: string | undefined,
  owner: GitReviewTreeFolderOwner | undefined
): Promise<boolean> {
  return serialize(async () => {
    for (const delayMs of TREE_FOLDER_RETRY_DELAYS_MS) {
      if (delayMs > 0) {
        await delay(delayMs);
      }
      // Re-resolve on every attempt: a panel remount replaces the handler, and
      // the old closure's tree ref stays detached forever.
      const registration = pickOwner(owner);
      if (!registration) {
        // Panel closed; waiting cannot reach a tree again.
        return false;
      }
      if (registration[kind](rootPath) !== false) {
        return true;
      }
    }
    return false;
  });
}
