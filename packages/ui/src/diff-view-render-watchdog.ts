import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

interface RenderedItemIdentity {
  readonly element: Element;
  readonly id: string;
  readonly version: number | undefined;
}

interface ExpectedItemIdentity {
  readonly id: string;
  readonly version?: number;
}

interface RenderConfirmations {
  readonly environment: string;
  readonly items: Map<
    string,
    { readonly element: Element; readonly version: number | undefined }
  >;
}

interface RenderStatus {
  readonly confirmed: boolean;
  readonly environment: string;
  readonly revision: number;
  readonly visibleKey: string;
}

function renderItemKey(id: string, version: number | undefined): string {
  return JSON.stringify([id, version ?? 0]);
}

export function isRenderedItemVisible(
  container: Element | undefined,
  items: readonly RenderedItemIdentity[],
  id: string,
  version?: number
): boolean {
  const element = items.find(
    (item) =>
      item.id === id && (version === undefined || item.version === version)
  )?.element;
  if (!(container && element)) {
    return false;
  }
  const viewport = container.getBoundingClientRect();
  const item = element.getBoundingClientRect();
  return item.bottom > viewport.top && item.top < viewport.bottom;
}

/**
 * 渲染环境变化才更换官方 onPostRender 回调；item 增量不改变 options 身份。
 * 当前虚拟窗口在官方下一帧更新后单独审计，避免用任一 item 冒充整窗成功。
 */
export function useDiffRenderWatchdog(
  environment: string,
  expectedItems: readonly ExpectedItemIdentity[],
  getRenderedItems: () => readonly RenderedItemIdentity[]
): {
  readonly auditVisibleItems: () => void;
  readonly markRendered: (
    id: string,
    version: number | undefined,
    element: Element
  ) => void;
  readonly expectItemRender: (id: string, version: number | undefined) => void;
  readonly pendingRenderKey: string | null;
} {
  const confirmationsRef = useRef<RenderConfirmations | null>(null);
  const auditFramesRef = useRef<{
    first: number | null;
    second: number | null;
  }>({ first: null, second: null });
  const [status, setStatus] = useState<RenderStatus>(() => ({
    confirmed: false,
    environment,
    revision: 0,
    visibleKey: "",
  }));

  const inspectVisibleItems = useCallback(
    (targetEnvironment: string) => {
      queueMicrotask(() => {
        const confirmations = confirmationsRef.current;
        const renderedItems = getRenderedItems();
        const itemKeys = renderedItems.map((item) =>
          renderItemKey(item.id, item.version)
        );
        const visibleKey = JSON.stringify(itemKeys);
        const confirmed =
          renderedItems.length > 0 &&
          confirmations?.environment === targetEnvironment &&
          renderedItems.every((item) => {
            const confirmation = confirmations.items.get(item.id);
            return (
              confirmation?.element === item.element &&
              confirmation.version === item.version
            );
          });
        setStatus((current) => {
          if (
            current.environment === targetEnvironment &&
            current.visibleKey === visibleKey &&
            current.confirmed === confirmed
          ) {
            return current;
          }
          return {
            confirmed,
            environment: targetEnvironment,
            revision: current.revision + 1,
            visibleKey,
          };
        });
      });
    },
    [getRenderedItems]
  );

  const markRendered = useCallback(
    (id: string, version: number | undefined, element: Element) => {
      let confirmations = confirmationsRef.current;
      if (confirmations?.environment !== environment) {
        confirmations = { environment, items: new Map() };
        confirmationsRef.current = confirmations;
      }
      confirmations.items.set(id, { element, version });
      inspectVisibleItems(environment);
    },
    [environment, inspectVisibleItems]
  );

  const expectItemRender = useCallback(
    (id: string, version: number | undefined) => {
      const confirmations = confirmationsRef.current;
      if (confirmations?.environment === environment) {
        confirmations.items.delete(id);
      }
      setStatus((current) => ({
        confirmed: false,
        environment,
        revision: current.revision + 1,
        visibleKey: `${current.visibleKey}\0${renderItemKey(id, version)}`,
      }));
      inspectVisibleItems(environment);
    },
    [environment, inspectVisibleItems]
  );

  useLayoutEffect(() => {
    let confirmations = confirmationsRef.current;
    if (confirmations?.environment !== environment) {
      confirmations = { environment, items: new Map() };
      confirmationsRef.current = confirmations;
    }
    const expectedVersions = new Map(
      expectedItems.map((item) => [item.id, item.version] as const)
    );
    for (const [id, confirmation] of confirmations.items) {
      if (
        !expectedVersions.has(id) ||
        expectedVersions.get(id) !== confirmation.version
      ) {
        confirmations.items.delete(id);
      }
    }
    inspectVisibleItems(environment);
  }, [environment, expectedItems, inspectVisibleItems]);

  const cancelAudit = useCallback(() => {
    const frames = auditFramesRef.current;
    if (frames.first !== null) {
      cancelAnimationFrame(frames.first);
    }
    if (frames.second !== null) {
      cancelAnimationFrame(frames.second);
    }
    frames.first = null;
    frames.second = null;
  }, []);

  const auditVisibleItems = useCallback(() => {
    cancelAudit();
    auditFramesRef.current.first = requestAnimationFrame(() => {
      auditFramesRef.current.first = null;
      auditFramesRef.current.second = requestAnimationFrame(() => {
        auditFramesRef.current.second = null;
        inspectVisibleItems(environment);
      });
    });
  }, [cancelAudit, environment, inspectVisibleItems]);

  useEffect(() => cancelAudit, [cancelAudit]);

  return {
    auditVisibleItems,
    expectItemRender,
    markRendered,
    pendingRenderKey:
      status.environment === environment && status.confirmed
        ? null
        : `${environment}\0${status.revision}`,
  };
}
