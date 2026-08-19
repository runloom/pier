import type { CSSProperties } from "react";
import { useState } from "react";
import { formatBytes } from "../../format.tsx";
import { Skeleton } from "../../skeleton.tsx";
import {
  IMAGE_DIFF_MAX_STAGE_PX,
  type ImageDiffBox,
  type ImageDiffStage,
} from "./stage.ts";
import type { PierImageDiffLabels, PierImageDiffSide } from "./types.ts";

export const IMAGE_DIFF_IMAGE_CLASS =
  "inline-block max-w-full border border-solid leading-none";

export const IMAGE_DIFF_STAGE_CLASS =
  "relative mx-auto max-h-96 max-w-full overflow-hidden";

/** Opaque transparency checker; each swipe pane needs its own so PNG alpha does not reveal the other image. */
export const IMAGE_DIFF_CHECKER_SLOT = "pier-image-diff-checker";

export function ImagePane({
  accent,
  caption,
  labels,
  locale,
  side,
  stage,
  url,
}: {
  readonly accent: "addition" | "deletion";
  readonly caption: string;
  readonly labels: PierImageDiffLabels;
  readonly locale: string;
  readonly side: PierImageDiffSide;
  readonly stage: ImageDiffStage | null;
  readonly url: string | null;
}): React.JSX.Element {
  const box = accent === "addition" ? stage?.after : stage?.before;
  return (
    <figure className="flex w-fit min-w-0 max-w-full flex-col items-center gap-2">
      <figcaption className="font-medium text-xs" style={accentColor(accent)}>
        {caption}
      </figcaption>
      <ImageFrame
        accent={accent}
        box={box ?? null}
        labels={labels}
        pixelated={stage?.pixelated ?? false}
        url={url}
      />
      <p className="text-center text-muted-foreground text-xs tabular-nums">
        {sideMeta(side, labels, locale)}
      </p>
    </figure>
  );
}

export function ImageDiffSideCaptions({
  labels,
}: {
  readonly labels: PierImageDiffLabels;
}): React.JSX.Element {
  return (
    <div className="flex w-full max-w-full justify-between gap-4">
      <span className="font-medium text-xs" style={accentColor("deletion")}>
        {labels.deleted}
      </span>
      <span className="font-medium text-xs" style={accentColor("addition")}>
        {labels.added}
      </span>
    </div>
  );
}

export function ImageFrame({
  accent,
  box,
  labels,
  pixelated,
  url,
}: {
  readonly accent: "addition" | "deletion";
  readonly box: ImageDiffBox | null;
  readonly labels: PierImageDiffLabels;
  readonly pixelated: boolean;
  readonly url: string | null;
}): React.JSX.Element {
  return (
    <div
      className={IMAGE_DIFF_IMAGE_CLASS}
      data-slot="pier-image-diff-image"
      style={{
        ...accentBorder(accent),
        ...(box === null
          ? {}
          : { maxHeight: IMAGE_DIFF_MAX_STAGE_PX, width: box.width }),
      }}
    >
      <PreviewImage
        height={box?.height ?? null}
        labels={labels}
        pixelated={pixelated}
        url={url}
        width={box?.width ?? null}
      />
    </div>
  );
}

export function StagedImage({
  box,
  labels,
  pixelated,
  stage,
  url,
}: {
  readonly box: ImageDiffBox | null;
  readonly labels: PierImageDiffLabels;
  readonly pixelated: boolean;
  readonly stage: ImageDiffStage | null;
  readonly url: string | null;
}): React.JSX.Element {
  const placed = box !== null && stage !== null;
  const load = usePreviewImageLoad(url);
  if (load.url === null) {
    return (
      <PreviewImage
        height={box?.height ?? null}
        labels={labels}
        pixelated={pixelated}
        url={null}
        width={box?.width ?? null}
      />
    );
  }
  if (load.url.length === 0) {
    return (
      <PreviewImage
        height={box?.height ?? null}
        labels={labels}
        pixelated={pixelated}
        url=""
        width={box?.width ?? null}
      />
    );
  }
  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: load failures are scoped to the preview URL
    <img
      alt=""
      className={
        placed
          ? "absolute max-h-none max-w-none"
          : "relative mx-auto block max-h-96 max-w-full object-contain"
      }
      decoding="async"
      height={box?.height ?? 1}
      onError={load.onError}
      src={load.url}
      style={{
        ...(pixelated ? { imageRendering: "pixelated" } : {}),
        ...(box !== null && stage !== null ? placedImageStyle(box, stage) : {}),
      }}
      width={box?.width ?? 1}
    />
  );
}

export function stageFrameStyle(stage: ImageDiffStage | null): CSSProperties {
  if (stage === null) {
    return { minHeight: "8rem", minWidth: "8rem" };
  }
  return {
    height: stage.height,
    maxHeight: IMAGE_DIFF_MAX_STAGE_PX,
    maxWidth: "100%",
    width: stage.width,
  };
}

export function accentColor(accent: "addition" | "deletion"): CSSProperties {
  return {
    color:
      accent === "addition"
        ? "var(--diffs-addition-base)"
        : "var(--diffs-deletion-base)",
  };
}

export function accentBorder(accent: "addition" | "deletion"): CSSProperties {
  return {
    borderColor:
      accent === "addition"
        ? "var(--diffs-addition-base)"
        : "var(--diffs-deletion-base)",
  };
}

function PreviewImage({
  height,
  labels,
  pixelated,
  url,
  width,
}: {
  readonly height: number | null;
  readonly labels: PierImageDiffLabels;
  readonly pixelated: boolean;
  readonly url: string | null;
  readonly width: number | null;
}): React.JSX.Element {
  const load = usePreviewImageLoad(url);
  if (load.url === null) {
    return (
      <div className="flex min-h-32 min-w-32 items-center justify-center p-4 text-center text-muted-foreground text-xs">
        {labels.loadFailed}
      </div>
    );
  }
  if (load.url.length === 0) {
    return <Skeleton className="h-32 w-32" />;
  }
  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: load failures are scoped to the preview URL
    <img
      alt=""
      className="block h-auto max-h-96 w-full max-w-full"
      decoding="async"
      height={height ?? 1}
      onError={load.onError}
      src={load.url}
      style={pixelated ? { imageRendering: "pixelated" } : undefined}
      width={width ?? 1}
    />
  );
}

function usePreviewImageLoad(url: string | null): {
  readonly onError: () => void;
  readonly url: string | null;
} {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (url === null || failedUrl === url) {
    return {
      onError: () => undefined,
      url: null,
    };
  }
  return {
    onError: () => {
      setFailedUrl(url);
    },
    url,
  };
}

function placedImageStyle(
  box: ImageDiffBox,
  stage: ImageDiffStage
): CSSProperties {
  return {
    height: `${String((box.height / stage.height) * 100)}%`,
    left: `${String(((stage.width - box.width) / 2 / stage.width) * 100)}%`,
    top: `${String(((stage.height - box.height) / 2 / stage.height) * 100)}%`,
    width: `${String((box.width / stage.width) * 100)}%`,
  };
}

function sideMeta(
  side: PierImageDiffSide,
  labels: PierImageDiffLabels,
  locale: string
): string {
  const size = formatBytes(side.byteSize, locale);
  if (side.width === null || side.height === null) {
    return size;
  }
  return `${labels.dimensions
    .replaceAll("{{width}}", String(side.width))
    .replaceAll("{{height}}", String(side.height))} · ${size}`;
}
