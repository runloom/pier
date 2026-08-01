import { Alert, AlertDescription, AlertTitle } from "@pier/ui/alert.tsx";
import { Button } from "@pier/ui/button.tsx";
import { Skeleton } from "@pier/ui/skeleton.tsx";
import { MarkdownSourceEditor } from "@/components/code-editor/markdown-source.tsx";
import type { Translate } from "./shared.tsx";

/** Skeleton / error / capped read-only SKILL.md body, shared by details. */
export function SkillContentBody({
  content,
  loadFailed,
  errorDetail,
  onRetry,
  displayPath,
  t,
}: {
  content: { skillMd: string; truncated: boolean } | null;
  loadFailed: boolean;
  /** Optional technical detail under the unavailable title. */
  errorDetail?: string | null;
  onRetry?: () => void;
  displayPath: string;
  t: Translate;
}) {
  if (content === null && !loadFailed) {
    return <Skeleton className="min-h-60 w-full" />;
  }
  if (loadFailed) {
    return (
      <Alert variant="warning">
        <AlertTitle>{t("settings.skills.contentUnavailable")}</AlertTitle>
        <AlertDescription>
          <span className="flex flex-col gap-2">
            {errorDetail ? (
              <span className="break-words text-muted-foreground text-xs">
                {errorDetail}
              </span>
            ) : null}
            {onRetry ? (
              <span className="flex justify-end">
                <Button onClick={onRetry} size="sm" type="button">
                  {t("settings.skills.retry")}
                </Button>
              </span>
            ) : null}
          </span>
        </AlertDescription>
      </Alert>
    );
  }
  if (!content) {
    return null;
  }
  return (
    <>
      {content.truncated ? (
        <Alert>
          <AlertTitle>{t("settings.skills.contentTruncated")}</AlertTitle>
          <AlertDescription>
            <span className="font-mono">{displayPath}/SKILL.md</span>
          </AlertDescription>
        </Alert>
      ) : null}
      <MarkdownSourceEditor
        ariaLabel={t("settings.skills.contentTitle")}
        autoHeight
        readOnly
        value={content.skillMd}
      />
    </>
  );
}
