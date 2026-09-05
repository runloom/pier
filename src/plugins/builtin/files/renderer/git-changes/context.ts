import { createContext, useContext } from "react";
import type { FileChangesSnapshot } from "./types.ts";

export interface FileChangeSurfaceValue {
  openRange: (id: string) => void;
  snapshot: FileChangesSnapshot;
}
export const FileChangeSurfaceContext =
  createContext<FileChangeSurfaceValue | null>(null);
export function useFileChangeSurface() {
  return useContext(FileChangeSurfaceContext);
}
