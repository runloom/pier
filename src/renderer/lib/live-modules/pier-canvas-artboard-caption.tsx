import type { CSSProperties, ReactNode } from "react";
import { Text } from "./pier-canvas-layout.ts";
import {
  WORLD_CAPTION_COLOR,
  WORLD_CAPTION_MUTED_COLOR,
} from "./pier-canvas-world-ink.ts";

const TITLE_INK: CSSProperties = { color: WORLD_CAPTION_COLOR };
const MUTED_INK: CSSProperties = {
  color: WORLD_CAPTION_MUTED_COLOR,
  fontSize: 12,
  fontWeight: 400,
  lineHeight: 1.5,
};

export function ArtboardCaption(props: {
  description?: string | undefined;
  heading: string;
  label?: string | undefined;
  title?: string | undefined;
}): ReactNode {
  const heading =
    props.label && props.title ? (
      <div
        style={{
          alignItems: "baseline",
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          minWidth: 0,
        }}
      >
        <Text
          as="span"
          style={{
            ...MUTED_INK,
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            fontWeight: 500,
            letterSpacing: "0.04em",
          }}
        >
          {props.label}
        </Text>
        <Text as="h3" style={TITLE_INK}>
          {props.title}
        </Text>
      </div>
    ) : (
      <Text as="h3" style={TITLE_INK}>
        {props.heading}
      </Text>
    );

  return (
    <div
      data-slot="artboard-caption"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        maxWidth: 720,
        minWidth: 0,
      }}
    >
      {heading}
      {props.description ? (
        <Text as="p" style={MUTED_INK}>
          {props.description}
        </Text>
      ) : null}
    </div>
  );
}
