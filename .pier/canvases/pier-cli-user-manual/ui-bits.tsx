import { Badge, Text } from "pier/canvas";
import type { ReactNode } from "react";
import { statusLabel, statusVariant, type CmdStatus } from "./status.ts";

/** 页内代码块；inCard 时去掉外框，避免 Card 套边框双重描边 */
export function CodeBlock({
  children,
  inCard = false,
}: {
  children: string;
  inCard?: boolean;
}) {
  return (
    <pre
      className={
        inCard
          ? "max-w-full overflow-x-auto rounded-md bg-muted/40 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap"
          : "max-w-full overflow-x-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap"
      }
    >
      {children}
    </pre>
  );
}

export function StatusPill({ status }: { status: CmdStatus }) {
  return (
    <Badge size="xs" variant={statusVariant(status)}>
      {statusLabel(status)}
    </Badge>
  );
}

export function PageTitle({
  children,
  badge,
}: {
  children: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Text as="h2" className="text-balance">
        {children}
      </Text>
      {badge}
    </div>
  );
}

export function Lead({ children }: { children: ReactNode }) {
  return (
    <Text tone="secondary" className="max-w-2xl text-sm leading-relaxed">
      {children}
    </Text>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <Text tone="tertiary" className="text-xs font-medium tracking-wide">
      {children}
    </Text>
  );
}

/**
 * 步骤里只把 pier 命令片段标成等宽。
 * 命令后若接中文说明（CJK），说明保持正文样式。
 */
export function StepText({ step }: { step: string }) {
  const match = /^(.*?)(pier\s+\S.*)$/u.exec(step);
  if (!match || match[2] === undefined) {
    return <>{step}</>;
  }
  const before = match[1] ?? "";
  const rest = match[2];
  // 在 ASCII 命令与 CJK/「或」类尾注之间拆分
  const split = /^(pier(?:\s+(?:--?[\w.-]+|\S+))*)(\s+.+)?$/u.exec(rest.trim());
  if (!split || split[1] === undefined) {
    return (
      <>
        {before}
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
          {rest}
        </code>
      </>
    );
  }
  const command = split[1];
  const note = split[2]?.trim() ?? "";
  // 尾注以中文或「或」开头则拆出；纯 flags 仍归命令
  const noteIsProse = note.length > 0 && /^(?:[\u4e00-\u9fff]|或)/.test(note);
  return (
    <>
      {before}
      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
        {noteIsProse ? command : rest.trim()}
      </code>
      {noteIsProse ? ` ${note}` : null}
    </>
  );
}
