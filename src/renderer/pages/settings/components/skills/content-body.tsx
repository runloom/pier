import { Alert, AlertDescription, AlertTitle } from "@pier/ui/alert.tsx";
import { ErrorEmpty } from "@pier/ui/error-empty.tsx";
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
  // No SKILL.md body to show — full Empty, not an Alert strip.
  if (loadFailed) {
    return (
      <ErrorEmpty
        className="min-h-60"
        description={errorDetail?.trim() ? errorDetail : undefined}
        retryAction={
          onRetry
            ? {
                label: t("settings.skills.retry"),
                onClick: onRetry,
              }
            : undefined
        }
        title={t("settings.skills.contentUnavailable")}
      />
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
