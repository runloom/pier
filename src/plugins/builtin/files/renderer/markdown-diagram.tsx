import { Alert, AlertDescription } from "@pier/ui/alert.tsx";
import { Skeleton } from "@pier/ui/skeleton.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { useEffect, useRef, useState } from "react";

export function MarkdownDiagram({
  charts,
  errorLabel,
  label,
  source,
}: {
  charts: RendererPluginContext["charts"];
  errorLabel: string;
  label: string;
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

  if (state.status === "loading") {
    return <Skeleton className="my-4 h-48 w-full rounded-md" />;
  }
  if (state.status === "error") {
    return (
      <Alert className="my-4" variant="destructive">
        <AlertDescription>{errorLabel}</AlertDescription>
      </Alert>
    );
  }
  return (
    <div
      aria-label={label}
      className="my-4 overflow-auto rounded-md border p-3 [&>svg]:mx-auto [&>svg]:h-auto [&>svg]:max-w-full"
      data-slot="markdown-diagram"
      ref={rootRef}
      role="img"
    />
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
