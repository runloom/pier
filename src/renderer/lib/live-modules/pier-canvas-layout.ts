/**
 * Host layout primitives for `pier/canvas` (Frame / Stack / Row / Text / DocsShell).
 * Kept separate from the export barrel so the barrel stays under file-size caps.
 */
import { Button } from "@pier/ui/button.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pier/ui/select.tsx";
import { Separator } from "@pier/ui/separator.tsx";
import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { createElement } from "react";

type TextTone = "default" | "secondary" | "tertiary";

const TEXT_TONE_COLOR: Record<TextTone, string> = {
  default: "var(--foreground)",
  secondary: "var(--muted-foreground)",
  tertiary: "var(--muted-foreground)",
};

type TextAs = "p" | "span" | "div" | "h1" | "h2" | "h3";

const TEXT_AS_STYLE: Record<TextAs, CSSProperties> = {
  h1: {
    fontSize: 28,
    fontWeight: 600,
    letterSpacing: "-0.025em",
    lineHeight: 1.2,
    margin: 0,
  },
  h2: {
    fontSize: 20,
    fontWeight: 600,
    letterSpacing: "-0.015em",
    lineHeight: 1.3,
    margin: 0,
  },
  h3: {
    fontSize: 15,
    fontWeight: 600,
    lineHeight: 1.35,
    margin: 0,
  },
  p: {
    fontSize: 13,
    fontWeight: 400,
    lineHeight: 1.6,
    margin: 0,
  },
  span: {
    fontSize: 13,
    fontWeight: 400,
    lineHeight: 1.5,
  },
  div: {
    fontSize: 13,
    fontWeight: 400,
    lineHeight: 1.6,
  },
};

export function Stack({
  children,
  className,
  fill = false,
  gap = 16,
}: {
  children?: ReactNode;
  className?: string;
  /** Full-bleed flow root: drops the shell measure so this canvas owns scroll. */
  fill?: boolean;
  gap?: string | number;
}) {
  return createElement(
    "div",
    {
      className,
      "data-slot": "stack",
      ...(fill ? { "data-canvas-fill": "" } : {}),
      style: {
        display: "flex",
        flexDirection: "column",
        gap: typeof gap === "number" ? `${gap}px` : gap,
        width: "100%",
        minWidth: 0,
        ...(fill ? { height: "100%", minHeight: 0 } : {}),
      },
    },
    children
  );
}

export function Row({
  children,
  className,
  gap = 8,
  align = "center",
  justify = "flex-start",
  wrap = true,
}: {
  align?: CSSProperties["alignItems"];
  children?: ReactNode;
  className?: string;
  gap?: string | number;
  justify?: CSSProperties["justifyContent"];
  wrap?: boolean;
}) {
  return createElement(
    "div",
    {
      className,
      "data-slot": "row",
      style: {
        alignItems: align,
        display: "flex",
        flexWrap: wrap ? "wrap" : "nowrap",
        gap: typeof gap === "number" ? `${gap}px` : gap,
        justifyContent: justify,
        minWidth: 0,
        width: "100%",
      },
    },
    children
  );
}

/** Reading column (max-width). Product mockups use Artboard, not Frame. */
export function Frame({
  children,
  className,
  maxWidth = 880,
}: {
  children?: ReactNode;
  className?: string;
  maxWidth?: number;
}) {
  return createElement(
    "div",
    {
      className,
      "data-slot": "frame",
      style: {
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: 24,
        marginInline: "auto",
        maxWidth,
        minWidth: 0,
        paddingBlock: 8,
        width: "100%",
      },
    },
    children
  );
}

export interface DocsShellNavItem {
  id: string;
  label: string;
}

/**
 * Docs reading shell: optional header + sticky left nav + main article.
 * Column layout uses inline flex so two-pane docs do not depend on
 * canvas-only arbitrary Tailwind grid classes.
 *
 * Header + main mark `data-reading-surface` so host CSS applies the Appearance
 * **document font** to prose. Interactive product controls under that surface
 * are reset to the **UI font** (see globals.css) so live Button/Input demos
 * stay product-true. Nav chrome is outside the reading surface.
 */
export function DocsShell({
  children,
  className,
  header,
  maxWidth,
  nav,
  navId,
  navLabel = "Contents",
  navWidth = 160,
  onNavChange,
}: {
  children?: ReactNode;
  className?: string;
  header?: ReactNode;
  /**
   * Optional inner cap. Omit so the files preview shell owns the measure
   * (comfortable `max-w-5xl` / wide full bleed).
   */
  maxWidth?: number;
  nav: DocsShellNavItem[];
  navId: string;
  navLabel?: string;
  navWidth?: number;
  onNavChange: (id: string) => void;
}) {
  const activeLabel = nav.find((item) => item.id === navId)?.label ?? navLabel;

  return createElement(
    "div",
    {
      className,
      "data-canvas-docs": "",
      "data-slot": "docs-shell",
      style: {
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: 24,
        minWidth: 0,
        paddingBlock: 8,
        width: "100%",
        ...(maxWidth === undefined ? {} : { maxWidth }),
      },
    },
    createElement(
      Stack,
      { gap: 16 },
      header
        ? createElement(
            "div",
            {
              "data-reading-surface": "",
            },
            header
          )
        : null,
      header ? createElement(Separator) : null,
      createElement(
        "div",
        { className: "md:hidden" },
        createElement(
          Select,
          { value: navId, onValueChange: onNavChange },
          createElement(
            SelectTrigger,
            { "aria-label": navLabel, className: "w-full" },
            createElement(SelectValue, { placeholder: activeLabel })
          ),
          createElement(
            SelectContent,
            null,
            ...nav.map((item) =>
              createElement(
                SelectItem,
                { key: item.id, value: item.id },
                item.label
              )
            )
          )
        )
      ),
      createElement(
        "div",
        {
          style: {
            alignItems: "flex-start",
            display: "flex",
            gap: 40,
            minWidth: 0,
            width: "100%",
          },
        },
        createElement(
          "aside",
          {
            "aria-label": navLabel,
            className: "hidden md:block",
            role: "navigation",
            style: {
              alignSelf: "flex-start",
              flexShrink: 0,
              position: "sticky",
              top: 8,
              width: navWidth,
            },
          },
          createElement(
            Stack,
            { gap: 0.5 },
            ...nav.map((item) => {
              const active = navId === item.id;
              return createElement(
                Button,
                {
                  "aria-current": active ? "page" : undefined,
                  className:
                    "h-auto w-full justify-start px-2 py-1.5 text-left font-normal text-sm",
                  key: item.id,
                  type: "button",
                  variant: active ? "secondary" : "ghost",
                  onClick: () => onNavChange(item.id),
                },
                item.label
              );
            })
          )
        ),
        createElement(
          "main",
          {
            "data-reading-surface": "",
            style: {
              flex: 1,
              minWidth: 0,
            },
          },
          children
        )
      )
    )
  );
}

export type TextProps = {
  as?: TextAs;
  children?: ReactNode;
  className?: string;
  tone?: TextTone;
} & Omit<ComponentProps<"p">, "as" | "children" | "className" | "color">;

export function Text({
  children,
  className,
  as: Tag = "p",
  tone = "default",
  style,
  ...rest
}: TextProps) {
  const asStyle = TEXT_AS_STYLE[Tag];
  return createElement(
    Tag,
    {
      ...rest,
      className,
      style: {
        ...asStyle,
        color: TEXT_TONE_COLOR[tone],
        // `--md-scale` is only set on `[data-canvas-reading]`. Unset → 1,
        // so kanban / world Text does not inherit a docs zoom.
        fontSize: `calc(${asStyle.fontSize}px * var(--md-scale, 1))`,
        ...style,
      },
    },
    children
  );
}
