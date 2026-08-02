/**
 * Content search panel result / empty / error body.
 */
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
import { ScrollArea } from "@pier/ui/scroll-area.tsx";
import type { FileContentQueryItem } from "@shared/contracts/file/query.ts";
import { CircleAlert, FolderSearch, Search } from "lucide-react";
import type { FilesTranslate } from "../i18n.ts";
import type { ContentQuerySnapshot } from "./client.ts";
import type { FilesContentSearchConditions } from "./params.ts";
import {
  FilesContentSearchFileGroup,
  type groupHitsByPath,
} from "./result-row.tsx";

export function SearchPanelBody(props: {
  activeIndex: number;
  conditions: FilesContentSearchConditions;
  groups: ReturnType<typeof groupHitsByPath>;
  onContextMenu?: (event: React.MouseEvent, hit: FileContentQueryItem) => void;
  onOpenHit: (hit: FileContentQueryItem) => void;
  onSetActiveIndex: (index: number) => void;
  snapshot: ContentQuerySnapshot;
  t: FilesTranslate;
}): React.JSX.Element {
  const {
    activeIndex,
    conditions,
    groups,
    onContextMenu,
    onOpenHit,
    onSetActiveIndex,
    snapshot,
    t,
  } = props;

  if (!conditions.root) {
    return (
      <Empty className="h-full border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FolderSearch />
          </EmptyMedia>
          <EmptyTitle>
            {t("filePanel.contentSearch.noProjectTitle", "No project open")}
          </EmptyTitle>
          <EmptyDescription>
            {t(
              "filePanel.contentSearch.noProject",
              "Open a project to search file contents."
            )}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (snapshot.status === "error") {
    let errorTitle = t("filePanel.contentSearch.failed", "Search failed");
    let errorBody = t(
      "filePanel.contentSearch.failedBody",
      "Try again, or check that search tools are installed."
    );
    if (snapshot.errorCode === "search-runtime-unavailable") {
      errorTitle = t(
        "filePanel.contentSearch.runtimeMissingTitle",
        "Search unavailable"
      );
      errorBody = t(
        "filePanel.contentSearch.runtimeMissing",
        "The built-in search engine is missing from this build."
      );
    } else if (snapshot.errorCode === "invalid-regexp") {
      errorTitle = t(
        "filePanel.contentSearch.invalidRegexpTitle",
        "Invalid regular expression"
      );
      errorBody =
        snapshot.errorMessage ??
        t(
          "filePanel.contentSearch.invalidRegexpBody",
          "Check the pattern, or turn off Regexp and search as plain text."
        );
    } else if (snapshot.errorCode === "invalid-scope") {
      errorTitle = t(
        "filePanel.contentSearch.invalidScopeTitle",
        "Folder not available"
      );
      errorBody =
        snapshot.errorMessage ??
        t(
          "filePanel.contentSearch.invalidScopeBody",
          "The search folder was moved or is outside the project. Clear the folder filter and try again."
        );
    } else if (
      snapshot.errorCode === "start-rejected" ||
      snapshot.errorCode === "start-failed"
    ) {
      errorBody = t(
        "filePanel.contentSearch.startFailed",
        "Unable to start content search."
      );
    } else if (snapshot.errorMessage) {
      errorBody = snapshot.errorMessage;
    }
    return (
      <Empty
        className="h-full border-0"
        data-testid="files-content-search-error"
      >
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CircleAlert />
          </EmptyMedia>
          <EmptyTitle>{errorTitle}</EmptyTitle>
          <EmptyDescription>{errorBody}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (
    snapshot.items.length === 0 &&
    conditions.query.trim() &&
    snapshot.status === "done"
  ) {
    return (
      <Empty className="h-full border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Search />
          </EmptyMedia>
          <EmptyTitle>
            {t("filePanel.contentSearch.noResults", "No results")}
          </EmptyTitle>
          <EmptyDescription>
            {t(
              "filePanel.contentSearch.noResultsHint",
              "Try different words, turn off match case, or widen the file filters."
            )}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  let indexOffset = 0;
  return (
    <ScrollArea
      className="h-full"
      viewportFade="vertical"
      viewportFadeProfile="short"
    >
      <div
        aria-label={t("filePanel.contentSearch.resultsLabel", "Search results")}
        className="flex flex-col gap-1.5 p-1.5"
        data-slot="files-content-search-results"
        role="listbox"
      >
        {groups.map((group) => {
          const offset = indexOffset;
          indexOffset += group.hits.length;
          return (
            <FilesContentSearchFileGroup
              activeIndex={activeIndex}
              hits={group.hits}
              indexOffset={offset}
              key={group.path}
              {...(onContextMenu ? { onContextMenu } : {})}
              onOpenHit={onOpenHit}
              onSetActiveIndex={onSetActiveIndex}
              path={group.path}
            />
          );
        })}
      </div>
    </ScrollArea>
  );
}
