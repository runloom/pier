/**
 * Cross-window panel transfer adapter for the Git changes panel
 * (`pier.git.changes`).
 *
 * The Git panel's durable state is split:
 * - **Params** carry the `GitReviewScope` (`{ contextId, gitRootPath }`). This
 *   is the identity of the review and is already JSON-serializable dockview
 *   params. Moving it across windows is just `params` propagation.
 * - **Session cache** (`git-review-session-cache`) holds the heavy index /
 *   loaded documents / anchor / selectedEntryKey, keyed by
 *   `JSON.stringify(scope)`. The cache lives on `globalThis`, so it is
 *   per-renderer-process. We do NOT move the index/diff cache across windows
 *   — the target reloads its own index from the git facade. We only export
 *   `anchor` + `selectedEntryKey` so the target can re-seed navigation without
 *   losing the user's place.
 *
 * Lifecycle:
 * - `prepareSource`: read `source` from params + `anchor`/`selectedEntryKey`
 *   from the session cache. Returns them as `state` in the prepared source.
 *   Does NOT export the index or loaded documents.
 * - `stageTarget`: hydrate target params from `source` + seed
 *   `anchor`/`selectedEntryKey` into the target's session cache so the panel
 *   opens at the same entry. No duplicate watcher — the cache write is
 *   idempotent and the panel's own effect is the only watcher.
 * - `restore`: idempotent no-op. The session cache is already populated by
 *   `stageTarget` (target role) or untouched (source role, the source panel
 *   keeps running). Repeated calls must not duplicate watchers or drafts.
 * - `releaseSource`: no-op. The panel's own `onDidRemovePanel` clears its
 *   session once relocation suppression lifts in `finalize`; doing it here
 *   would race that cleanup and could wipe a session still referenced by a
 *   same-scope sibling.
 * - `finalize`: idempotent no-op. The session cache is self-evicting; nothing
 *   to flush.
 */

import type { PierDiffViewAnchor } from "@pier/ui/diff-view.tsx";
import type { PanelTransferRegistration } from "@plugins/api/panel-transfer-registration.ts";
import {
  type GitReviewScope,
  gitReviewScopeSchema,
} from "@shared/contracts/git-review.ts";
import type {
  JsonValue,
  PanelTransferPreparedSource,
} from "@shared/contracts/panel-transfer.ts";
import {
  patchReviewSession,
  type ReviewSessionSourceKey,
  readReviewSession,
} from "./git-review-session-cache.ts";

const GIT_REVIEW_SCOPE_KEY = "source";
const GIT_REVIEW_ANCHOR_KEY = "anchor";
const GIT_REVIEW_SELECTED_ENTRY_KEY = "selectedEntryKey";

interface GitPreparedState {
  readonly anchor: PierDiffViewAnchor | null;
  readonly scope: GitReviewScope;
  readonly selectedEntryKey: string | null;
}

function readScopeFromParams(
  params: Readonly<Record<string, unknown>>
): GitReviewScope | null {
  const parsed = gitReviewScopeSchema.safeParse(params[GIT_REVIEW_SCOPE_KEY]);
  return parsed.success ? parsed.data : null;
}

function scopeToParams(
  scope: GitReviewScope
): Readonly<Record<string, JsonValue>> {
  return { [GIT_REVIEW_SCOPE_KEY]: scope as unknown as JsonValue };
}

function readPreparedState(
  prepared: PanelTransferPreparedSource
): GitPreparedState | null {
  const state = prepared.state;
  if (!state || typeof state !== "object") {
    return null;
  }
  const record = state as Record<string, unknown>;
  const scope = gitReviewScopeSchema.safeParse(record[GIT_REVIEW_SCOPE_KEY]);
  if (!scope.success) {
    return null;
  }
  const anchor = (record[GIT_REVIEW_ANCHOR_KEY] ??
    null) as PierDiffViewAnchor | null;
  const selectedEntryKey =
    typeof record[GIT_REVIEW_SELECTED_ENTRY_KEY] === "string"
      ? (record[GIT_REVIEW_SELECTED_ENTRY_KEY] as string)
      : null;
  return { anchor, scope: scope.data, selectedEntryKey };
}

function sourceKeyOf(scope: GitReviewScope): ReviewSessionSourceKey {
  return JSON.stringify(scope);
}

/**
 * Build the `kind: "custom"` transfer registration for the Git changes panel.
 * Registered from `index.ts` via `context.panels.register({ transfer })`.
 */
export function createGitPanelTransferRegistration(): PanelTransferRegistration {
  return {
    kind: "custom",

    async prepareSource({ params }) {
      const scope = readScopeFromParams(params);
      if (!scope) {
        return { drafts: [], state: null };
      }
      const session = readReviewSession(sourceKeyOf(scope));
      return {
        drafts: [],
        state: {
          [GIT_REVIEW_SCOPE_KEY]: scope as unknown as JsonValue,
          [GIT_REVIEW_ANCHOR_KEY]: (session?.anchor ??
            null) as unknown as JsonValue,
          [GIT_REVIEW_SELECTED_ENTRY_KEY]: session?.selectedEntryKey ?? null,
        } as unknown as JsonValue,
      };
    },

    async stageTarget({ prepared }) {
      const parsed = readPreparedState(prepared);
      if (!parsed) {
        return;
      }
      const sourceKey = sourceKeyOf(parsed.scope);
      // Seed the target's session cache with anchor + selectedEntryKey so the
      // panel opens at the user's place. Index/documents reload from the git
      // facade; this is not a duplicate watcher (the panel's own effect is).
      const existing = readReviewSession(sourceKey);
      if (existing) {
        patchReviewSession(sourceKey, {
          anchor: parsed.anchor ?? existing.anchor,
          selectedEntryKey:
            parsed.selectedEntryKey ?? existing.selectedEntryKey,
        });
      }
      return { params: scopeToParams(parsed.scope) };
    },

    async restore({ snapshot }) {
      // Idempotent: the session cache is populated by stageTarget (target) or
      // untouched (source). The panel's own effect is the single watcher;
      // calling restore twice must not duplicate it. We only validate that the
      // scope in the snapshot is parseable — if it isn't, there's nothing to
      // restore and we silently no-op (main rejects invalid offers upstream).
      const scope = gitReviewScopeSchema.safeParse(
        snapshot.panel.params?.[GIT_REVIEW_SCOPE_KEY]
      );
      if (!scope.success) {
        return;
      }
      // No work: target cache seeded by stageTarget, source cache untouched.
    },

    async releaseSource() {
      // The panel's own onDidRemovePanel clears its session when the panel is
      // removed. During transfer, relocation suppression blocks that cleanup
      // so the session survives the cross-window move. Suppression lifts in
      // finalize, after which removePanel's onDidRemovePanel fires and clears
      // the session — but ONLY if no remaining sibling panel shares the same
      // review scope (the panel's own check). Doing it here would race that
      // cleanup and could wipe a session still referenced by a same-scope
      // sibling. So this is a no-op.
    },

    async finalize() {
      // Idempotent no-op. Session cache is self-evicting (LRU cap 16); nothing
      // to flush or persist here.
    },
  };
}
