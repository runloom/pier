import type {
  CoreMissionControlWidgetDeclaration,
  MissionControlGridSize,
} from "@shared/contracts/mission-control.ts";
import { expectTypeOf } from "vitest";

expectTypeOf<CoreMissionControlWidgetDeclaration>()
  .pick<"defaultSize" | "maxSize" | "minSize">()
  .toEqualTypeOf<{
    defaultSize: MissionControlGridSize;
    maxSize: MissionControlGridSize;
    minSize: MissionControlGridSize;
  }>();
