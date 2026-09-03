import { MediaFullscreenButton } from "@pier/ui/image-preview/media-fullscreen-button.tsx";
import { Skeleton } from "@pier/ui/skeleton.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { ImageOff } from "lucide-react";
import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useEffect,
  useState,
} from "react";
import type { MarkdownInline } from "./ir.ts";

export interface MarkdownInternalTarget {
  fragment?: string;
  path: string;
}

export interface MarkdownFileResources {
  contentPreview?: Pick<
    RendererPluginContext["contentPreview"],
    "openImage" | "openMermaid"
  >;
  filePreviews: Pick<
    RendererPluginContext["filePreviews"],
    "issue" | "release"
  >;
  files: Pick<RendererPluginContext["files"], "readDocument">;
  notifications?: Pick<RendererPluginContext["notifications"], "error">;
}

export interface MarkdownDiskSource {
  kind: "disk";
  path: string;
  root: string;
}

interface ResolvedRelativeResource {
  fragment?: string;
  path: string;
}

const ABSOLUTE_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:/u;
const ASCII_WHITESPACE_MAX_CODE = 0x20;

export type MarkdownUrlClassification =
  | { href: string; kind: "https" }
  | { href: string; kind: "relative" }
  | { href: string; kind: "hash" }
  | { href: ""; kind: "unsafe" };

export function compactMarkdownUrl(value: string): string {
  let compacted = "";
  for (const char of value) {
    if (char.charCodeAt(0) > ASCII_WHITESPACE_MAX_CODE && !/\s/u.test(char)) {
      compacted += char;
    }
  }
  return compacted;
}

export function classifyMarkdownUrl(
  value: string | null | undefined
): MarkdownUrlClassification {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return { href: "", kind: "unsafe" };
  const compact = compactMarkdownUrl(trimmed);
  if (!compact || compact.startsWith("//")) {
    return { href: "", kind: "unsafe" };
  }
  if (ABSOLUTE_SCHEME_PATTERN.test(compact)) {
    try {
      const parsed = new URL(compact);
      if (parsed.protocol === "https:" && parsed.hostname) {
        return { href: compact, kind: "https" };
      }
    } catch {
      return { href: "", kind: "unsafe" };
    }
    return { href: "", kind: "unsafe" };
  }
  if (trimmed.startsWith("#")) {
    return { href: trimmed, kind: "hash" };
  }
  return { href: trimmed, kind: "relative" };
}

export function safeMarkdownUrl(value: string | null | undefined): string {
  const classified = classifyMarkdownUrl(value);
  return classified.kind === "unsafe" ? "" : classified.href;
}

export function resolveRelativeMarkdownResource(
  sourcePath: string,
  value: string
): ResolvedRelativeResource | null {
  const classified = classifyMarkdownUrl(value);
  if (classified.kind !== "relative") return null;
  const trimmed = classified.href;
  const hashIndex = trimmed.indexOf("#");
  const beforeHash = hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed;
  const fragmentValue = hashIndex >= 0 ? trimmed.slice(hashIndex + 1) : "";
  const queryIndex = beforeHash.indexOf("?");
  const encodedPath =
    queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash;
  let decodedPath: string;
  let fragment: string | undefined;
  try {
    decodedPath = decodeURIComponent(encodedPath);
    fragment = fragmentValue ? decodeURIComponent(fragmentValue) : undefined;
  } catch {
    return null;
  }
  if (decodedPath.includes("\\") || decodedPath.includes("\0")) return null;

  const segments = decodedPath.startsWith("/")
    ? []
    : sourcePath.split("/").slice(0, -1).filter(Boolean);
  for (const segment of decodedPath.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  const path = segments.join("/");
  if (!path) return fragment ? { fragment, path: sourcePath } : null;
  return fragment ? { fragment, path } : { path };
}

export function MarkdownResourceLink({
  children,
  inline,
  onOpenAnchor,
  onOpenExternal,
  onOpenInternal,
  source,
}: {
  children: ReactNode;
  inline: Extract<MarkdownInline, { kind: "link" }>;
  onOpenAnchor(anchor: string): void;
  onOpenExternal(url: string): void;
  onOpenInternal: ((target: MarkdownInternalTarget) => void) | undefined;
  source: MarkdownDiskSource | undefined;
}) {
  const classified = classifyMarkdownUrl(inline.url);
  const externalUrl = classified.kind === "https" ? classified.href : "";
  const relative =
    classified.kind === "relative" && source
      ? resolveRelativeMarkdownResource(source.path, classified.href)
      : null;
  const anchor = classified.kind === "hash" ? classified.href.slice(1) : null;
  const actionable = Boolean(
    externalUrl || anchor !== null || (relative && onOpenInternal)
  );
  const href = actionable ? classified.href : undefined;
  const activate = () => {
    if (externalUrl) {
      onOpenExternal(externalUrl);
      return;
    }
    if (anchor !== null) {
      onOpenAnchor(anchor);
      return;
    }
    if (relative) onOpenInternal?.(relative);
  };
  const onClick = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    if (actionable) activate();
  };
  const onAuxClick = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 1) return;
    event.preventDefault();
    if (actionable) activate();
  };
  return (
    <a
      aria-disabled={actionable ? undefined : "true"}
      className="md-link"
      href={href}
      onAuxClick={onAuxClick}
      onClick={onClick}
      title={inline.title ?? undefined}
    >
      {children}
    </a>
  );
}

export function MarkdownResourceImage({
  imagePreviewTitle,
  inline,
  openFullscreenLabel,
  resources,
  source,
}: {
  imagePreviewTitle: string;
  inline: Extract<MarkdownInline, { kind: "image" }>;
  openFullscreenLabel: string;
  resources: MarkdownFileResources | undefined;
  source: MarkdownDiskSource | undefined;
}) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error" }
    | { status: "ready"; url: string }
  >({ status: "loading" });
  const targetPath = source
    ? (resolveRelativeMarkdownResource(source.path, inline.url)?.path ?? null)
    : null;

  useEffect(() => {
    let active = true;
    let issuedTicket: string | null = null;
    if (!(resources && source && targetPath)) {
      setState({ status: "error" });
      return;
    }
    resources.files
      .readDocument({ path: targetPath, root: source.root })
      .then(async (document) => {
        if (document.kind !== "image") throw new Error("not an image resource");
        const issued = await resources.filePreviews.issue({
          mime: document.mime,
          path: targetPath,
          revision: document.revision,
          root: source.root,
        });
        if (!issued.issued) throw new Error("image preview unavailable");
        issuedTicket = issued.ticket;
        if (!active) {
          await resources.filePreviews.release(issued.ticket);
          return;
        }
        setState({ status: "ready", url: issued.url });
      })
      .catch(() => {
        if (active) setState({ status: "error" });
      });
    return () => {
      active = false;
      if (issuedTicket) {
        // Lifecycle cleanup is not a user-triggered action; there is no UI feedback to emit.
        resources.filePreviews.release(issuedTicket).catch(() => undefined);
      }
    };
  }, [resources, source, targetPath]);

  if (state.status === "loading") {
    return (
      <Skeleton
        aria-label={inline.alt}
        className="md-img-figure h-28 w-full rounded-md"
      />
    );
  }
  if (state.status === "error") {
    return (
      <span className="md-img-fallback">
        <ImageOff aria-hidden="true" />
        {inline.alt}
      </span>
    );
  }
  const caption = inline.title?.trim() ?? "";
  const contentPreview = resources?.contentPreview;
  const canPreview = Boolean(contentPreview);
  const openPreview = () => {
    if (!contentPreview) {
      return;
    }
    contentPreview.openImage({
      alt: inline.alt,
      source: { kind: "url", src: state.url },
      title: inline.title?.trim() || inline.alt || imagePreviewTitle,
    });
  };
  return (
    <figure className="md-img-figure">
      <div className="group relative w-fit max-w-full">
        <img
          alt={inline.alt}
          className="md-img"
          crossOrigin="anonymous"
          height={360}
          src={state.url}
          title={inline.title ?? undefined}
          width={640}
        />
        {canPreview ? (
          <MediaFullscreenButton
            label={openFullscreenLabel}
            onClick={openPreview}
          />
        ) : null}
      </div>
      {caption ? (
        <figcaption className="md-img-caption">{caption}</figcaption>
      ) : null}
    </figure>
  );
}
