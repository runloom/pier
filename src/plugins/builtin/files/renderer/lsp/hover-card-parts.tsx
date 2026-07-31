import { cn } from "@pier/ui/utils.ts";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type Ref,
  useMemo,
} from "react";
import type {
  FilesLspHoverCardModel,
  FilesLspPreparedDefinition,
  FilesLspPreparedDocumentation,
} from "./hover-types.ts";
import { sanitizeFilesLspHtml } from "./html-sanitizer.ts";

export function basename(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1) || path;
}

export function locationLabel(target: FilesLspPreparedDefinition): string {
  return `${basename(target.path)}:${target.range.start.line + 1}`;
}

export function DocumentationBlock({
  documentation,
}: {
  documentation: FilesLspPreparedDocumentation;
}) {
  const sanitizedHtml = useMemo(
    () =>
      documentation.html === undefined
        ? undefined
        : sanitizeFilesLspHtml(documentation.html),
    [documentation.html]
  );
  if (documentation.kind === "markdown" && sanitizedHtml !== undefined) {
    return (
      <div
        className="cm-lsp-documentation"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitizeFilesLspHtml runs at this final HTML sink.
        dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
      />
    );
  }
  return (
    <p className="cm-lsp-documentation whitespace-pre-wrap">
      {documentation.value}
    </p>
  );
}

export function DefinitionPreview({
  labels,
  onActivate,
  target,
}: {
  labels: FilesLspHoverCardModel["labels"];
  onActivate?: () => void;
  target: FilesLspPreparedDefinition;
}) {
  const targetLine = target.range.start.line + 1;
  const interactive = onActivate !== undefined;
  const previewClassName = cn(
    "cm-lsp-definition-preview flex min-w-0 flex-col gap-0.5 overflow-x-auto font-mono text-xs",
    interactive && "cursor-pointer"
  );
  const previewBody =
    target.preview === null ? (
      <span className="px-1 py-0.5 text-muted-foreground">
        {labels.previewUnavailable}
      </span>
    ) : (
      target.preview?.map((line) => {
        const isTarget = line.lineNumber === targetLine;
        return (
          <div
            className={cn(
              "flex min-w-0 gap-2 px-1 py-px",
              isTarget && "cm-lsp-definition-preview-target-line"
            )}
            key={line.lineNumber}
          >
            <span className="w-8 shrink-0 text-right text-muted-foreground tabular-nums">
              {line.lineNumber}
            </span>
            <code className="min-w-0 whitespace-pre-wrap break-all">
              {line.text}
            </code>
            {line.truncated ? (
              <span
                className="shrink-0 text-muted-foreground"
                title={labels.lineTruncated}
              >
                …
              </span>
            ) : null}
          </div>
        );
      })
    );
  if (interactive) {
    return (
      <button
        aria-busy={target.preview === undefined}
        className={previewClassName}
        data-slot="files-lsp-definition-preview"
        onClick={onActivate}
        onKeyDown={(event: ReactKeyboardEvent) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onActivate();
          }
        }}
        type="button"
      >
        {previewBody}
      </button>
    );
  }
  return (
    <div
      aria-busy={target.preview === undefined}
      className={previewClassName}
      data-slot="files-lsp-definition-preview"
    >
      {previewBody}
    </div>
  );
}

/** Multi-target list row — editor-styled, not app Button. */
export function DefinitionTargetRow({
  active,
  buttonRef,
  onActivate,
  onRequestPreview,
  target,
}: {
  active: boolean;
  buttonRef?: Ref<HTMLButtonElement>;
  onActivate(): void;
  onRequestPreview(): void;
  target: FilesLspPreparedDefinition;
}) {
  return (
    <button
      className={cn(
        "cm-lsp-definition-target flex w-full min-w-0 items-baseline gap-2 rounded-sm px-1.5 py-1 text-left text-xs outline-none",
        active && "cm-lsp-definition-target-active"
      )}
      onClick={onActivate}
      onFocus={onRequestPreview}
      onPointerEnter={onRequestPreview}
      ref={buttonRef}
      title={target.path}
      type="button"
    >
      <span className="min-w-0 flex-1 truncate">{basename(target.path)}</span>
      <span className="shrink-0 text-muted-foreground tabular-nums">
        {target.range.start.line + 1}
      </span>
    </button>
  );
}

export function SignatureBlock({
  signature,
}: {
  signature: FilesLspHoverCardModel["signatures"][number];
}) {
  const sanitizedHtml = useMemo(
    () =>
      signature.html === undefined
        ? undefined
        : sanitizeFilesLspHtml(signature.html),
    [signature.html]
  );
  if (sanitizedHtml !== undefined) {
    return (
      <div
        className="cm-lsp-hover-signature cm-lsp-documentation"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitizeFilesLspHtml at final sink.
        dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
        data-slot="files-lsp-hover-signature"
      />
    );
  }
  return (
    <pre
      className="cm-lsp-hover-signature"
      data-slot="files-lsp-hover-signature"
    >
      <code>{signature.value}</code>
    </pre>
  );
}

export function DocumentationSurface({
  model,
}: {
  model: FilesLspHoverCardModel;
}) {
  return (
    <div
      className="flex min-w-0 flex-col gap-0"
      data-slot="files-lsp-hover-docs"
    >
      {model.signatures.map((signature) => (
        <SignatureBlock
          key={`${signature.language}:${signature.value}`}
          signature={signature}
        />
      ))}
      {model.documentation.map((documentation) => (
        <DocumentationBlock
          documentation={documentation}
          key={`${documentation.kind}:${documentation.value}`}
        />
      ))}
      {model.contentTruncated ? (
        <p className="text-muted-foreground text-xs">
          {model.labels.contentTruncated}
        </p>
      ) : null}
    </div>
  );
}

/** Single definition: path header + code preview only (VS Code Ctrl+Hover). */
export function SingleDefinitionSurface({
  firstActionRef,
  model,
  onActivateDefinition,
}: {
  firstActionRef: Ref<HTMLButtonElement>;
  model: FilesLspHoverCardModel;
  onActivateDefinition(target: FilesLspPreparedDefinition): void;
}) {
  const target = model.activePreviewTarget ?? model.definitions[0] ?? null;
  if (!target) {
    return null;
  }
  return (
    <div
      className="flex min-w-0 flex-col gap-1"
      data-slot="files-lsp-hover-definitions"
    >
      <button
        className="cm-lsp-definition-location flex w-full min-w-0 items-baseline gap-1 truncate px-1 text-left text-muted-foreground text-xs outline-none hover:text-foreground"
        onClick={() => onActivateDefinition(target)}
        ref={firstActionRef}
        title={target.path}
        type="button"
      >
        {locationLabel(target)}
      </button>
      <DefinitionPreview
        labels={model.labels}
        onActivate={() => onActivateDefinition(target)}
        target={target}
      />
    </div>
  );
}

/** Multi definition: compact list + preview. */
export function MultiDefinitionSurface({
  firstActionRef,
  layout,
  model,
  onActivateDefinition,
  onRequestPreview,
}: {
  firstActionRef: Ref<HTMLButtonElement>;
  layout: "split" | "stack";
  model: FilesLspHoverCardModel;
  onActivateDefinition(target: FilesLspPreparedDefinition): void;
  onRequestPreview?(target: FilesLspPreparedDefinition): void;
}) {
  const active = model.activePreviewTarget;
  return (
    <div
      className={cn(
        "grid min-w-0 gap-2",
        layout === "split" && "grid-cols-[minmax(8rem,11rem)_minmax(0,1fr)]"
      )}
      data-layout={layout}
      data-slot="files-lsp-hover-definitions"
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        {model.definitions.map((target, index) => {
          const isActive =
            active !== null &&
            active.uri === target.uri &&
            active.range.start.line === target.range.start.line &&
            active.range.start.character === target.range.start.character;
          return (
            <DefinitionTargetRow
              active={isActive}
              {...(index === 0 ? { buttonRef: firstActionRef } : {})}
              key={`${target.uri}:${target.range.start.line}:${target.range.start.character}`}
              onActivate={() => onActivateDefinition(target)}
              onRequestPreview={() => onRequestPreview?.(target)}
              target={target}
            />
          );
        })}
      </div>
      {active ? (
        <DefinitionPreview
          labels={model.labels}
          onActivate={() => onActivateDefinition(active)}
          target={active}
        />
      ) : null}
    </div>
  );
}

export function HoverBody({
  firstActionRef,
  layout,
  model,
  onActivateDefinition,
  onRequestPreview,
}: {
  firstActionRef: Ref<HTMLButtonElement>;
  layout: "split" | "stack";
  model: FilesLspHoverCardModel;
  onActivateDefinition(target: FilesLspPreparedDefinition): void;
  onRequestPreview?(target: FilesLspPreparedDefinition): void;
}) {
  const hasInformation =
    model.documentation.length > 0 ||
    model.signatures.length > 0 ||
    model.definitions.length > 0;

  const definitionCount = model.definitions.length;
  // Definition-only mouse mode is code preview; docs belong to documentation/symbol.
  const showDocs = model.mode === "documentation" || model.mode === "symbol";

  return (
    <>
      {showDocs ? <DocumentationSurface model={model} /> : null}
      {definitionCount === 1 ? (
        <SingleDefinitionSurface
          firstActionRef={firstActionRef}
          model={model}
          onActivateDefinition={onActivateDefinition}
        />
      ) : null}
      {definitionCount > 1 ? (
        <MultiDefinitionSurface
          firstActionRef={firstActionRef}
          layout={layout}
          model={model}
          onActivateDefinition={onActivateDefinition}
          {...(onRequestPreview ? { onRequestPreview } : {})}
        />
      ) : null}
      {model.definitionsTruncated ? (
        <p className="text-muted-foreground text-xs">
          {model.labels.definitionsTruncated} ({model.definitionsShown}/
          {model.definitionsTotal})
        </p>
      ) : null}
      {hasInformation ? null : (
        <p>
          {model.error ? model.labels.unavailable : model.labels.noInformation}
        </p>
      )}
      {model.error && hasInformation ? (
        <p className="text-muted-foreground text-xs">
          {model.labels.unavailable}
        </p>
      ) : null}
    </>
  );
}

export function a11yTitle(model: FilesLspHoverCardModel): string {
  if (model.mode === "documentation") {
    return model.labels.documentationTitle;
  }
  if (model.mode === "definition") {
    if (model.definitionsTotal > 1) {
      return `${model.labels.definitionsTitle} (${model.definitionsTotal})`;
    }
    const only = model.definitions[0];
    return only ? locationLabel(only) : model.labels.definitionsTitle;
  }
  return model.labels.symbolTitle;
}
