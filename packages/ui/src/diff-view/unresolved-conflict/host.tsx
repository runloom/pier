import { createContext, type ReactElement, useContext } from "react";
import type {
  PierDiffViewAppearance,
  PierDiffViewPresentation,
} from "../types.ts";
import {
  isUnresolvedConflictAnnotation,
  type PierUnresolvedConflictAnnotationMetadata,
} from "./annotation.ts";
import { FileConflictBody } from "./file-body.tsx";
import type { PierUnresolvedConflictHost } from "./host-types.ts";
import { MarkersConflictBody } from "./markers-body.tsx";

/** Pierre caches annotation elements; live view state must cross that cache. */
export const UnresolvedConflictViewContext = createContext<{
  readonly appearance: PierDiffViewAppearance;
  readonly host: PierUnresolvedConflictHost | undefined;
  readonly presentation: PierDiffViewPresentation | undefined;
} | null>(null);

export function UnresolvedConflictAnnotationHost({
  appearance: initialAppearance,
  host: initialHost,
  itemId,
  metadata,
  presentation: initialPresentation,
}: {
  readonly appearance: PierDiffViewAppearance;
  readonly host: PierUnresolvedConflictHost | undefined;
  readonly itemId: string;
  readonly metadata: PierUnresolvedConflictAnnotationMetadata;
  readonly presentation?: PierDiffViewPresentation;
}): ReactElement | null {
  const live = useContext(UnresolvedConflictViewContext);
  const appearance = live === null ? initialAppearance : live.appearance;
  const host = live === null ? initialHost : live.host;
  const presentation = live === null ? initialPresentation : live.presentation;
  if (host === undefined) {
    return null;
  }
  const busy = host.mutationLocked === true || host.busyItemId === itemId;
  const presentationProp = presentation === undefined ? {} : { presentation };
  const errorProp = host.onError === undefined ? {} : { onError: host.onError };
  if (
    metadata.conflict.contents !== null &&
    metadata.conflict.presentation === "markers-text"
  ) {
    return (
      <MarkersConflictBody
        appearance={appearance}
        busy={busy}
        contents={metadata.conflict.contents}
        contentsDigest={metadata.conflict.contentsDigest}
        labels={host.labels}
        path={metadata.path}
        {...errorProp}
        onWriteResolved={(payload) => host.onWriteResolved(itemId, payload)}
        {...presentationProp}
      />
    );
  }
  if (
    metadata.conflict.contents !== null &&
    metadata.conflict.presentation === "file-level"
  ) {
    return (
      <FileConflictBody
        appearance={appearance}
        contents={metadata.conflict.contents}
        contentsDigest={metadata.conflict.contentsDigest}
        path={metadata.path}
        {...presentationProp}
      />
    );
  }
  return null;
}

export function renderUnresolvedConflictAnnotation(
  metadata: unknown,
  options: {
    readonly appearance: PierDiffViewAppearance;
    readonly host: PierUnresolvedConflictHost | undefined;
    readonly itemId: string;
    readonly presentation?: PierDiffViewPresentation;
  }
): ReactElement | null | undefined {
  if (!isUnresolvedConflictAnnotation(metadata)) {
    return;
  }
  return (
    <UnresolvedConflictAnnotationHost
      appearance={options.appearance}
      host={options.host}
      itemId={options.itemId}
      metadata={metadata}
      {...(options.presentation === undefined
        ? {}
        : { presentation: options.presentation })}
    />
  );
}
