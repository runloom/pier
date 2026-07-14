import { Skeleton } from "@pier/ui/skeleton.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { ImageOff } from "lucide-react";
import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useEffect,
  useState,
} from "react";
import type { MarkdownInline } from "./markdown/markdown-ir.ts";

export interface MarkdownInternalTarget {
  fragment?: string;
  path: string;
}

export interface MarkdownFileResources {
  filePreviews: Pick<
    RendererPluginContext["filePreviews"],
    "issue" | "release"
  >;
  files: Pick<RendererPluginContext["files"], "readDocument">;
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

export function safeMarkdownUrl(value: string | null | undefined): string {
  const trimmedValue = value?.trim();
  if (!trimmedValue) return "";
  if (!ABSOLUTE_SCHEME_PATTERN.test(trimmedValue)) return trimmedValue;
  try {
    const parsed = new URL(trimmedValue);
    return parsed.protocol === "https:" && parsed.hostname ? trimmedValue : "";
  } catch {
    return "";
  }
}

export function resolveRelativeMarkdownResource(
  sourcePath: string,
  value: string
): ResolvedRelativeResource | null {
  const trimmed = value.trim();
  if (
    !trimmed ||
    ABSOLUTE_SCHEME_PATTERN.test(trimmed) ||
    trimmed.startsWith("//")
  ) {
    return null;
  }
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
  const externalUrl = ABSOLUTE_SCHEME_PATTERN.test(inline.url)
    ? safeMarkdownUrl(inline.url)
    : "";
  const relative = source
    ? resolveRelativeMarkdownResource(source.path, inline.url)
    : null;
  const anchor = inline.url.startsWith("#") ? inline.url.slice(1) : null;
  const actionable = Boolean(
    externalUrl || anchor !== null || (relative && onOpenInternal)
  );
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
      href={actionable ? inline.url : undefined}
      onAuxClick={onAuxClick}
      onClick={onClick}
      title={inline.title ?? undefined}
    >
      {children}
    </a>
  );
}

export function MarkdownResourceImage({
  inline,
  resources,
  source,
}: {
  inline: Extract<MarkdownInline, { kind: "image" }>;
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
        className="my-3 h-28 w-full rounded-md"
      />
    );
  }
  if (state.status === "error") {
    return (
      <span className="my-3 inline-flex items-center gap-2 text-muted-foreground">
        <ImageOff aria-hidden="true" />
        {inline.alt}
      </span>
    );
  }
  return (
    <img
      alt={inline.alt}
      className="my-3 h-auto max-w-full rounded-md"
      height={360}
      src={state.url}
      title={inline.title ?? undefined}
      width={640}
    />
  );
}
