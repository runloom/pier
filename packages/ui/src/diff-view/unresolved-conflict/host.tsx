import type { ReactElement } from "react";
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

export function UnresolvedConflictAnnotationHost({
  appearance,
  host,
  itemId,
  metadata,
  presentation,
}: {
  readonly appearance: PierDiffViewAppearance;
  readonly host: PierUnresolvedConflictHost | undefined;
  readonly itemId: string;
  readonly metadata: PierUnresolvedConflictAnnotationMetadata;
  readonly onOpenFile?: (itemId: string) => void;
  readonly presentation?: PierDiffViewPresentation;
}): ReactElement | null {
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
        embedInCodeView
        labels={host.labels}
        path={metadata.path}
        {...errorProp}
        onWriteResolved={(payload) => host.onWriteResolved(itemId, payload)}
        {...presentationProp}
      />
    );
  }
  const fileLevel =
    host.renderFileLevel === undefined
      ? undefined
      : host.renderFileLevel({
          busy,
          conflict: metadata.conflict,
          itemId,
          path: metadata.path,
          ...(metadata.stateNotice === undefined
            ? {}
            : { stateNotice: metadata.stateNotice }),
        });
  if (
    metadata.conflict.contents !== null &&
    metadata.conflict.presentation === "file-level"
  ) {
    return (
      <>
        {fileLevel}
        <FileConflictBody
          appearance={appearance}
          busy={busy}
          contents={metadata.conflict.contents}
          contentsDigest={metadata.conflict.contentsDigest}
          embedInCodeView
          labels={host.labels}
          path={metadata.path}
          {...presentationProp}
        />
      </>
    );
  }
  if (fileLevel !== undefined) {
    return <>{fileLevel}</>;
  }
  if (metadata.stateNotice === undefined) {
    return null;
  }
  return (
    <p className="px-5 py-3 text-muted-foreground text-sm">
      {metadata.stateNotice}
    </p>
  );
}

export function renderUnresolvedConflictAnnotation(
  metadata: unknown,
  options: {
    readonly appearance: PierDiffViewAppearance;
    readonly host: PierUnresolvedConflictHost | undefined;
    readonly itemId: string;
    readonly onOpenFile?: (itemId: string) => void;
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
      {...(options.onOpenFile === undefined
        ? {}
        : { onOpenFile: options.onOpenFile })}
      {...(options.presentation === undefined
        ? {}
        : { presentation: options.presentation })}
    />
  );
}
