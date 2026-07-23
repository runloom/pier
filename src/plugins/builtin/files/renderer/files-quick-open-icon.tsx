/**
 * Cmd+P quick-open icons — same `@pierre/trees` complete set as the file tree /
 * tab chrome (`PierFileIcon`).
 */
import { PierFileIcon } from "@pier/ui/file-icon.tsx";
import type { ComponentType } from "react";

const iconByFileName = new Map<
  string,
  ComponentType<{ className?: string; size?: number | string }>
>();

export function filesQuickOpenIcon(
  fileName: string
): ComponentType<{ className?: string; size?: number | string }> {
  const cached = iconByFileName.get(fileName);
  if (cached) {
    return cached;
  }

  function FilesQuickOpenIcon({
    className,
    size = 16,
  }: {
    className?: string;
    size?: number | string;
  }) {
    return (
      <PierFileIcon
        aria-hidden="true"
        className={className}
        fileName={fileName}
        size={typeof size === "number" ? size : 16}
      />
    );
  }

  iconByFileName.set(fileName, FilesQuickOpenIcon);
  return FilesQuickOpenIcon;
}
