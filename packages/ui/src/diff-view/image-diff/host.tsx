import { useEffect, useState } from "react";
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

export function ImageDiffHost({
  imageDiff,
  metadata,
}: {
  readonly imageDiff: PierDiffViewImageDiff | undefined;
  readonly metadata: PierImageDiffAnnotationMetadata;
}): React.JSX.Element | null {
  const [mode, setMode] = useState<PierImageDiffMode>("two-up");
  const beforeUrl = useIssuedPreviewUrl(metadata.before?.locator, imageDiff);
  const afterUrl = useIssuedPreviewUrl(metadata.after?.locator, imageDiff);
  if (imageDiff === undefined) {
    return null;
  }
  return (
    <ImageDiffView
      after={metadata.after}
      afterUrl={afterUrl}
      before={metadata.before}
      beforeUrl={beforeUrl}
      labels={imageDiff.labels}
      locale={imageDiff.locale}
      mode={mode}
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
): string | null {
  const [url, setUrl] = useState<string | null>(
    locator === undefined ? null : ""
  );
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
  }, [imageDiff, locator]);
  return url;
}
