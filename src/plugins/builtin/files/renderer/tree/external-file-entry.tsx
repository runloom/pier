import type { FilesTranslate } from "../i18n.ts";
import { projectNameFromRoot } from "./preferences.ts";

/**
 * Pinned row above the tree for the active document when it lives outside the
 * panel's project root (VS Code ResourceNotInWorkspaceElement analogue). The
 * row is display-only: the doc is already the active tab, the content banner
 * owns the explanation.
 */
export function ExternalActiveFileEntry({
  externalActiveFile,
  t,
}: {
  externalActiveFile: { path: string; root: string };
  t: FilesTranslate;
}) {
  const absolutePath = `${externalActiveFile.root}/${externalActiveFile.path}`;
  const name =
    externalActiveFile.path.split("/").at(-1) ?? externalActiveFile.path;
  return (
    <div
      aria-label={t("filePanel.tree.externalFile", "Outside workspace")}
      className="border-border border-b px-3 py-2"
      data-testid="files-tree-external-file"
      role="note"
    >
      <div
        aria-current="true"
        className="flex items-center gap-2 rounded-md bg-accent px-2 py-1"
        title={absolutePath}
      >
        <span className="truncate font-medium text-foreground text-sm">
          {name}
        </span>
        <span className="ml-auto shrink-0 truncate text-muted-foreground text-xs">
          {projectNameFromRoot(externalActiveFile.root)}
        </span>
      </div>
    </div>
  );
}
