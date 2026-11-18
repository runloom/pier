import { useCallback, useEffect, useRef, useState } from "react";
import {
  isImageDiffAnnotation,
  type PierImageDiffAnnotationMetadata,
} from "./annotation.ts";
import type {
  PierDiffViewImageDiff,
  PierImageDiffLocator,
  PierImageDiffMode,
} from "./types.ts";
import { ImageDiffView } from "./view.tsx";

/** One re-issue covers stale tickets; a deterministic failure still surfaces. */
const MAX_IMAGE_PREVIEW_RETRIES = 1;

export function ImageDiffHost({
  imageDiff,
  metadata,
}: {
  readonly imageDiff: PierDiffViewImageDiff | undefined;
  readonly metadata: PierImageDiffAnnotationMetadata;
}): React.JSX.Element | null {
  const [mode, setMode] = useState<PierImageDiffMode>("two-up");
  const before = useIssuedPreviewUrl(metadata.before?.locator, imageDiff);
  const after = useIssuedPreviewUrl(metadata.after?.locator, imageDiff);
  if (imageDiff === undefined) {
    return null;
  }
  return (
    <ImageDiffView
      after={metadata.after}
      afterUrl={after.url}
      before={metadata.before}
      beforeUrl={before.url}
      labels={imageDiff.labels}
      locale={imageDiff.locale}
      mode={mode}
      onAfterImageError={after.retry}
      onAfterImageLoad={after.markLoaded}
      onBeforeImageError={before.retry}
      onBeforeImageLoad={before.markLoaded}
      onModeChange={setMode}
    />
  );
}

export function renderImageDiffAnnotation(
  metadata: unknown,
  imageDiff: PierDiffViewImageDiff | undefined
): React.JSX.Element | null | undefined {
  if (!isImageDiffAnnotation(metadata)) {
    return;
  }
  return <ImageDiffHost imageDiff={imageDiff} metadata={metadata} />;
}

function useIssuedPreviewUrl(
  locator: PierImageDiffLocator | undefined,
  imageDiff: PierDiffViewImageDiff | undefined
): {
  readonly markLoaded: () => void;
  readonly retry: () => void;
  readonly url: string | null;
} {
  const [url, setUrl] = useState<string | null>(
    locator === undefined ? null : ""
  );
  const [retryNonce, setRetryNonce] = useState(0);
  const retryBudgetRef = useRef<{
    locator: PierImageDiffLocator | undefined;
    remaining: number;
  }>({ locator, remaining: MAX_IMAGE_PREVIEW_RETRIES });
  // 切换图片（文档刷新 / 换文件）给出新的重签预算；不要把旧图的失败带到新图。
  if (retryBudgetRef.current.locator !== locator) {
    retryBudgetRef.current = {
      locator,
      remaining: MAX_IMAGE_PREVIEW_RETRIES,
    };
  }
  // 成功显示过就恢复预算：review 面板可停留数小时，票据会再次过期。
  const markLoaded = useCallback(() => {
    const budget = retryBudgetRef.current;
    if (budget.locator === locator) {
      budget.remaining = MAX_IMAGE_PREVIEW_RETRIES;
    }
  }, [locator]);
  const retry = useCallback(() => {
    const budget = retryBudgetRef.current;
    if (budget.remaining <= 0) {
      return;
    }
    budget.remaining -= 1;
    setRetryNonce((current) => current + 1);
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: retryNonce re-issues the preview ticket after an image load error; it is not read in the effect body.
  useEffect(() => {
    if (locator === undefined || imageDiff === undefined) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    let ticket: string | null = null;
    setUrl("");
    imageDiff
      .resolve(locator)
      .then((issued) => {
        if (cancelled) {
          if (issued !== null) {
            imageDiff.release(issued.ticket);
          }
          return;
        }
        if (issued === null) {
          setUrl(null);
          return;
        }
        ticket = issued.ticket;
        setUrl(issued.url);
      })
      .catch(() => {
        if (!cancelled) {
          setUrl(null);
        }
      });
    return () => {
      cancelled = true;
      if (ticket !== null) {
        imageDiff.release(ticket);
      }
    };
  }, [imageDiff, locator, retryNonce]);
  return { markLoaded, retry, url };
}
