import {
  Button,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  StatusIcon,
} from "pier/canvas";

export function isTrackerAuthError(message: string): boolean {
  return /\b401\b|\b403\b|not authorized|unauth|authentication required/i.test(
    message
  );
}

export function AppletLoadError({
  detail,
  hint,
  onReconnect,
  onRetry,
  reconnectLabel,
  retryLabel,
  title,
}: {
  detail?: string | undefined;
  hint: string;
  onReconnect?: (() => void) | undefined;
  onRetry: () => void;
  reconnectLabel?: string | undefined;
  retryLabel: string;
  title: string;
}) {
  return (
    <Empty className="min-h-0 flex-1" role="status">
      <EmptyHeader>
        <EmptyMedia>
          <StatusIcon kind="error" />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{hint}</EmptyDescription>
        {detail ? <EmptyDescription>{detail}</EmptyDescription> : null}
      </EmptyHeader>
      <EmptyContent>
        {onReconnect && reconnectLabel ? (
          <Button onClick={onReconnect} type="button">
            {reconnectLabel}
          </Button>
        ) : null}
        <Button
          onClick={onRetry}
          type="button"
          variant={onReconnect ? "outline" : "default"}
        >
          {retryLabel}
        </Button>
      </EmptyContent>
    </Empty>
  );
}
