import type { ComponentProps, CSSProperties, ReactNode } from "react";

export interface StackProps {
  children?: ReactNode;
  className?: string;
  gap?: string | number;
}

export interface RowProps {
  align?: CSSProperties["alignItems"];
  children?: ReactNode;
  className?: string;
  gap?: string | number;
  justify?: CSSProperties["justifyContent"];
  wrap?: boolean;
}

export interface FrameProps {
  children?: ReactNode;
  className?: string;
  maxWidth?: number;
}

export interface ArtboardStageProps {
  children?: ReactNode;
  className?: string;
  /** Immersive fullscreen via host content preview. Default true. */
  expandable?: boolean;
  /** Fullscreen control label. Default `View fullscreen`. */
  expandLabel?: string;
  /** Gap between artboards, in px. Default 56. */
  gap?: number;
  /** Stage padding, in px. Default 48. */
  padding?: number;
  /** Accessible name and fullscreen title. Default `Artboard`. */
  title?: string;
  /** Fixed layout width of the world before zoom-to-fit. Default 3×1280. */
  worldWidth?: number;
}

export interface ArtboardProps {
  children?: ReactNode;
  className?: string;
  /** Spec / caption under the title, outside the frame. */
  description?: string;
  /**
   * Clip viewport height in px (Figma clip-content). Default 800. Inner
   * browser scrollbars are not canvas navigation — zoom/pan is fullscreen
   * preview only.
   */
  height?: number;
  /** Short id shown before the title, e.g. `K1`. */
  label?: string;
  /** `clip` (default) or `scroll` (prototype overflow only). */
  overflow?: "clip" | "scroll";
  title?: string;
  /** Frame width in px. Default 1280. Frames do not shrink to the reading column. */
  width?: number;
}

export interface DocsShellNavItem {
  id: string;
  label: string;
}

export interface DocsShellProps {
  children?: ReactNode;
  className?: string;
  /** Optional page header (title, search, badges) above the nav + article split. */
  header?: ReactNode;
  maxWidth?: number;
  nav: DocsShellNavItem[];
  navId: string;
  /** Accessible name for the nav region / mobile select. */
  navLabel?: string;
  navWidth?: number;
  onNavChange: (id: string) => void;
}

export type TextTone = "default" | "secondary" | "tertiary";

export type TextProps = {
  as?: "p" | "span" | "div" | "h1" | "h2" | "h3";
  children?: ReactNode;
  className?: string;
  tone?: TextTone;
} & Omit<ComponentProps<"p">, "as" | "children" | "className" | "color">;

export const Stack: (props: StackProps) => ReactNode;
export const Row: (props: RowProps) => ReactNode;
export const Frame: (props: FrameProps) => ReactNode;
/**
 * Fit-all overview card of `Artboard` children (same chrome as Mermaid).
 * Does not capture wheel / page scroll. Zoom/pan is fullscreen preview only.
 */
export const ArtboardStage: (props: ArtboardStageProps) => ReactNode;
/**
 * One product frame on the stage (Figma artboard). Width/height are CSS pixels
 * of the framed UI. Default 1280×800, clipped (no inner scrollbar).
 */
export const Artboard: (props: ArtboardProps) => ReactNode;
/**
 * Docs shell: sticky left chapter nav + main article (inline flex layout).
 * Prefer this over hand-rolled two-column grids for user manuals.
 */
export const DocsShell: (props: DocsShellProps) => ReactNode;
export const Text: (props: TextProps) => ReactNode;
