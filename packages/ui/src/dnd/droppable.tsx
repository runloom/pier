"use client";

import { createContext, type ReactNode, useContext, useEffect } from "react";
import { cn } from "../utils.ts";
import { registerDroppable } from "./session.ts";

const DroppableContext = createContext<string | null>(null);

export function useDroppableId(): string | null {
  return useContext(DroppableContext);
}

export function Droppable({
  children,
  className,
  id,
  onDrop,
}: {
  children?: ReactNode;
  className?: string | undefined;
  id: string;
  /**
   * Plain drop target (no insertion index). A nested `Sortable` with
   * `onDropItem` takes precedence and receives the index instead.
   */
  onDrop?: ((itemId: string) => void) | undefined;
}) {
  useEffect(() => {
    if (!onDrop) {
      return;
    }
    return registerDroppable(id, onDrop);
  }, [id, onDrop]);
  return (
    <DroppableContext.Provider value={id}>
      <div
        className={cn(
          "rounded-md data-[drop-over]:ring-1 data-[drop-over]:ring-ring/40",
          className
        )}
        data-droppable-id={id}
        data-slot="canvas-droppable"
      >
        {children}
      </div>
    </DroppableContext.Provider>
  );
}
