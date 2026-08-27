import { Artboard, Text, WorldStage } from "pier/canvas";

export const canvas = {
  description: "World-stage smoke — board shell (zoom/pan), not a template.",
  kind: "composition" as const,
  title: "World stage smoke",
};

/**
 * World-stage smoke: the files preview must switch to the board shell
 * (viewport lock + zoom/pan controls) when this root primitive mounts.
 */
export default function WorldSmoke() {
  return (
    <WorldStage>
      <Artboard
        description="Board shell smoke."
        height={360}
        label="W1"
        title="Hello world stage"
        width={560}
      >
        <Text className="p-6">
          Pan with the wheel or drag the background; zoom with pinch, Ctrl+wheel, or the controls.
        </Text>
      </Artboard>
      <Artboard height={360} label="W2" title="Second board" width={560}>
        <Text className="p-6">Drag to pan when zoomed in.</Text>
      </Artboard>
    </WorldStage>
  );
}
