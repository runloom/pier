import { Artboard, ArtboardStage, Stack } from "pier/canvas";
import type { ReactNode } from "react";
import { PHONE_H, PHONE_W } from "./chrome.tsx";
import { ScreenH0, ScreenH1, ScreenH2, ScreenQR } from "./host-screens.tsx";
import type { Wireframe } from "./model.ts";
import { ScreenN1, ScreenS1, ScreenS2, ScreenS3 } from "./session-screens.tsx";

const SCREENS: Record<string, () => ReactNode> = {
  QR: ScreenQR,
  H0: ScreenH0,
  H1: ScreenH1,
  H2: ScreenH2,
  N1: ScreenN1,
  S1: ScreenS1,
  S2: ScreenS2,
  S3: ScreenS3,
};

export function WireframeStage({ frames }: { frames: readonly Wireframe[] }) {
  return (
    <ArtboardStage
      expandLabel="全屏查看线框"
      gap={48}
      padding={40}
      title="先主机、后投影"
      worldWidth={2480}
    >
      {frames.map((frame) => {
        const Screen = SCREENS[frame.id];
        return (
          <Artboard
            description={frame.description}
            height={frame.height ?? PHONE_H}
            key={frame.id}
            label={frame.id}
            title={frame.title}
            width={frame.width ?? PHONE_W}
          >
            <Stack className="h-full bg-background text-foreground" gap={0}>
              {Screen ? <Screen /> : null}
            </Stack>
          </Artboard>
        );
      })}
    </ArtboardStage>
  );
}
