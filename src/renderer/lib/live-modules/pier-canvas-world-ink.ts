/**
 * Artboard captions sit on the WorldStage floor, not inside the product
 * frame. Host `--foreground` follows the app chrome (near-white in dark
 * mode). A light `background` then paints white-on-beige captions.
 *
 * These vars are consumed only by Artboard chrome. Frame contents keep
 * host tokens so a dark mockup on a light floor stays dark.
 */
import type { CSSProperties } from "react";

export const WORLD_CAPTION_FG = "--pier-world-caption";
export const WORLD_CAPTION_MUTED = "--pier-world-caption-muted";

const LIGHT_FLOOR = { foreground: "#171717", muted: "#525252" } as const;
const DARK_FLOOR = { foreground: "#f5f5f5", muted: "#a3a3a3" } as const;
const LUMINANCE_CUTOFF = 0.4;

export function parseCssRgb(
  color: string
): { b: number; g: number; r: number } | null {
  const trimmed = color.trim();
  const hex = /^#([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.exec(trimmed);
  if (hex) {
    let body = hex[1] ?? "";
    if (body.length === 3 || body.length === 4) {
      body = [...body.slice(0, 3)].map((ch) => `${ch}${ch}`).join("");
    } else if (body.length === 8) {
      body = body.slice(0, 6);
    }
    const r = Number.parseInt(body.slice(0, 2), 16);
    const g = Number.parseInt(body.slice(2, 4), 16);
    const b = Number.parseInt(body.slice(4, 6), 16);
    if (![r, g, b].every((ch) => Number.isFinite(ch))) {
      return null;
    }
    return { b, g, r };
  }
  const rgb = /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[,/ ]\s*([\d.]+)/i.exec(
    trimmed
  );
  if (!rgb) {
    return null;
  }
  const r = Number(rgb[1]);
  const g = Number(rgb[2]);
  const b = Number(rgb[3]);
  if (![r, g, b].every((ch) => Number.isFinite(ch))) {
    return null;
  }
  return { b, g, r };
}

export function relativeLuminance(color: string): number | null {
  const rgb = parseCssRgb(color);
  if (!rgb) {
    return null;
  }
  const toLin = (channel: number) => {
    const s = Math.min(255, Math.max(0, channel)) / 255;
    return s <= 0.039_28 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * toLin(rgb.r) + 0.7152 * toLin(rgb.g) + 0.0722 * toLin(rgb.b);
}

export function worldStageCaptionVars(
  background: string | undefined
): CSSProperties | null {
  if (!background) {
    return null;
  }
  const luminance = relativeLuminance(background);
  if (luminance === null) {
    return null;
  }
  const ink = luminance > LUMINANCE_CUTOFF ? LIGHT_FLOOR : DARK_FLOOR;
  return {
    [WORLD_CAPTION_FG]: ink.foreground,
    [WORLD_CAPTION_MUTED]: ink.muted,
  } as CSSProperties;
}

export const WORLD_CAPTION_COLOR = `var(${WORLD_CAPTION_FG}, var(--foreground))`;
export const WORLD_CAPTION_MUTED_COLOR = `var(${WORLD_CAPTION_MUTED}, var(--muted-foreground))`;
