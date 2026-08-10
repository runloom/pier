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
 * Docs shell: sticky left chapter nav + main article (inline flex layout).
 * Prefer this over hand-rolled two-column grids for user manuals.
 */
export const DocsShell: (props: DocsShellProps) => ReactNode;
export const Text: (props: TextProps) => ReactNode;
