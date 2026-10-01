import type {
  PierDiffViewHandle,
  PierDiffViewItem,
} from "@pier/ui/diff-view/index.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { GIT_PLUGIN_MANIFEST } from "@plugins/builtin/git/manifest.ts";
import {
  GIT_REVIEW_DIFF_SURFACE,
  GIT_REVIEW_OPEN_IN_EDITOR_COMMAND_ID,
  registerGitReviewDiffActions,
} from "@plugins/builtin/git/renderer/review/diff-actions.ts";
import { GIT_REVIEW_RESOLVE_CONFLICT_COMMAND_IDS } from "@plugins/builtin/git/renderer/review/diff-conflict-actions.ts";
import { openGitReviewDiffContextMenu } from "@plugins/builtin/git/renderer/review/diff-context-menu.ts";
import { useReviewUnresolvedConflictHost } from "@plugins/builtin/git/renderer/review/document/conflict-host.tsx";
import { GitReviewMutationAuthority } from "@plugins/builtin/git/renderer/review/mutation-authority.ts";
import { act, renderHook } from "@testing-library/react";
import type { MouseEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { buildMenuEntries } from "@/lib/context-menu/build-entries.ts";
import { createRendererPluginContext } from "@/lib/plugins/host/context.ts";

const source = {
  contextId: "ctx",
  gitRootPath: "/repo",
  path: "second.txt",
  oldPaths: [],
  target: { kind: "uncommitted" as const },
};
const conflict = {
  source,
  xy: "DU",
  presentation: "file-level",
  contentsDigest: `sha256:${"a".repeat(64)}`,
  readable: false,
};
const invocation = (value = conflict) => ({
  surface: GIT_REVIEW_DIFF_SURFACE,
  metadata: { ...source, openable: false, conflict: value },
});

describe("review conflict menu commands", () => {
  let authority: GitReviewMutationAuthority;
  let dispose: () => void;
  const resolve = vi.fn();
  const refresh = vi.fn(async () => undefined);
  const confirm = vi.fn(async () => true);
  const alert = vi.fn(async () => undefined);
  const context = {
    actions: createRendererPluginContext({
      effectivePermissions: [...GIT_PLUGIN_MANIFEST.permissions],
      enabled: true,
      manifest: GIT_PLUGIN_MANIFEST,
      runtime: { canToggle: true, enabled: true, kind: "builtin" },
    }).actions,
    dialogs: { confirm, alert },
    git: { resolveReviewConflict: resolve },
    i18n: { t: (_key: string, _values: unknown, fallback: string) => fallback },
  } as unknown as RendererPluginContext;

  beforeEach(() => {
    actionRegistry.clearForTests();
    vi.clearAllMocks();
    resolve.mockResolvedValue({ kind: "ok", operationId: "done" });
    confirm.mockResolvedValue(true);
    authority = new GitReviewMutationAuthority();
    authority.registerRefresher(source, refresh);
    dispose = registerGitReviewDiffActions(context, authority);
  });
  afterEach(() => {
    dispose();
    authority.dispose();
    actionRegistry.clearForTests();
  });

  it("offers only the valid modify/delete choices without opening a missing worktree file", () => {
    const ids = buildMenuEntries(GIT_REVIEW_DIFF_SURFACE, invocation()).flatMap(
      (entry) => (entry.type === "action" ? [entry.id] : [])
    );
    expect(ids).toEqual([
      GIT_REVIEW_RESOLVE_CONFLICT_COMMAND_IDS["confirm-delete"],
      GIT_REVIEW_RESOLVE_CONFLICT_COMMAND_IDS["take-incoming"],
    ]);
    expect(ids).not.toContain(GIT_REVIEW_OPEN_IN_EDITOR_COMMAND_ID);
  });

  it.each([
    { metadata: { ...source }, surface: GIT_REVIEW_DIFF_SURFACE },
    invocation({ ...conflict, contentsDigest: "estimate:second" }),
    invocation({ ...conflict, presentation: "markers-text" }),
    invocation({ ...conflict, source: { ...source, gitRootPath: "" } }),
  ])("does not offer file resolution without a hydrated file-level conflict and valid scope", (input) => {
    const menu = buildMenuEntries(GIT_REVIEW_DIFF_SURFACE, input);
    expect(
      menu.some(
        (entry) =>
          entry.type === "action" &&
          Object.values(GIT_REVIEW_RESOLVE_CONFLICT_COMMAND_IDS).includes(
            entry.id as never
          )
      )
    ).toBe(false);
  });

  it("keeps binary version choices but stages only readable marker-free current text", () => {
    const stage = actionRegistry.get(
      GIT_REVIEW_RESOLVE_CONFLICT_COMMAND_IDS["stage-current"]
    );
    expect(
      stage?.enabled?.(
        invocation({ ...conflict, xy: "UU", presentation: "binary" })
      )
    ).toBe(false);
    expect(
      stage?.enabled?.(invocation({ ...conflict, xy: "UU", readable: true }))
    ).toBe(true);
  });

  it("resolves exactly the supplied clicked path and refreshes under the authority lock", async () => {
    resolve.mockImplementation(async () => {
      expect(authority.blocked(source)).toBe(true);
      return { kind: "ok", operationId: "done" };
    });
    await actionRegistry
      .get(GIT_REVIEW_RESOLVE_CONFLICT_COMMAND_IDS["take-incoming"])
      ?.handler(invocation());
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "theirs",
        source,
        expectedContentsDigest: conflict.contentsDigest,
      })
    );
    expect(refresh).toHaveBeenCalledOnce();
    expect(authority.blocked(source)).toBe(false);
  });

  it("ignores commands while another repository mutation owns authority", async () => {
    authority.acquire(source);
    const command = actionRegistry.get(
      GIT_REVIEW_RESOLVE_CONFLICT_COMMAND_IDS["take-incoming"]
    );
    expect(command?.enabled?.(invocation())).toBe(false);
    await command?.handler(invocation());
    expect(resolve).not.toHaveBeenCalled();
  });

  it("cancels destructive commands and rechecks the lock after confirmation", async () => {
    const command = actionRegistry.get(
      GIT_REVIEW_RESOLVE_CONFLICT_COMMAND_IDS["confirm-delete"]
    );
    confirm.mockResolvedValueOnce(false);
    await command?.handler(invocation());
    expect(resolve).not.toHaveBeenCalled();
    confirm.mockImplementationOnce(async () => {
      authority.acquire(source);
      return true;
    });
    await command?.handler(invocation());
    expect(resolve).not.toHaveBeenCalled();
  });

  it.each([
    "success",
    "failure",
  ] as const)("blocks file-level menus during Accept and authoritative refresh after %s", async (outcome) => {
    const writeGate = Promise.withResolvers<{
      kind: "ok";
      operationId: string;
    }>();
    const refreshGate = Promise.withResolvers<void>();
    resolve.mockReturnValue(writeGate.promise);
    authority.registerRefresher(source, () => refreshGate.promise);
    const hook = renderHook(() =>
      useReviewUnresolvedConflictHost({
        context,
        contextId: source.contextId,
        gitRootPath: source.gitRootPath,
        items: [
          {
            id: "marker",
            cacheKey: "marker",
            kind: "conflict",
            patch: null,
            fileDisplay: { path: "marker.txt", status: "conflicted" },
            conflict: {
              ...conflict,
              xy: "UU",
              presentation: "markers-text",
              contents:
                "<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> incoming\n",
              stages: { baseOid: null, oursOid: null, theirsOid: null },
            },
          },
        ],
        mutationLocked: false,
        onMutationStart: () =>
          authority.acquire(source) ? { minimumIndexGeneration: 1 } : null,
        onMutationCommitted: () => authority.refreshAndRelease(source),
      })
    );
    const write = hook.result.current?.onWriteResolved;
    if (write === undefined) {
      throw new Error("Conflict writer is unavailable");
    }
    const command = actionRegistry.get(
      GIT_REVIEW_RESOLVE_CONFLICT_COMMAND_IDS["take-incoming"]
    );
    expect(command?.enabled?.(invocation())).toBe(true);
    let completion: Promise<void> | undefined;
    act(() => {
      completion = Promise.resolve(
        write("marker", {
          contents: "resolved\n",
          contentsDigest: conflict.contentsDigest,
        })
      ).catch(() => undefined);
    });
    expect(command?.enabled?.(invocation())).toBe(false);
    await act(async () => {
      if (outcome === "success") {
        writeGate.resolve({ kind: "ok", operationId: "accepted" });
      } else {
        writeGate.reject(new Error("write failed"));
      }
      await Promise.resolve();
    });
    expect(command?.enabled?.(invocation())).toBe(false);
    await act(async () => {
      refreshGate.resolve();
      await completion;
    });
    expect(command?.enabled?.(invocation())).toBe(true);
    hook.unmount();
  });
});

describe("review conflict pointer target", () => {
  it("uses the right-clicked header, not a previous selection, and excludes ordinary paths", () => {
    const popup = vi.fn(
      async (
        ..._args: Parameters<RendererPluginContext["contextMenu"]["popup"]>
      ) => undefined
    );
    const context = {
      contextMenu: { popup },
    } as unknown as RendererPluginContext;
    const host = document.createElement("div");
    host.setAttribute("data-pier-file-host", "second");
    const event = {
      clientX: 1,
      clientY: 2,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      nativeEvent: {
        clientX: 1,
        clientY: 2,
        target: host,
        composedPath: () => [host],
      },
    } as unknown as MouseEvent;
    const handle = {
      resolvePointerLineHit: () => null,
      getSelectedLines: () => ({
        id: "first",
        range: { side: "additions", start: 1, end: 1 },
      }),
      getSelectedText: () => "",
    } as unknown as PierDiffViewHandle;
    const items: PierDiffViewItem[] = [
      {
        id: "first",
        cacheKey: "first",
        kind: "loaded",
        patch: "",
        fileDisplay: { path: "first.txt", status: "modified" },
      },
      {
        id: "second",
        cacheKey: "second",
        kind: "conflict",
        patch: null,
        fileDisplay: { path: source.path, status: "conflicted" },
        conflict: {
          xy: "DU",
          presentation: "file-level",
          contents: null,
          contentsDigest: conflict.contentsDigest,
          stages: { baseOid: null, oursOid: null, theirsOid: "theirs" },
        },
      },
    ];
    const entries = [
      {
        entryKey: "second",
        path: source.path,
        oldPaths: [],
        status: "conflicted" as const,
        renderSlots: [
          {
            group: "conflict" as const,
            sectionKey: "second",
            targetPath: source.path,
            oldPath: null,
            status: "conflicted" as const,
            xy: "DU" as const,
          },
        ],
      },
    ];
    openGitReviewDiffContextMenu({
      context,
      contextId: source.contextId,
      gitRootPath: source.gitRootPath,
      handle,
      items,
      entries,
      event,
    });
    expect(popup.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({
          path: source.path,
          openable: false,
          conflict: expect.objectContaining({
            source: expect.objectContaining({ path: source.path }),
          }),
        }),
      })
    );
    host.setAttribute("data-pier-file-host", "first");
    openGitReviewDiffContextMenu({
      context,
      contextId: source.contextId,
      gitRootPath: source.gitRootPath,
      handle,
      items,
      entries,
      event,
    });
    expect(popup.mock.calls[1]?.[2]).toEqual(
      expect.objectContaining({
        metadata: expect.not.objectContaining({ conflict: expect.anything() }),
      })
    );
    host.setAttribute("data-pier-file-host", "second");
    openGitReviewDiffContextMenu({
      context,
      contextId: source.contextId,
      gitRootPath: source.gitRootPath,
      handle,
      items,
      event,
    });
    expect(popup.mock.calls[2]?.[2]).toEqual(
      expect.objectContaining({
        metadata: expect.not.objectContaining({ conflict: expect.anything() }),
      })
    );
  });
});
