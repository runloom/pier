import type {
  PierDiffViewHandle,
  PierDiffViewRenderWindow,
} from "@pier/ui/diff-view/index.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type {
  GitReviewIndexEntry,
  GitReviewScope,
} from "@shared/contracts/git/review.ts";
import type { Dispatch, RefObject, SetStateAction } from "react";
import {
  isReviewEntryBodyHydratable,
  reviewContentEntryKeysInOrder,
} from "../review/document/body-class.ts";
import {
  composeReviewDocumentDemand,
  gitReviewSeedEntryKeys,
  type ReviewDocumentDemand,
  reviewDocumentDemandForRenderWindow,
  selectBodyHydrationPriorityEntryKeys,
} from "../review/document/demand.ts";
import { GitReviewDocumentGeneration } from "../review/document/generation.ts";
import { createHydrateTimeoutWatchdog } from "../review/document/hydrate-timeout.ts";
import { GitReviewDocumentLoader } from "../review/document/loader.ts";
import {
  EMPTY_DOCUMENT_VIEW_STATE,
  indexReviewEntrySections,
  indexReviewSectionEntries,
  projectReviewLedger,
  type ReviewDocumentProjection,
  type ReviewDocumentViewState,
} from "../review/document/projection.ts";
import type { GitReviewDocumentResource } from "../review/document/resource.ts";
import {
  createReviewDocumentSyncHandler,
  type ReviewDocumentSyncContext,
} from "../review/document/session-sync.ts";
import {
  publishReviewDocumentSoftCache,
  readReviewDocumentSoftCache,
  reviewDocumentSoftCacheScopeKey,
} from "../review/document/soft-cache.ts";
import {
  EMPTY_LOADER_SNAPSHOT,
  EMPTY_REVIEW_PROJECTION,
} from "../review/document/ui-state.ts";
import { nextDemandPrefetchEntryKeys } from "../review/materialization.ts";
import type { GitReviewReadingSurface } from "../review/reading-surface.ts";
import {
  ensureReviewSurfaceSession,
  patchReviewSession,
  readReviewSession,
} from "../review/session-cache.ts";
import type { GitReviewGenerationCallbacks } from "./use-document-session.ts";

export interface GitReviewDocumentGenerationMountOptions {
  readonly committedProjectionGenerationRef: RefObject<number>;
  readonly context: RendererPluginContext;
  readonly currentDemandRef: RefObject<ReviewDocumentDemand>;
  readonly demandPrefetchEntryKeysRef: {
    current: ReadonlySet<string>;
  };
  readonly diffBase: GitReviewReadingSurface;
  readonly diffHandleRef: RefObject<PierDiffViewHandle | null>;
  readonly documentControllerRef: RefObject<GitReviewDocumentGeneration | null>;
  readonly documentGenerationRef: RefObject<number>;
  readonly entries: readonly GitReviewIndexEntry[];
  readonly entryKeyBySectionIdRef: RefObject<ReadonlyMap<string, string>>;
  readonly firstSectionIdByEntryKeyRef: RefObject<ReadonlyMap<string, string>>;
  readonly generationCallbacksRef: RefObject<GitReviewGenerationCallbacks>;
  readonly indexGeneration: number;
  readonly itemCacheKeysRef: RefObject<Map<string, string>>;
  readonly itemIdsRef: RefObject<readonly string[]>;
  readonly loaderRef: RefObject<GitReviewDocumentLoader | null>;
  readonly previousSnapshotRef: {
    current: typeof EMPTY_LOADER_SNAPSHOT;
  };
  readonly projectedLocaleRef: RefObject<string>;
  readonly projectionLocaleRef: RefObject<string>;
  readonly renderWindowRef: RefObject<PierDiffViewRenderWindow | null>;
  readonly scope: GitReviewScope;
  readonly scopeKeyRef: RefObject<string | null>;
  readonly seedEntryKeysRef: RefObject<readonly string[]>;
  readonly setProjection: Dispatch<SetStateAction<ReviewDocumentProjection>>;
  readonly setProjectionGeneration: Dispatch<SetStateAction<number>>;
  readonly setViewState: Dispatch<SetStateAction<ReviewDocumentViewState>>;
  readonly viewStateRef: RefObject<ReviewDocumentViewState>;
}

/**
 * 代际挂载：创建 loader/controller、订阅 sync、返回 dispose。
 * 由 useGitReviewDocumentSession 在 useEffect 中调用。
 */
export function mountGitReviewDocumentGeneration(
  options: GitReviewDocumentGenerationMountOptions
): () => void {
  const {
    committedProjectionGenerationRef,
    context,
    currentDemandRef,
    diffHandleRef,
    diffBase,
    documentControllerRef,
    documentGenerationRef,
    entries,
    entryKeyBySectionIdRef,
    firstSectionIdByEntryKeyRef,
    generationCallbacksRef,
    indexGeneration,
    itemCacheKeysRef,
    itemIdsRef,
    loaderRef,
    previousSnapshotRef,
    projectedLocaleRef,
    projectionLocaleRef,
    renderWindowRef,
    scope,
    scopeKeyRef,
    seedEntryKeysRef,
    setProjection,
    setProjectionGeneration,
    setViewState,
    demandPrefetchEntryKeysRef,
    viewStateRef,
  } = options;

  generationCallbacksRef.current.beginReadingRefresh();
  const generation = Math.max(
    documentGenerationRef.current + 1,
    indexGeneration + 1
  );
  documentGenerationRef.current = generation;
  const sourceKey = ensureReviewSurfaceSession(scope, diffBase);
  // target 变化必须整代重建：entryKey 只含路径，跨 target 的正文不可复用。
  const scopeKey = JSON.stringify([
    scope.contextId,
    scope.gitRootPath,
    scope.target,
    diffBase,
  ]);
  const retainPrevious = scopeKeyRef.current === scopeKey;
  scopeKeyRef.current = scopeKey;
  const session = readReviewSession(sourceKey);
  const entryKeysInOrder = entries.map((entry) => entry.entryKey);
  const currentEntryKeys = new Set(entryKeysInOrder);
  // 金标准：seed 仅 content-bearing（pure rename 不占 document 队列）
  const contentEntryKeysInOrder = reviewContentEntryKeysInOrder(
    entries,
    diffBase
  );
  const seedEntryKeys = gitReviewSeedEntryKeys(contentEntryKeysInOrder);
  seedEntryKeysRef.current = seedEntryKeys;
  demandPrefetchEntryKeysRef.current = new Set();
  currentDemandRef.current = {
    bufferedEntryKeys: [],
    visibleEntryKeys: [],
  };
  // 视口所有权在 packages/ui 的 anchored apply；renderer 不采集或回放 scroll。
  // beginGeneration 依赖 section 映射；须先于其调用用新 index 预热，
  // 避免 layout commit 前用旧/空 map 误清选择或武装 orphan sectionKey。
  entryKeyBySectionIdRef.current = indexReviewSectionEntries(entries, diffBase);
  firstSectionIdByEntryKeyRef.current = indexReviewEntrySections(
    entries,
    diffBase
  );
  const selectedEntryKey = generationCallbacksRef.current.beginGeneration(
    retainPrevious || session?.selectedEntryKey ? currentEntryKeys : new Set(),
    generation,
    {
      restoreSelection:
        !retainPrevious &&
        session?.selectedEntryKey !== null &&
        session?.selectedEntryKey !== undefined &&
        session?.anchor == null,
    }
  );
  const previousSnapshot = previousSnapshotRef.current;
  previousSnapshotRef.current = EMPTY_LOADER_SNAPSHOT;
  const softCacheScopeKey = reviewDocumentSoftCacheScopeKey(scope);
  const previousResources = new Map(
    (retainPrevious ? previousSnapshot.resources : [])
      .filter(
        (
          resource
        ): resource is Extract<GitReviewDocumentResource, { kind: "loaded" }> =>
          resource.kind === "loaded"
      )
      .map((resource) => [resource.entry.entryKey, resource])
  );
  let previousByEntryKey = new Map(
    (retainPrevious ? previousSnapshot.retainedEntryKeys : []).flatMap(
      (entryKey) => {
        const resource = previousResources.get(entryKey);
        return resource && currentEntryKeys.has(entryKey)
          ? ([[entryKey, resource]] as const)
          : [];
      }
    )
  );
  if (!retainPrevious) {
    // 面隔离 session 可能尚无 loaded（首次挂 staged）；合并 session + 跨面 soft cache。
    previousByEntryKey = new Map();
    for (const [entryKey, resource] of session?.loadedByEntryKey ?? []) {
      if (currentEntryKeys.has(entryKey)) {
        previousByEntryKey.set(entryKey, resource);
      }
    }
    for (const [entryKey, resource] of readReviewDocumentSoftCache(
      softCacheScopeKey
    )) {
      if (currentEntryKeys.has(entryKey) && !previousByEntryKey.has(entryKey)) {
        previousByEntryKey.set(entryKey, resource);
      }
    }
  }
  if (!retainPrevious) {
    viewStateRef.current = EMPTY_DOCUMENT_VIEW_STATE;
    setViewState(EMPTY_DOCUMENT_VIEW_STATE);
    setProjection(EMPTY_REVIEW_PROJECTION);
    setProjectionGeneration(0);
    // 切 target / 重建代：丢弃旧 Pierre window，强制走 seed demand。
    // 否则旧 visibleItemIds 若碰巧仍能 map 到新 entryKey，会 windowActive 挤掉 seed，
    // 首批正文永远不进 waiting → 整页永久 estimate 骨架。
    renderWindowRef.current = null;
  }
  generationCallbacksRef.current.clearLatestItemUpdates();
  const loader = new GitReviewDocumentLoader({
    cancel: (operationId) => context.git.cancelReviewRequest({ operationId }),
    entries,
    load: (entry, operationId) =>
      context.git.getReviewFileDocument({
        operationId,
        ...(previousByEntryKey.get(entry.entryKey)?.document.revision ===
        undefined
          ? {}
          : {
              previousRevision: previousByEntryKey.get(entry.entryKey)?.document
                .revision,
            }),
        source: {
          ...scope,
          oldPaths: entry.oldPaths,
          path: entry.path,
        },
      }),
  });
  // previousByEntryKey 灌 soft-retain 正文进 loader，首帧即可投影真正文；
  // 权威文档仍由 demand 重新拉取（revision 不匹配则覆盖）。
  // 含 uncommitted：stage 切面 / 冷开已暂存面时否则会长期 estimate。
  if (!retainPrevious && previousByEntryKey.size > 0) {
    loader.hydrateLoaded(previousByEntryKey);
  }
  loaderRef.current = loader;
  const controller = new GitReviewDocumentGeneration({
    current: loader.getSnapshot(),
    generation,
    previousByEntryKey,
    protectedEntryKey: selectedEntryKey,
  });
  documentControllerRef.current = controller;
  loader.setRetentionLimits(controller.retentionLimits());
  const initialViewState = controller.initialViewState();
  // 真资源只在 controller；UI viewState 仅 meta。
  const initialSnapshot = controller.snapshot(loader.getRetainedEntryKeys());
  const initialResourceByEntryKey = new Map(
    initialSnapshot.resources.map((resource) => [
      resource.entry.entryKey,
      resource,
    ])
  );
  // 首帧即发布 soft cache，供其它阅读面冷启动（stage 切面）取用。
  publishReviewDocumentSoftCache(softCacheScopeKey, initialResourceByEntryKey);
  const initialDemand: ReviewDocumentDemand = {
    bufferedEntryKeys: [],
    visibleEntryKeys: seedEntryKeys,
  };
  const initialBodyCandidates = contentEntryKeysInOrder.filter(
    (entryKey) => initialResourceByEntryKey.get(entryKey)?.kind === "loaded"
  );
  const initialAllowedBodyEntryKeys = new Set(
    selectBodyHydrationPriorityEntryKeys({
      candidateEntryKeys: initialBodyCandidates,
      demand: initialDemand,
      entryKeysInOrder: contentEntryKeysInOrder,
      previousMemberEntryKeys: [],
      selectedEntryKey,
    })
  );
  // 金标准：首帧即挂全 content 槽 estimate（稳定高度账本）；seed 只驱动 document 水合队列
  const initialProjection = projectReviewLedger({
    allowedBodyEntryKeys: initialAllowedBodyEntryKeys,
    authoritativeEntryKeys: controller.authoritativeEntryKeys(),
    context,
    diffBase,
    entries,
    locale: projectionLocaleRef.current,
    resourceByEntryKey: initialResourceByEntryKey,
    sourceIndexGeneration: indexGeneration,
  });
  // retention sticky 仅保护已 materialize 的 entry（不再裁投影 id）
  const previousStickyBodyEntryKeys = [...initialAllowedBodyEntryKeys];
  demandPrefetchEntryKeysRef.current = new Set(
    nextDemandPrefetchEntryKeys({
      demand: {
        bufferedEntryKeys: [],
        visibleEntryKeys: seedEntryKeys,
      },
      entryKeysInOrder: contentEntryKeysInOrder,
      previous: new Set(),
      retainedEntryKeys: new Set(initialViewState.retainedEntryKeys),
      resourceByEntryKey: initialResourceByEntryKey,
      selectedEntryKey,
    })
  );
  projectedLocaleRef.current = projectionLocaleRef.current;
  const uiViewState: ReviewDocumentViewState = {
    generation: initialViewState.generation,
    retainedEntryKeys: initialViewState.retainedEntryKeys,
    settled: initialViewState.settled,
    staleRetainedCount: initialViewState.staleRetainedCount,
  };
  viewStateRef.current = uiViewState;
  setViewState(uiViewState);
  setProjection(initialProjection);
  setProjectionGeneration(generation);
  generationCallbacksRef.current.resetGenerationFailures(
    generation,
    controller.initialFailureChanges()
  );
  const resourceByEntryKey = new Map(initialResourceByEntryKey);
  const previousMemberIds = new Set(
    initialProjection.items.map((item) => item.id)
  );
  const syncCtx: ReviewDocumentSyncContext = {
    committedProjectionGenerationRef,
    context,
    softCacheScopeKey,
    diffBase,
    controller,
    currentDemandRef,
    demandPrefetchEntryKeysRef,
    diffHandleRef,
    entries,
    // prefetch / body 优先级只在 content 序上扩展
    entryKeysInOrder: contentEntryKeysInOrder,
    generation,
    indexGeneration,
    generationCallbacksRef,
    itemCacheKeysRef,
    itemIdsRef,
    loader,
    projectionLocaleRef,
    resourceByEntryKey,
    setProjection,
    setViewState,
    viewStateRef,
    previousItemsById: new Map(
      initialProjection.items.map((item) => [item.id, item])
    ),
    previousMemberIds,
    previousRevisionBySectionId: initialProjection.revisionBySectionId,
    previousStickyBodyEntryKeys,
  };
  const sync = createReviewDocumentSyncHandler(syncCtx);
  const unsubscribe = loader.subscribe(sync);
  loader.setProtectedEntryKey(selectedEntryKey);
  const renderWindow = renderWindowRef.current;
  const windowDemand =
    renderWindow === null
      ? { bufferedEntryKeys: [], visibleEntryKeys: [] }
      : reviewDocumentDemandForRenderWindow(
          initialProjection.entryKeyBySectionId,
          currentEntryKeys,
          renderWindow
        );
  const finalDemand = composeReviewDocumentDemand({
    // lookahead / radius 只在 content 序上扩展（禁止 meta 进 demand）
    entryKeysInOrder: contentEntryKeysInOrder,
    navigationPending: generationCallbacksRef.current.hasPendingNavigation(),
    seedEntryKeys,
    selectedEntryKey,
    protectSelectedAnchor: selectedEntryKey !== null,
    demandPrefetchEntryKeys: demandPrefetchEntryKeysRef.current,
    windowDemand,
  });
  currentDemandRef.current = finalDemand;
  loader.setWindowDemand(finalDemand);
  // G2：demand 内 content 水合超时 → error，禁止永久 estimate spinner
  const hydrateWatchdog = createHydrateTimeoutWatchdog();
  const tickHydrateTimeout = (): void => {
    if (loaderRef.current !== loader) {
      return;
    }
    const demand = currentDemandRef.current;
    const demanded = new Set([
      ...demand.visibleEntryKeys,
      ...demand.bufferedEntryKeys,
      ...(selectedEntryKey === null ? [] : [selectedEntryKey]),
      ...seedEntryKeys,
    ]);
    const timedOut = hydrateWatchdog.noteDemanded(demanded, (entryKey) => {
      const resource =
        resourceByEntryKey.get(entryKey) ?? loader.getResource(entryKey);
      // 仅 content 槽计时；meta 不进 timeout 目标
      if (
        resource !== undefined &&
        !isReviewEntryBodyHydratable(resource.entry)
      ) {
        return "unchanged";
      }
      return resource?.kind;
    });
    if (timedOut.length > 0) {
      loader.failHydrateTimeout(timedOut);
    }
  };
  // 立即 arm 时钟（禁止首 tick 才记 since 导致 ≤8s 变成 ~9s）
  tickHydrateTimeout();
  const hydrateTimer = globalThis.setInterval(tickHydrateTimeout, 1000);
  return () => {
    globalThis.clearInterval(hydrateTimer);
    hydrateWatchdog.clear();
    const snap = controller.snapshot(loader.getRetainedEntryKeys());
    previousSnapshotRef.current = snap;
    const loaded = new Map(
      snap.resources
        .filter(
          (
            resource
          ): resource is Extract<
            GitReviewDocumentResource,
            { kind: "loaded" }
          > => resource.kind === "loaded"
        )
        .map((resource) => [resource.entry.entryKey, resource])
    );
    // dispose 合并发布：源面卸载时仍把正文留给可能正在冷启动的目标面。
    publishReviewDocumentSoftCache(softCacheScopeKey, loaded);
    patchReviewSession(sourceKey, {
      loadedByEntryKey: loaded,
      retainedEntryKeys: loader.getRetainedEntryKeys(),
      selectedEntryKey: generationCallbacksRef.current.getSelectedEntryKey(),
      selectedSectionKey:
        generationCallbacksRef.current.getSelectedSectionKey(),
      anchor: null,
    });
    unsubscribe();
    loader.dispose();
    if (documentControllerRef.current === controller) {
      documentControllerRef.current = null;
    }
    if (loaderRef.current === loader) {
      loaderRef.current = null;
    }
    generationCallbacksRef.current.cancelRetentionSync(controller);
  };
}
