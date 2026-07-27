/**
 * Content search panel chrome: query field, match toggles, and filters.
 */
import { Button } from "@pier/ui/button.tsx";
import { Checkbox } from "@pier/ui/checkbox.tsx";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@pier/ui/field.tsx";
import { Input } from "@pier/ui/input.tsx";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@pier/ui/input-group.tsx";
import { Spinner } from "@pier/ui/spinner.tsx";
import { ToggleGroup, ToggleGroupItem } from "@pier/ui/toggle-group.tsx";
import type { FileContentQueryItem } from "@shared/contracts/file-query.ts";
import { CaseSensitive, Regex, Search, Square, WholeWord } from "lucide-react";
import type { ContentQuerySnapshot } from "./files-content-search-client.ts";
import type { FilesContentSearchConditions } from "./files-content-search-params.ts";
import type { FilesTranslate } from "./files-i18n.ts";

export function contentSearchStatusText(input: {
  conditions: FilesContentSearchConditions;
  snapshot: ContentQuerySnapshot;
  t: FilesTranslate;
}): string {
  const { conditions, snapshot, t } = input;
  if (!conditions.root) {
    return t(
      "filePanel.contentSearch.noProject",
      "Open a project to search file contents."
    );
  }
  if (snapshot.status === "loading") {
    return t("filePanel.contentSearch.searching", "Searching…");
  }
  if (snapshot.status === "error") {
    if (snapshot.errorCode === "search-runtime-unavailable") {
      return t(
        "filePanel.contentSearch.runtimeMissingTitle",
        "Search unavailable"
      );
    }
    return t("filePanel.contentSearch.failed", "Search failed");
  }
  if (snapshot.items.length === 0 && conditions.query.trim()) {
    return t("filePanel.contentSearch.noResults", "No results");
  }
  if (snapshot.truncated) {
    return t(
      "filePanel.contentSearch.truncated",
      "Showing {{count}}+ results",
      { count: snapshot.items.length }
    );
  }
  if (snapshot.items.length > 0) {
    return t("filePanel.contentSearch.resultCount", "{{count}} results", {
      count: snapshot.items.length,
    });
  }
  return t(
    "filePanel.contentSearch.hint",
    "Enter text to search across the project."
  );
}

export function FilesContentSearchChrome(props: {
  activeIndex: number;
  conditions: FilesContentSearchConditions;
  onOpenHit: (hit: FileContentQueryItem) => void;
  onPatchConditions: (patch: Partial<FilesContentSearchConditions>) => void;
  onSetActiveIndex: (updater: (index: number) => number) => void;
  onStopSearch: () => void;
  optionsOpen: boolean;
  setOptionsOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  snapshot: ContentQuerySnapshot;
  statusText: string;
  t: FilesTranslate;
}): React.JSX.Element {
  const {
    activeIndex,
    conditions,
    onOpenHit,
    onPatchConditions,
    onSetActiveIndex,
    onStopSearch,
    optionsOpen,
    setOptionsOpen,
    snapshot,
    statusText,
    t,
  } = props;

  return (
    <div className="flex shrink-0 flex-col gap-2.5 border-b bg-background px-3 py-2.5">
      <FieldGroup className="gap-2.5">
        <Field>
          <FieldLabel className="sr-only" htmlFor="files-content-search-query">
            {t("filePanel.contentSearch.queryLabel", "Search")}
          </FieldLabel>
          <InputGroup>
            <InputGroupAddon align="inline-start">
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              autoFocus
              disabled={!conditions.root}
              id="files-content-search-query"
              onChange={(event) =>
                onPatchConditions({ query: event.target.value })
              }
              onKeyDown={(event) => {
                if (event.key === "Enter" && snapshot.items[activeIndex]) {
                  event.preventDefault();
                  onOpenHit(snapshot.items[activeIndex]!);
                }
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  onSetActiveIndex((i) =>
                    snapshot.items.length === 0
                      ? 0
                      : (i + 1) % snapshot.items.length
                  );
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  onSetActiveIndex((i) =>
                    snapshot.items.length === 0
                      ? 0
                      : (i - 1 + snapshot.items.length) % snapshot.items.length
                  );
                }
              }}
              placeholder={t(
                "filePanel.contentSearch.placeholder",
                "Search in files"
              )}
              value={conditions.query}
            />
            {snapshot.status === "loading" ? (
              <InputGroupAddon align="inline-end">
                <Spinner className="size-3.5 text-muted-foreground" />
                <InputGroupButton
                  aria-label={t("filePanel.contentSearch.stop", "Stop search")}
                  onClick={onStopSearch}
                  size="icon-xs"
                  title={t("filePanel.contentSearch.stop", "Stop search")}
                  variant="ghost"
                >
                  <Square className="fill-current" />
                </InputGroupButton>
              </InputGroupAddon>
            ) : null}
          </InputGroup>
        </Field>

        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            onValueChange={(values) => {
              const next = new Set(values);
              onPatchConditions({
                caseSensitive: next.has("case"),
                wholeWord: next.has("word"),
                regexp: next.has("regexp"),
              });
            }}
            size="sm"
            spacing={0}
            type="multiple"
            value={[
              ...(conditions.caseSensitive ? (["case"] as const) : []),
              ...(conditions.wholeWord ? (["word"] as const) : []),
              ...(conditions.regexp ? (["regexp"] as const) : []),
            ]}
            variant="outline"
          >
            <ToggleGroupItem
              aria-label={t("filePanel.contentSearch.matchCase", "Match case")}
              value="case"
            >
              <CaseSensitive />
            </ToggleGroupItem>
            <ToggleGroupItem
              aria-label={t("filePanel.contentSearch.wholeWord", "Whole word")}
              value="word"
            >
              <WholeWord />
            </ToggleGroupItem>
            <ToggleGroupItem
              aria-label={t("filePanel.contentSearch.regexp", "Regexp")}
              value="regexp"
            >
              <Regex />
            </ToggleGroupItem>
          </ToggleGroup>
          <Button
            aria-expanded={optionsOpen}
            className="text-xs"
            onClick={() => setOptionsOpen((open) => !open)}
            size="xs"
            type="button"
            variant={optionsOpen ? "secondary" : "ghost"}
          >
            {optionsOpen
              ? t("filePanel.contentSearch.hideOptions", "Hide filters")
              : t("filePanel.contentSearch.showOptions", "Filters")}
          </Button>
          <span className="ml-auto text-muted-foreground text-xs tabular-nums">
            {statusText}
          </span>
        </div>

        {optionsOpen ? (
          <FilesContentSearchFilters
            conditions={conditions}
            onPatchConditions={onPatchConditions}
            t={t}
          />
        ) : null}
      </FieldGroup>
    </div>
  );
}

function FilesContentSearchFilters(props: {
  conditions: FilesContentSearchConditions;
  onPatchConditions: (patch: Partial<FilesContentSearchConditions>) => void;
  t: FilesTranslate;
}): React.JSX.Element {
  const { conditions, onPatchConditions, t } = props;
  return (
    <div
      className="flex flex-col gap-3 rounded-2xl border bg-card p-3"
      id="files-content-search-filters"
    >
      <Field>
        <FieldLabel htmlFor="files-content-search-include">
          {t("filePanel.contentSearch.include", "Files to include")}
        </FieldLabel>
        <Input
          id="files-content-search-include"
          onChange={(event) =>
            onPatchConditions({ include: event.target.value })
          }
          placeholder={t(
            "filePanel.contentSearch.includePlaceholder",
            "*.ts, src/**"
          )}
          value={conditions.include}
        />
        <FieldDescription>
          {t(
            "filePanel.contentSearch.includeHint",
            "Optional glob. Leave empty to search all files."
          )}
        </FieldDescription>
      </Field>
      <FieldGroup className="gap-2">
        <Field className="flex-row items-center gap-2" orientation="horizontal">
          <Checkbox
            checked={conditions.applyGitIgnore}
            id="files-content-search-gitignore"
            onCheckedChange={(checked) =>
              onPatchConditions({
                applyGitIgnore: checked === true,
              })
            }
          />
          <FieldLabel htmlFor="files-content-search-gitignore">
            {t("filePanel.contentSearch.useGitIgnore", "Use Git ignore rules")}
          </FieldLabel>
        </Field>
        <Field className="flex-row items-center gap-2" orientation="horizontal">
          <Checkbox
            checked={conditions.applyExcludePatterns}
            id="files-content-search-exclude"
            onCheckedChange={(checked) =>
              onPatchConditions({
                applyExcludePatterns: checked === true,
              })
            }
          />
          <FieldLabel htmlFor="files-content-search-exclude">
            {t(
              "filePanel.contentSearch.useExclude",
              "Use search exclude patterns"
            )}
          </FieldLabel>
        </Field>
      </FieldGroup>
      {conditions.scopeDir ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-muted/40 px-2.5 py-2 text-muted-foreground text-xs">
          <span className="min-w-0 flex-1">
            {t(
              "filePanel.contentSearch.scope",
              "Searching in folder: {{path}}",
              { path: conditions.scopeDir }
            )}
          </span>
          <Button
            onClick={() => onPatchConditions({ scopeDir: undefined })}
            size="sm"
            type="button"
            variant="ghost"
          >
            {t("filePanel.contentSearch.clearScope", "Search whole project")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
