/**
 * Content-search result list — grouped by file, shadcn Item composition.
 * Match highlight matches in-file / Markdown search marks
 * (`bg-warning/30`, active → action-accent).
 */
import { Badge } from "@pier/ui/badge.tsx";
import { PierFileIcon } from "@pier/ui/file-icon.tsx";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@pier/ui/item.tsx";
import { cn } from "@pier/ui/utils.ts";
import type { FileContentQueryItem } from "@shared/contracts/file-query.ts";
import { basename } from "./file-tree-action-utils.ts";

/** Same tokens as in-file search; square edges (no rounded corners). */
function SearchMatchMark(props: {
  active: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <mark
      className={
        props.active
          ? "rounded-none bg-action-accent text-action-accent-foreground"
          : "rounded-none bg-warning/30 text-inherit"
      }
    >
      {props.children}
    </mark>
  );
}

function PreviewWithMatch(props: {
  active: boolean;
  hit: FileContentQueryItem;
}): React.JSX.Element {
  const preview = props.hit.preview;
  const start = Math.max(
    0,
    Math.min(props.hit.previewMatchStart, preview.length)
  );
  const end = Math.max(
    start,
    Math.min(props.hit.previewMatchEnd, preview.length)
  );
  const before = preview.slice(0, start);
  const match = preview.slice(start, end);
  const after = preview.slice(end);

  return (
    <span className="min-w-0 font-mono text-muted-foreground text-xs leading-5">
      {before}
      {match ? (
        <SearchMatchMark active={props.active}>{match}</SearchMatchMark>
      ) : null}
      {after}
    </span>
  );
}

export function FilesContentSearchResultRow(props: {
  hit: FileContentQueryItem;
  isActive: boolean;
  onSelect: () => void;
  /** When true, omit path/title chrome (used under a file group header). */
  compact?: boolean;
}): React.JSX.Element {
  const name = basename(props.hit.path);

  return (
    <Item
      asChild
      className={cn(
        "w-full min-w-0 rounded-md border-transparent py-0.5",
        props.compact && "gap-1.5 px-1.5",
        props.isActive && "bg-muted"
      )}
      size="xs"
      variant="default"
    >
      <button
        aria-current={props.isActive ? "true" : undefined}
        data-testid="files-content-search-result-row"
        onClick={props.onSelect}
        type="button"
      >
        {props.compact ? (
          <ItemMedia
            className="w-8 shrink-0 justify-end tabular-nums"
            variant="default"
          >
            <span className="text-muted-foreground text-xs">
              {props.hit.line}
            </span>
          </ItemMedia>
        ) : (
          <ItemMedia variant="icon">
            <PierFileIcon aria-hidden="true" fileName={name} size={16} />
          </ItemMedia>
        )}
        <ItemContent className="min-w-0 gap-0">
          {props.compact ? null : (
            <ItemTitle className="min-w-0 gap-1.5">
              <span className="min-w-0 truncate">{name}</span>
              <span className="shrink-0 font-normal text-muted-foreground text-xs tabular-nums">
                :{props.hit.line}
              </span>
            </ItemTitle>
          )}
          <ItemDescription
            className={cn(
              "line-clamp-1 font-mono text-xs leading-5",
              props.compact && "text-foreground/90"
            )}
          >
            <PreviewWithMatch active={props.isActive} hit={props.hit} />
          </ItemDescription>
          {props.compact ? null : (
            <ItemDescription className="line-clamp-1 text-xs">
              {props.hit.path}
            </ItemDescription>
          )}
        </ItemContent>
      </button>
    </Item>
  );
}

export function FilesContentSearchFileGroup(props: {
  activeIndex: number;
  hits: readonly FileContentQueryItem[];
  /** Global index of the first hit in this group within the flat result list. */
  indexOffset: number;
  onOpenHit: (hit: FileContentQueryItem) => void;
  onSetActiveIndex: (index: number) => void;
  path: string;
}): React.JSX.Element {
  const name = basename(props.path);

  return (
    <section
      className="flex min-w-0 flex-col gap-0"
      data-slot="files-content-search-file-group"
    >
      <div className="sticky top-0 z-10 flex min-w-0 items-center gap-2 bg-background/95 px-2 py-1 backdrop-blur-sm">
        <PierFileIcon aria-hidden="true" fileName={name} size={16} />
        <span
          className="min-w-0 flex-1 truncate font-medium text-sm"
          title={props.path}
        >
          {name}
        </span>
        <span className="min-w-0 max-w-[45%] truncate text-muted-foreground text-xs">
          {props.path}
        </span>
        <Badge size="xs" variant="secondary">
          {props.hits.length}
        </Badge>
      </div>
      <ItemGroup className="gap-0! px-0.5">
        {props.hits.map((hit, localIndex) => {
          const index = props.indexOffset + localIndex;
          return (
            <FilesContentSearchResultRow
              compact
              hit={hit}
              isActive={index === props.activeIndex}
              key={`${hit.path}:${hit.line}:${hit.matchByteStart}:${hit.matchByteEnd}`}
              onSelect={() => {
                props.onSetActiveIndex(index);
                props.onOpenHit(hit);
              }}
            />
          );
        })}
      </ItemGroup>
    </section>
  );
}

export function groupHitsByPath(
  items: readonly FileContentQueryItem[]
): readonly { path: string; hits: readonly FileContentQueryItem[] }[] {
  const order: string[] = [];
  const map = new Map<string, FileContentQueryItem[]>();
  for (const item of items) {
    const list = map.get(item.path);
    if (list) {
      list.push(item);
    } else {
      map.set(item.path, [item]);
      order.push(item.path);
    }
  }
  return order.map((path) => ({
    path,
    hits: map.get(path) ?? [],
  }));
}
