import type { GitReviewGroup } from "@shared/contracts/git-review.ts";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ReviewSurface } from "./git-review-content.tsx";
import { reviewTreeSectionKeyForSurface } from "./git-review-document-projection-index.ts";
import { ReviewFeedback } from "./git-review-feedback.tsx";
import { subscribeGitReviewMutationTransition } from "./git-review-mutation-transitions.ts";
import type {
  GitReviewMutationTransition,
  GitReviewReadingSurface,
} from "./git-review-reading-surface.ts";
import {
  GIT_REVIEW_UNCOMMITTED_READING_SURFACES,
  reviewGroupForSurface,
  reviewSurfaceForGroup,
} from "./git-review-surface-group.ts";
import type {
  ReviewSurfaceNavigationRequest,
  ReviewSurfaceProps,
} from "./git-review-surface-types.ts";

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
  const [activeSurface, setActiveSurface] = useState<GitReviewReadingSurface>(
    committed ? "committed" : "index"
  );
  const [mountedSurfaces, setMountedSurfaces] = useState<
    ReadonlySet<GitReviewReadingSurface>
  >(() => new Set([committed ? "committed" : "index"]));
  const [navigationRequest, setNavigationRequest] =
    useState<ReviewSurfaceNavigationRequest | null>(null);
  const [mutationTransition, setMutationTransition] =
    useState<PendingMutationTransition | null>(null);
  const [handoffSourceSurface, setHandoffSourceSurface] =
    useState<GitReviewReadingSurface | null>(null);
  const navigationRequestRef = useRef<ReviewSurfaceNavigationRequest | null>(
    null
  );
  const treeTransitionByIdRef = useRef(
    new Map<string, PendingMutationTransition>()
  );
  const lastNavigationPathRef = useRef<string | null>(null);
  const navigationNonceRef = useRef(0);
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
  const selectSurface = useCallback((surface: GitReviewReadingSurface) => {
    setHandoffSourceSurface(null);
    navigationRequestRef.current = null;
    setNavigationRequest(null);
    setMountedSurfaces((current) => {
      if (current.has(surface)) {
        return current;
      }
      return new Set([...current, surface]);
    });
    setActiveSurface(surface);
  }, []);
  const requestTreeOpen = useCallback(
    (entryKey: string, sectionKey: string, group: GitReviewGroup) => {
      const surface = reviewSurfaceForGroup(group);
      lastNavigationPathRef.current =
        props.entries.find((entry) => entry.entryKey === entryKey)?.path ??
        lastNavigationPathRef.current;
      setMountedSurfaces((current) => {
        if (current.has(surface)) {
          return current;
        }
        return new Set([...current, surface]);
      });
      navigationNonceRef.current += 1;
      const request = {
        activation: "activate",
        entryKey,
        itemId: sectionKey,
        nonce: navigationNonceRef.current,
        surface,
        treeSectionKey: sectionKey,
      } satisfies ReviewSurfaceNavigationRequest;
      navigationRequestRef.current = request;
      setNavigationRequest(request);
    },
    [props.entries]
  );
  useLayoutEffect(() => {
    if (
      committed ||
      activeSurface === "committed" ||
      navigationRequestRef.current !== null ||
      mutationTransition !== null
    ) {
      return;
    }
    const visibleGroups = props.treeModel.visibleGroups;
    if (
      visibleGroups.length === 0 ||
      visibleGroups.includes(reviewGroupForSurface(activeSurface))
    ) {
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
      return;
    }
    const itemId = reviewTreeSectionKeyForSurface(
      entry,
      mutationTransition.targetSurface
    );
    if (itemId === null) {
      return;
    }
    setMountedSurfaces((current) => {
      if (current.has(mutationTransition.targetSurface)) {
        return current;
      }
      return new Set([...current, mutationTransition.targetSurface]);
    });
    navigationNonceRef.current += 1;
    const request = {
      activation: "preserve",
      ...(mutationTransition.anchorOffset === undefined
        ? {}
        : { anchorOffset: mutationTransition.anchorOffset }),
      entryKey: mutationTransition.entryKey,
      itemId,
      minimumIndexGeneration: mutationTransition.minimumIndexGeneration,
      nonce: navigationNonceRef.current,
      surface: mutationTransition.targetSurface,
      treeSectionKey: itemId,
    } satisfies ReviewSurfaceNavigationRequest;
    navigationRequestRef.current = request;
    setNavigationRequest(request);
    setMutationTransition(null);
  }, [mutationTransition, props.entries]);
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
        setHandoffSourceSurface(null);
        return;
      }
      setHandoffSourceSurface(
        activeSurface === request.surface ? null : activeSurface
      );
      setActiveSurface(request.surface);
    },
    [activeSurface]
  );
  const handleNavigationSettled = useCallback(
    (request: ReviewSurfaceNavigationRequest) => {
      if (navigationRequestRef.current?.nonce !== request.nonce) {
        return;
      }
      navigationRequestRef.current = null;
      setNavigationRequest(null);
      setHandoffSourceSurface(null);
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
  return (
    <div
      className="relative h-full min-h-0"
      data-git-review-navigation-nonce={navigationRequest?.nonce ?? 0}
      data-git-review-navigation-surface={navigationRequest?.surface ?? ""}
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
        const handoffOverlay = surface === handoffSourceSurface;
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
              visibility: active || handoffOverlay ? "visible" : "hidden",
              zIndex: handoffOverlay ? 1 : 0,
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
  );
}

export const ReviewDocuments = memo(ReviewDocumentsComponent);
