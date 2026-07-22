import { Alert, AlertDescription } from "@pier/ui/alert.tsx";
import { Skeleton } from "@pier/ui/skeleton.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { useEffect, useRef, useState } from "react";
import { MarkdownMediaFullscreenButton } from "./markdown-media-fullscreen-button.tsx";

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
    const markup = bakeMermaidSvgForStandalonePreview(liveSvg);
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
        <MarkdownMediaFullscreenButton
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
  for (const forbidden of svg.querySelectorAll(
    "script, foreignObject, iframe, object, embed"
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

/**
 * data: image/svg+xml previews are a separate document — host CSS variables do
 * not resolve, so nodes fill black and strokes vanish. Bake theme tokens from
 * the live document onto a clone before encoding.
 */
export function bakeMermaidSvgForStandalonePreview(svg: SVGElement): string {
  const root = getComputedStyle(document.documentElement);
  const token = (name: string): string => root.getPropertyValue(name).trim();
  const bg = token("--background");
  const fg = token("--foreground");
  const muted = token("--muted-foreground");
  if (!(bg && fg)) {
    return new XMLSerializer().serializeToString(svg);
  }
  const clone = svg.cloneNode(true) as SVGElement;
  const line = `color-mix(in srgb, ${fg} 45%, ${bg})`;
  const surface = `color-mix(in srgb, ${fg} 6%, ${bg})`;
  const border = `color-mix(in srgb, ${fg} 22%, ${bg})`;
  const baked = [
    `--bg:${bg}`,
    `--fg:${fg}`,
    `--background:${bg}`,
    `--foreground:${fg}`,
    `--line:${line}`,
    // Match connector stroke — host --accent is UI chrome, not edge color.
    `--accent:${line}`,
    `--muted:${muted || line}`,
    `--surface:${surface}`,
    `--border:${border}`,
  ].join(";");
  const existing = clone.getAttribute("style")?.trim() ?? "";
  clone.setAttribute("style", existing ? `${existing};${baked}` : baked);
  return new XMLSerializer().serializeToString(clone);
}
