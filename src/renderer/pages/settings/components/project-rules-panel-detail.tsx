import { Alert, AlertDescription, AlertTitle } from "@pier/ui/alert.tsx";
import { Button } from "@pier/ui/button.tsx";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
import type {
  RuleFileId,
  RuleFileView,
} from "@shared/contracts/agent/assets.ts";
import { FileQuestion, FileWarning, FolderOpen } from "lucide-react";
import { MarkdownSourceEditor } from "@/components/code-editor/markdown-source.tsx";
import type { useT } from "@/i18n/use-t.ts";

export function ProjectRulesSelectedPane({
  content,
  contentReady,
  onChangeContent,
  onCreateMissing,
  onOpenExternal,
  onOpenInPier,
  onRevealPath,
  oversize,
  readOnly,
  selected,
  t,
}: {
  content: string;
  contentReady: boolean;
  onChangeContent: (next: string) => void;
  onCreateMissing: (id: RuleFileId) => void;
  onOpenExternal: (relativePath: string) => void;
  onOpenInPier: (relativePath: string, title?: string) => void;
  onRevealPath: (relativePath: string) => void;
  oversize: boolean;
  readOnly: boolean;
  selected: RuleFileView | undefined;
  t: ReturnType<typeof useT>;
}) {
  if (selected?.state === "missing") {
    return (
      <Empty className="min-h-60 border-0 p-6">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileQuestion />
          </EmptyMedia>
          <EmptyTitle>
            {t("settings.projects.rulesMissingTitle", {
              name: selected.relativePath,
            })}
          </EmptyTitle>
          <EmptyDescription>
            {selected.id === "cursor-rules"
              ? t("settings.projects.rulesCursorMissingBody")
              : t("settings.projects.rulesMissingBody")}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          {selected.id === "cursor-rules" ? (
            <Button
              onClick={() => {
                onRevealPath(".cursor");
              }}
              type="button"
              variant="outline"
            >
              {t("settings.projects.pierHomeReveal")}
            </Button>
          ) : (
            <Button
              onClick={() => {
                onCreateMissing(selected.id);
              }}
              type="button"
            >
              {t("settings.projects.rulesCreate", {
                name: selected.relativePath,
              })}
            </Button>
          )}
        </EmptyContent>
      </Empty>
    );
  }

  if (selected?.state === "directory") {
    return (
      <Empty className="min-h-60 border-0 p-6">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FolderOpen />
          </EmptyMedia>
          <EmptyTitle>{t("settings.projects.rulesDirectoryTitle")}</EmptyTitle>
          <EmptyDescription>
            {t("settings.projects.rulesDirectoryBody")}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            onClick={() => {
              onRevealPath(selected.relativePath);
            }}
            type="button"
            variant="outline"
          >
            {t("settings.projects.pierHomeReveal")}
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  if (selected?.state === "other") {
    return (
      <Empty className="min-h-60 border-0 p-6">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileWarning />
          </EmptyMedia>
          <EmptyTitle>
            {t("settings.projects.rulesOtherTitle", {
              name: selected.relativePath,
            })}
          </EmptyTitle>
          <EmptyDescription>
            {t("settings.projects.rulesOtherBody", {
              name: selected.relativePath,
            })}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (selected?.state === "file") {
    return (
      <>
        {oversize ? (
          <Alert variant="warning">
            <AlertTitle>
              {t("settings.projects.rulesTruncatedTitle")}
            </AlertTitle>
            <AlertDescription>
              <span className="block">
                {t("settings.projects.rulesTruncatedBody")}
              </span>
              <span className="mt-2 flex gap-2">
                <Button
                  onClick={() => {
                    onOpenInPier(selected.relativePath, selected.relativePath);
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {t("settings.projects.rulesOpenInPier")}
                </Button>
                <Button
                  onClick={() => {
                    onOpenExternal(selected.relativePath);
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {t("settings.projects.rulesOpenExternal")}
                </Button>
              </span>
            </AlertDescription>
          </Alert>
        ) : null}
        <MarkdownSourceEditor
          ariaLabel={t("settings.projects.rulesEditorLabel", {
            name: selected.relativePath,
          })}
          className="min-h-60 flex-1"
          onChange={(next) => {
            if (readOnly || !contentReady) return;
            onChangeContent(next);
          }}
          readOnly={readOnly || !contentReady}
          value={content}
        />
      </>
    );
  }

  return null;
}
