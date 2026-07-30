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
export const Text: (props: TextProps) => ReactNode;
