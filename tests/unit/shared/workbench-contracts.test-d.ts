import type {
  CoreWorkbenchWidgetDeclaration,
  WorkbenchGridSize,
} from "@shared/contracts/workbench.ts";
import { expectTypeOf } from "vitest";

expectTypeOf<CoreWorkbenchWidgetDeclaration>()
  .pick<"defaultSize" | "maxSize" | "minSize">()
  .toEqualTypeOf<{
    defaultSize: WorkbenchGridSize;
    maxSize: WorkbenchGridSize;
    minSize: WorkbenchGridSize;
  }>();
