import type { GitReviewGroup } from "@shared/contracts/git/review.ts";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { GitChangeSummaryInline } from "../change-summary-display.tsx";
import { ReviewSurface } from "./content.tsx";
import { reviewTreeSectionKeyForSurface } from "./document/projection-index.ts";
import { useReviewViewOptions } from "./document/ui-state.ts";
import { ReviewFeedback } from "./feedback.tsx";
import { subscribeGitReviewMutationTransition } from "./mutation-transitions.ts";
import { GitReviewPanelLayout } from "./panel-layout.tsx";
import type {
  GitReviewMutationTransition,
  GitReviewReadingSurface,
  UncommittedGitReviewSurface,
} from "./reading-surface.ts";
import {
  GIT_REVIEW_UNCOMMITTED_READING_SURFACES,
  preferredUncommittedReadingSurface,
  reviewGroupForSurface,
  reviewSurfaceForGroup,
} from "./surface-group.ts";
import { GitReviewSurfaceSwitcher } from "./surface-switcher.tsx";
import type {
  ReviewActiveChrome,
  ReviewSurfaceNavigationRequest,
  ReviewSurfaceProps,
  ReviewTreeOpenReveal,
} from "./surface-types.ts";
import { buildActivateNavigationRequest } from "./surface-types.ts";
import { GitReviewToolbar } from "./toolbar.tsx";

type PendingMutationTransition = GitReviewMutationTransition;
function ReviewDocumentsComponent(
  props: Omit<
    ReviewSurfaceProps,
    | "active"
    | "activeSurface"
    | "diffBase"
    | "navigationRequest"
    | "onNavigationMaterialized"
    | "onSurfaceNavigationSettled"
    | "onMutationTransition"
    | "onRequestTreeOpen"
    | "onAcquireMutationAuthority"
    | "onSelectSurface"
  > & {
    readonly onAcquireMutationAuthority: () => boolean;
  }
): React.JSX.Element {
  const committed = props.scope.target.kind !== "uncommitted";
  // 直接打开：优先展示序第一个有内容的面（通常「已暂存更改」先于「更改」）
  const initialSurface: GitReviewReadingSurface = committed
    ? "committed"
    : preferredUncommittedReadingSurface(props.treeModel.visibleGroups);
  const [activeSurface, setActiveSurface] =
    useState<GitReviewReadingSurface>(initialSurface);
  const activeSurfaceRef = useRef(activeSurface);
  activeSurfaceRef.current = activeSurface;
  const [mountedSurfaces, setMountedSurfaces] = useState<
    ReadonlySet<GitReviewReadingSurface>
  >(() => new Set([initialSurface]));
  /** 用户点过页签 / 树导航后不再自动改默认面 */
  const userPickedSurfaceRef = useRef(false);
  /** index 首次有 visibleGroups 时对齐一次默认面 */
  const defaultSurfaceSettledRef = useRef(
    committed || props.treeModel.visibleGroups.length > 0
  );
  const [navigationRequest, setNavigationRequest] =
    useState<ReviewSurfaceNavigationRequest | null>(null);
  const [mutationTransition, setMutationTransition] =
    useState<PendingMutationTransition | null>(null);
  const navigationRequestRef = useRef<ReviewSurfaceNavigationRequest | null>(
    null
  );
  const treeTransitionByIdRef = useRef(
    new Map<string, PendingMutationTransition>()
  );
  const lastNavigationPathRef = useRef<string | null>(null);
  const navigationNonceRef = useRef(0);
  // Monotonic seq (e2e); active nonce attr resets on settle.
  const [navigationSeq, setNavigationSeq] = useState(0);
  useEffect(
    () =>
      subscribeGitReviewMutationTransition((event) => {
        if (event.kind !== "begin") {
          const pending = treeTransitionByIdRef.current.get(event.transitionId);
          treeTransitionByIdRef.current.delete(event.transitionId);
          if (event.kind === "commit" && pending !== undefined) {
            setMutationTransition({
              ...pending,
              minimumIndexGeneration: Math.max(
                pending.minimumIndexGeneration,
                event.stateSequence ?? 0
              ),
            });
          }
          return;
        }
        const { transition } = event;
        if (
          transition.contextId !== props.scope.contextId ||
          transition.gitRootPath !== props.scope.gitRootPath
        ) {
          return;
        }
        treeTransitionByIdRef.current.set(transition.transitionId, {
          entryKey: "",
          minimumIndexGeneration: props.indexGeneration + 1,
          path: transition.path,
          targetSurface: transition.targetSurface,
        });
      }),
    [props.indexGeneration, props.scope]
  );
  /** 共享树高亮：跨面点击只改此 id，不换树实例 */
  const [selectedTreeSectionKey, setSelectedTreeSectionKey] = useState<
    string | null
  >(null);
  /** 活动面折叠等工具条状态 → 共享 header trailing */
  const [activeChrome, setActiveChrome] = useState<ReviewActiveChrome | null>(
    null
  );
  const { options: viewOptions, setOptions: setViewOptions } =
    useReviewViewOptions();
  const selectSurface = useCallback((surface: GitReviewReadingSurface) => {
    userPickedSurfaceRef.current = true;
    navigationRequestRef.current = null;
    setNavigationRequest(null);
    setMountedSurfaces((current) => addSurface(current, surface));
    setActiveSurface(surface);
    activeSurfaceRef.current = surface;
  }, []);
  const requestTreeOpen = useCallback(
    (
      entryKey: string,
      sectionKey: string,
      group: GitReviewGroup,
      reveal?: ReviewTreeOpenReveal
    ) => {
      userPickedSurfaceRef.current = true;
      setSelectedTreeSectionKey(sectionKey);
      const surface = reviewSurfaceForGroup(group);
      lastNavigationPathRef.current =
        props.entries.find((entry) => entry.entryKey === entryKey)?.path ??
        lastNavigationPathRef.current;
      setMountedSurfaces((current) => addSurface(current, surface));
      // 树跨面点击：立即切面 + 立即可见新面（无旧面 handoff 叠层）。
      // 切面后由目标面 beginNavigation 做 demand/scroll。
      if (activeSurfaceRef.current !== surface) {
        setActiveSurface(surface);
        activeSurfaceRef.current = surface;
      }
      navigationNonceRef.current += 1;
      const nonce = navigationNonceRef.current;
      setNavigationSeq(nonce);
      const request = buildActivateNavigationRequest(
        nonce,
        entryKey,
        sectionKey,
        surface,
        reveal
      );
      navigationRequestRef.current = request;
      setNavigationRequest(request);
    },
    [props.entries]
  );
  /** 共享树点击：只切换右侧正文面，树结构/展开态保持 */
  const openSharedTreePath = useCallback(
    (path: string) => {
      const fileRef = props.treeModel.getFileRefForTreePath(path);
      if (!fileRef) {
        return;
      }
      requestTreeOpen(fileRef.entryKey, fileRef.sectionKey, fileRef.group);
    },
    [props.treeModel, requestTreeOpen]
  );
  const isActiveOpenPath = useCallback(
    (path: string) => {
      const fileRef = props.treeModel.getFileRefForTreePath(path);
      if (!fileRef || selectedTreeSectionKey === null) {
        return false;
      }
      return fileRef.sectionKey === selectedTreeSectionKey;
    },
    [props.treeModel, selectedTreeSectionKey]
  );
  // index 从空 → 有分组：对齐「直接打开」默认面（用户已点选则跳过）
  // 当前面已无成员：始终落到有内容的面（不受 userPicked 影响）
  useLayoutEffect(() => {
    if (committed) {
      return;
    }
    const visibleGroups = props.treeModel.visibleGroups;
    if (visibleGroups.length === 0) {
      return;
    }
    const preferred = preferredUncommittedReadingSurface(visibleGroups);
    if (!defaultSurfaceSettledRef.current) {
      if (userPickedSurfaceRef.current) {
        defaultSurfaceSettledRef.current = true;
        return;
      }
      defaultSurfaceSettledRef.current = true;
      if (preferred !== activeSurface) {
        setMountedSurfaces((current) => new Set([...current, preferred]));
        setActiveSurface(preferred);
      }
      return;
    }
    // 当前面已无成员（冲突消解 / 全 stage 走空）：落到展示序第一个有内容的面
    if (
      activeSurface === "committed" ||
      navigationRequestRef.current !== null ||
      mutationTransition !== null
    ) {
      return;
    }
    if (visibleGroups.includes(reviewGroupForSurface(activeSurface))) {
      return;
    }
    const fallbackSlots = visibleGroups.flatMap((group) =>
      props.entries.flatMap((entry) =>
        entry.renderSlots
          .filter((slot) => slot.group === group)
          .map((slot) => ({ entry, group, slot }))
      )
    );
    const samePath = lastNavigationPathRef.current;
    const fallback =
      fallbackSlots.find(({ entry }) => entry.path === samePath) ??
      fallbackSlots[0];
    if (fallback === undefined) {
      setMountedSurfaces((current) => new Set([...current, preferred]));
      setActiveSurface(preferred);
      return;
    }
    requestTreeOpen(
      fallback.entry.entryKey,
      fallback.slot.sectionKey,
      fallback.group
    );
  }, [
    activeSurface,
    committed,
    mutationTransition,
    props.entries,
    props.treeModel.visibleGroups,
    requestTreeOpen,
  ]);
  useEffect(() => {
    if (mutationTransition === null) {
      return;
    }
    const entry = props.entries.find(
      (candidate) =>
        candidate.entryKey === mutationTransition.entryKey ||
        candidate.path === mutationTransition.path
    );
    if (entry === undefined) {
      // 权威 index 未到前 entry 可能尚未出现；catch-up 后仍缺失才放弃。
      if (props.indexGeneration >= mutationTransition.minimumIndexGeneration) {
        setMutationTransition(null);
      }
      return;
    }
    const itemId = reviewTreeSectionKeyForSurface(
      entry,
      mutationTransition.targetSurface
    );
    if (itemId === null) {
      // 权威 index 未到前 entry 仍在源面：等 catch-up，勿抢先 clear。
      // catch-up 后仍无目标槽位才放弃，避免卡死 mutation authority。
      if (props.indexGeneration >= mutationTransition.minimumIndexGeneration) {
        setMutationTransition(null);
      }
      return;
    }
    setMountedSurfaces((current) =>
      addSurface(current, mutationTransition.targetSurface)
    );
    navigationNonceRef.current += 1;
    const nonce = navigationNonceRef.current;
    setNavigationSeq(nonce);
    const request = {
      activation: "preserve" as const,
      ...(mutationTransition.anchorOffset === undefined
        ? {}
        : { anchorOffset: mutationTransition.anchorOffset }),
      entryKey: mutationTransition.entryKey,
      itemId,
      minimumIndexGeneration: mutationTransition.minimumIndexGeneration,
      nonce,
      surface: mutationTransition.targetSurface,
      treeSectionKey: itemId,
    };
    navigationRequestRef.current = request;
    setNavigationRequest(request);
    setMutationTransition(null);
  }, [mutationTransition, props.entries, props.indexGeneration]);
  const handleMutationTransition = useCallback(
    (transition: GitReviewMutationTransition) => {
      setMutationTransition(transition);
    },
    []
  );
  const acquireMutationAuthority = useCallback(() => {
    if (!props.onAcquireMutationAuthority()) {
      return null;
    }
    return { minimumIndexGeneration: props.indexGeneration + 1 };
  }, [props.indexGeneration, props.onAcquireMutationAuthority]);
  const handleNavigationMaterialized = useCallback(
    (request: ReviewSurfaceNavigationRequest) => {
      const latest = navigationRequestRef.current;
      if (
        latest?.nonce !== request.nonce ||
        latest.surface !== request.surface
      ) {
        return;
      }
      if (request.activation === "preserve") {
        navigationRequestRef.current = null;
        setNavigationRequest(null);
        return;
      }
      // activate 兜底：树路径已在 requestTreeOpen 切面；无 handoff 叠层。
      if (activeSurfaceRef.current !== request.surface) {
        setActiveSurface(request.surface);
        activeSurfaceRef.current = request.surface;
      }
    },
    []
  );
  const handleNavigationSettled = useCallback(
    (request: ReviewSurfaceNavigationRequest) => {
      if (navigationRequestRef.current?.nonce !== request.nonce) {
        return;
      }
      navigationRequestRef.current = null;
      setNavigationRequest(null);
    },
    []
  );
  const surfaces: readonly GitReviewReadingSurface[] = committed
    ? ["committed"]
    : GIT_REVIEW_UNCOMMITTED_READING_SURFACES;
  const activeSurfaceMissing =
    !committed &&
    activeSurface !== "committed" &&
    !props.treeModel.visibleGroups.includes(
      reviewGroupForSurface(activeSurface)
    );
  const headerSummaryGroup =
    activeSurface === "committed"
      ? "committed"
      : reviewGroupForSurface(activeSurface);
  const headerSummary = props.groupSummaries[headerSummaryGroup];
  const sharedHeaderLeading =
    committed || props.treeModel.visibleGroups.length === 0 ? (
      props.headerLeading
    ) : (
      <div className="flex min-w-0 items-center gap-2">
        {props.headerLeading}
        <GitReviewSurfaceSwitcher
          context={props.context}
          groups={props.treeModel.visibleGroups}
          labels={props.treeModel.groupLabels}
          onSelect={(surface: UncommittedGitReviewSurface) => {
            selectSurface(surface);
          }}
          value={
            activeSurface === "committed"
              ? "index"
              : (activeSurface as UncommittedGitReviewSurface)
          }
        />
      </div>
    );
  return (
    <GitReviewPanelLayout
      context={props.context}
      contextId={props.scope.contextId}
      gitRootPath={props.scope.gitRootPath}
      {...(headerSummary === undefined
        ? {}
        : {
            headerCenter: (
              <GitChangeSummaryInline
                className="text-xs"
                context={props.context}
                filesWithUnit
                summary={headerSummary}
                testId="git-review-change-summary"
              />
            ),
          })}
      {...(sharedHeaderLeading === undefined
        ? {}
        : { headerLeading: sharedHeaderLeading })}
      headerTrailing={
        <GitReviewToolbar
          allCollapsed={activeChrome?.allCollapsed ?? false}
          context={props.context}
          onRefresh={props.onRetryIndex}
          onToggleCollapseAll={() => {
            activeChrome?.onToggleCollapseAll();
          }}
          refreshing={props.indexRefreshing === true}
          setViewOptions={setViewOptions}
          viewOptions={viewOptions}
        />
      }
      isActiveOpenPath={isActiveOpenPath}
      mutationAuthorityBlocked={props.mutationAuthorityBlocked}
      onOpenPath={openSharedTreePath}
      setSidebarCollapsed={props.setSidebarCollapsed}
      sidebarCollapsed={props.sidebarCollapsed}
      sourcePanelId={props.panelId}
      treeModel={props.targetSelectionPending === true ? null : props.treeModel}
    >
      <div
        className="relative h-full min-h-0"
        data-git-review-navigation-nonce={navigationRequest?.nonce ?? 0}
        data-git-review-navigation-seq={navigationSeq}
        data-git-review-navigation-surface={navigationRequest?.surface ?? ""}
        data-git-review-shared-tree=""
      >
        <ReviewFeedback
          context={props.context}
          enabled={props.panelVisible}
          failures={[]}
          indexFailure={props.indexRefreshFailure}
          onRetryIndex={props.onRetryIndex}
        />
        {surfaces.map((surface) => {
          if (!mountedSurfaces.has(surface)) {
            return null;
          }
          const active = surface === activeSurface;
          const navigationLeavingSurface =
            active &&
            navigationRequest?.activation === "activate" &&
            navigationRequest.surface !== surface;
          return (
            <div
              aria-hidden={!active}
              className="absolute inset-0"
              data-git-review-surface={surface}
              inert={active ? undefined : true}
              key={surface}
              style={{
                pointerEvents: active ? "auto" : "none",
                visibility: active ? "visible" : "hidden",
              }}
            >
              <ReviewSurface
                {...props}
                active={active && props.panelVisible}
                activeSurface={activeSurface}
                diffBase={surface}
                indexRefreshFailure={null}
                mutationAuthorityBlocked={
                  props.mutationAuthorityBlocked ||
                  mutationTransition !== null ||
                  navigationLeavingSurface ||
                  (active && activeSurfaceMissing)
                }
                navigationRequest={navigationRequest}
                onAcquireMutationAuthority={acquireMutationAuthority}
                onActiveChromeChange={setActiveChrome}
                onMutationTransition={handleMutationTransition}
                onNavigationMaterialized={handleNavigationMaterialized}
                onRequestTreeOpen={requestTreeOpen}
                onSelectSurface={selectSurface}
                onSurfaceNavigationSettled={handleNavigationSettled}
              />
            </div>
          );
        })}
      </div>
    </GitReviewPanelLayout>
  );
}

function addSurface(
  set: ReadonlySet<GitReviewReadingSurface>,
  surface: GitReviewReadingSurface
): ReadonlySet<GitReviewReadingSurface> {
  return set.has(surface) ? set : new Set([...set, surface]);
}

export const ReviewDocuments = memo(ReviewDocumentsComponent);
