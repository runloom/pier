import { Alert, AlertDescription } from "@pier/ui/alert.tsx";
import { bakeSvgForStandalonePreview } from "@pier/ui/image-preview/bake-svg-for-standalone-preview.ts";
import { MediaFullscreenButton } from "@pier/ui/media-fullscreen-button.tsx";
import { Skeleton } from "@pier/ui/skeleton.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { useEffect, useRef, useState } from "react";

export function MarkdownDiagram({
  charts,
  contentPreview,
  errorLabel,
  label,
  openFullscreenLabel,
  previewTitle,
  source,
}: {
  charts: RendererPluginContext["charts"];
  contentPreview:
    | Pick<RendererPluginContext["contentPreview"], "openImage">
    | undefined;
  errorLabel: string;
  label: string;
  openFullscreenLabel: string;
  previewTitle: string;
  source: string;
}) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error" }
    | { status: "ready"; svg: string }
  >({ status: "loading" });
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    charts
      .renderMermaid(source)
      .then((result) => {
        if (!active) return;
        setState(
          result.ok ? { status: "ready", svg: result.svg } : { status: "error" }
        );
      })
      .catch(() => {
        if (active) setState({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, [charts, source]);

  useEffect(() => {
    const root = rootRef.current;
    if (!(root && state.status === "ready")) return;
    const svg = parseSafeSvg(state.svg);
    if (!svg) {
      setState({ status: "error" });
      return;
    }
    root.replaceChildren(svg);
    return () => root.replaceChildren();
  }, [state]);

  const openPreview = () => {
    if (!(contentPreview && state.status === "ready")) return;
    const liveSvg = rootRef.current?.querySelector("svg");
    if (!liveSvg) return;
    const markup = bakeSvgForStandalonePreview(liveSvg);
    const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
    contentPreview.openImage({
      alt: label,
      source: { kind: "url", src },
      title: previewTitle,
    });
  };

  if (state.status === "loading") {
    return <Skeleton className="h-48 w-full rounded-md" />;
  }
  if (state.status === "error") {
    return (
      <Alert variant="destructive">
        <AlertDescription>{errorLabel}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div
      className="group relative overflow-auto rounded-md border p-3"
      data-slot="markdown-diagram"
    >
      <div
        aria-label={label}
        className="[&>svg]:mx-auto [&>svg]:h-auto [&>svg]:max-w-full"
        ref={rootRef}
        role="img"
      />
      {contentPreview ? (
        <MediaFullscreenButton
          label={openFullscreenLabel}
          onClick={openPreview}
        />
      ) : null}
    </div>
  );
}

function parseSafeSvg(source: string): SVGElement | null {
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  const svg = document.documentElement;
  if (svg.localName !== "svg" || document.querySelector("parsererror"))
    return null;
  // Official Mermaid uses sanitized XHTML labels in foreignObject. The host
  // renderer already rejects active attributes and non-local URLs.
  for (const forbidden of svg.querySelectorAll(
    "script, iframe, object, embed"
  )) {
    forbidden.remove();
  }
  for (const element of [svg, ...svg.querySelectorAll("*")]) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on")) {
        element.removeAttribute(attribute.name);
      } else if (
        (name === "href" || name === "xlink:href") &&
        !attribute.value.startsWith("#")
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  return svg as unknown as SVGElement;
}

/** @deprecated Prefer `@pier/ui/image-preview/bake-svg-for-standalone-preview`. */
export {
  bakeMermaidSvgForStandalonePreview,
  bakeSvgForStandalonePreview,
} from "@pier/ui/image-preview/bake-svg-for-standalone-preview.ts";
