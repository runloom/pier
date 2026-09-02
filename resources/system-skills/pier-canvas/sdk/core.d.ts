import type { ComponentProps, CSSProperties, ReactNode } from "react";

export interface StackProps {
  children?: ReactNode;
  className?: string;
  /** Full-bleed flow root (`data-canvas-fill`). The shell drops the reading measure. */
  fill?: boolean;
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
   * preview only. Explicit value beats `preset`.
   */
  height?: number;
  /** Short id shown before the title, e.g. `K1`. */
  label?: string;
  /** `clip` (default) or `scroll` (prototype overflow only). */
  overflow?: "clip" | "scroll";
  /** Device size table. Explicit `width` / `height` still win. */
  preset?: ArtboardPreset;
  title?: string;
  /** Frame width in px. Default 1280. Frames do not shrink to the reading column. */
  width?: number;
}

export type ArtboardPreset = "desktop" | "laptop" | "phone" | "tablet";

export interface WorldStageProps {
  /**
   * CSS background of the world plane. Artboard captions contrast against
   * this floor; frame contents keep host theme tokens.
   */
  background?: string;
  children?: ReactNode;
  className?: string;
  /** Gap between flow children, in px. Default 56. */
  gap?: number;
  /**
   * World height floor. The plane also measures its `Layer` children and
   * grows to fit them, so omit this unless you want extra empty space.
   */
  height?: number;
  /** Stage padding, in px. Default 48. */
  padding?: number;
  /**
   * Wrap line width in px. Flow children default to the ArtboardStage
   * 3×desktop line so wrap actually happens. `Layer` children envelope from
   * the DOM — declared numbers are a floor, never a clip.
   */
  width?: number;
}

export interface LayerProps {
  children?: ReactNode;
  className?: string;
  /** Optional height in world pixels. */
  h?: number;
  /** Optional width in world pixels. */
  w?: number;
  /** Left offset in world pixels. */
  x: number;
  /** Top offset in world pixels. */
  y: number;
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
  /**
   * Optional inner cap. Omit so the files preview shell owns comfortable /
   * wide measure (`max-w-5xl` vs full bleed).
   */
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
 * Board-mode root. Mounting this as the canvas default export switches the
 * files preview to a viewport-locked zoom/pan shell.
 */
export const WorldStage: (props: WorldStageProps) => ReactNode;
/**
 * Absolute child of `WorldStage` (`x`/`y` world pixels).
 */
export const Layer: (props: LayerProps) => ReactNode;

export interface SortableItemApi {
  handle: ReactNode;
  isDragging: boolean;
}

export interface SortableProps {
  children: (itemId: string, item: SortableItemApi) => ReactNode;
  className?: string;
  handleLabel?: string;
  items: readonly string[];
  /**
   * A foreign item was dropped into this list at `index`. Enables the live
   * insertion gap. Cross-container moves fire only this callback — the
   * composition owns removal from the source (one write, no races).
   */
  onDropItem?: (itemId: string, index: number) => void;
  /** Same-list reorder commit (called once on drop). */
  onReorder: (items: string[]) => void;
  orientation?: "horizontal" | "vertical";
}

export interface DroppableProps {
  children?: ReactNode;
  className?: string;
  id: string;
  /**
   * Plain drop target (no insertion index). A nested `Sortable` with
   * `onDropItem` takes precedence and receives the index instead.
   */
  onDrop?: (itemId: string) => void;
}

/**
 * Reorder a list by dragging anywhere on the item (the handle stays as the
 * discoverable path). Drags show a floating ghost and a live insertion gap.
 */
export const Sortable: (props: SortableProps) => ReactNode;
/** Drop target for items dragged out of a `Sortable`. */
export const Droppable: (props: DroppableProps) => ReactNode;
/**
 * Docs shell: sticky left chapter nav + main article (inline flex layout).
 * Prefer this over hand-rolled two-column grids for user manuals.
 * Marks `data-canvas-docs` so the files preview applies Markdown reading prefs.
 */
export const DocsShell: (props: DocsShellProps) => ReactNode;
export const Text: (props: TextProps) => ReactNode;
