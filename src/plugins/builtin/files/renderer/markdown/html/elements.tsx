import { Kbd } from "@pier/ui/kbd.tsx";
import { cn } from "@pier/ui/utils.ts";
import { createElement, type ReactNode } from "react";
import type { MarkdownInline, MarkdownSourceRange } from "../ir.ts";
import { headingClassName } from "../ir-render-helpers.ts";
import {
  classifyMarkdownUrl,
  MarkdownResourceImage,
  MarkdownResourceLink,
} from "../resource-elements.tsx";
import {
  htmlAlignClass,
  isMarkdownHtmlHeadingTag,
  isMarkdownHtmlTag,
} from "./schema.ts";
import type { MarkdownHtmlRenderEnv } from "./types.ts";

const ZERO_RANGE: MarkdownSourceRange = {
  endLine: 1,
  endOffset: 0,
  startLine: 1,
  startOffset: 0,
};

export function createMarkdownHtmlElement(
  name: string,
  attrs: Readonly<Record<string, string>>,
  children: ReactNode[],
  env: MarkdownHtmlRenderEnv,
  insidePre = false
): ReactNode {
  const alignClass = htmlAlignClass(attrs.align);
  if (name === "a") {
    return (
      <MarkdownResourceLink
        inline={htmlLinkInline(attrs.href ?? "", attrs.title)}
        onOpenAnchor={env.onOpenAnchor}
        onOpenExternal={env.onOpenExternal}
        onOpenInternal={env.onOpenInternal}
        source={env.source}
      >
        {children}
      </MarkdownResourceLink>
    );
  }
  if (name === "img") {
    return createHtmlImage(attrs, env);
  }
  if (name === "br") {
    return <br />;
  }
  if (name === "hr") {
    return <hr className={cn("md-hr", alignClass)} />;
  }
  if (name === "kbd") {
    return <Kbd>{children}</Kbd>;
  }
  if (name === "table") {
    return (
      <div className="md-table-wrap">
        {createElement("table", { className: alignClass }, ...children)}
      </div>
    );
  }
  if (isMarkdownHtmlHeadingTag(name)) {
    const depth = Number(name.slice(1));
    return createElement(
      name,
      {
        className: cn(headingClassName(depth), alignClass),
        id: env.headingIds.shift(),
      },
      ...children
    );
  }
  if (name === "p") {
    return createElement(
      "p",
      { className: cn("md-p", alignClass) },
      ...children
    );
  }
  if (name === "ul") {
    return createElement(
      "ul",
      { className: cn("md-ul", alignClass) },
      ...children
    );
  }
  if (name === "ol") {
    return createElement(
      "ol",
      {
        className: cn("md-ol", alignClass),
        start: attrs.start ? Number(attrs.start) : undefined,
      },
      ...children
    );
  }
  if (name === "li") {
    return createElement(
      "li",
      { className: cn("md-li", alignClass) },
      ...children
    );
  }
  if (name === "blockquote") {
    return createElement(
      "blockquote",
      { className: cn("md-blockquote", alignClass) },
      ...children
    );
  }
  if (name === "pre") {
    return createElement(
      "pre",
      { className: cn("md-pre", alignClass) },
      ...children
    );
  }
  if (name === "code") {
    return createElement(
      "code",
      { className: cn(insidePre ? undefined : "md-inline-code", alignClass) },
      ...children
    );
  }
  if (name === "details") {
    return createElement(
      "details",
      { className: alignClass, open: Object.hasOwn(attrs, "open") },
      ...children
    );
  }
  if (!isMarkdownHtmlTag(name)) {
    return children;
  }
  return createElement(name, htmlElementProps(attrs, alignClass), ...children);
}

function htmlElementProps(
  attrs: Readonly<Record<string, string>>,
  alignClass: string | undefined
): Record<string, unknown> {
  const props: Record<string, unknown> = { className: alignClass };
  if (attrs.title) props.title = attrs.title;
  if (attrs.colspan) props.colSpan = Number(attrs.colspan);
  if (attrs.rowspan) props.rowSpan = Number(attrs.rowspan);
  if (attrs.width) props.width = Number(attrs.width);
  if (attrs.height) props.height = Number(attrs.height);
  return props;
}

function htmlLinkInline(
  url: string,
  title: string | undefined
): Extract<MarkdownInline, { kind: "link" }> {
  return {
    children: [],
    kind: "link",
    range: ZERO_RANGE,
    title: title ?? null,
    url,
  };
}

function createHtmlImage(
  attrs: Readonly<Record<string, string>>,
  env: MarkdownHtmlRenderEnv
): ReactNode {
  const src = attrs.src?.trim() ?? "";
  const alt = attrs.alt ?? "";
  const title = attrs.title ?? null;
  const classified = classifyMarkdownUrl(src);
  if (classified.kind !== "relative") {
    return alt ? <span className="md-img-fallback">{alt}</span> : null;
  }
  return (
    <MarkdownResourceImage
      imagePreviewFailedLabel={env.labels.imagePreviewFailed}
      imagePreviewTitle={env.labels.imagePreviewTitle}
      inline={{
        alt,
        kind: "image",
        range: ZERO_RANGE,
        title,
        url: classified.href,
      }}
      openFullscreenLabel={env.labels.openFullscreen}
      resources={env.fileResources}
      source={env.source}
    />
  );
}
