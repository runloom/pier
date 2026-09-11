import { type CSSProperties, createElement, useId } from "react";
import iconData from "./icons.json" with { type: "json" };

export type GlyphName = keyof typeof iconData.glyphs;
export type BrandGlyphName = keyof typeof iconData.brands;

interface IconProps {
  className?: string;
  "data-icon"?: "inline-start" | "inline-end";
  size?: number;
  style?: CSSProperties;
}

export interface GlyphProps extends IconProps {
  name: GlyphName;
}

export interface BrandGlyphProps extends IconProps {
  name: BrandGlyphName;
}

export function Glyph({
  className,
  name,
  size = 16,
  style,
  "data-icon": placement = "inline-start",
}: GlyphProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      data-icon={placement}
      fill="none"
      focusable="false"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      style={{ display: "block", flexShrink: 0, ...style }}
      viewBox="0 0 24 24"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      {iconData.glyphs[name].map(({ tag, key, attributes }) =>
        createElement(tag, { ...attributes, key })
      )}
    </svg>
  );
}

export function BrandGlyph({
  className,
  name,
  size = 16,
  style,
  "data-icon": placement = "inline-start",
}: BrandGlyphProps) {
  const gradientId = `sidebar-gemini-${useId().replaceAll(":", "")}`;
  const brand = iconData.brands[name];
  return (
    <svg
      aria-hidden="true"
      className={className}
      data-icon={placement}
      focusable="false"
      height={size}
      style={{ display: "block", flexShrink: 0, ...style }}
      viewBox={brand.viewBox}
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      {name === "gemini" ? (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" x2="1" y1="0" y2="1">
              {iconData.brands.gemini.stops.map(({ color, offset }) => (
                <stop key={offset} offset={offset} stopColor={color} />
              ))}
            </linearGradient>
          </defs>
          <path d={brand.path} fill={`url(#${gradientId})`} />
        </>
      ) : (
        <path
          d={brand.path}
          fill={iconData.brands[name].fill}
          fillRule={name === "codex" ? "evenodd" : "nonzero"}
        />
      )}
    </svg>
  );
}
