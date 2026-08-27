import { Row, Stack, Text } from "pier/canvas";
import type { ReactNode } from "react";

export const PHONE_W = 360;
export const PHONE_H = 680;

function bandClass(grow?: boolean, last?: boolean): string {
  if (grow && last) {
    return "min-h-0 flex-1 px-2 py-1.5";
  }
  if (grow) {
    return "min-h-0 flex-1 border-b border-foreground px-2 py-1.5";
  }
  if (last) {
    return "px-2 py-1.5";
  }
  return "border-b border-foreground px-2 py-1.5";
}

function boxClass(dashed?: boolean, hi?: boolean): string {
  if (dashed && hi) {
    return "border border-dashed border-foreground bg-muted p-1.5";
  }
  if (dashed) {
    return "border border-dashed border-foreground p-1.5";
  }
  if (hi) {
    return "border border-foreground bg-muted p-1.5";
  }
  return "border border-foreground p-1.5";
}

export function Band({
  children,
  grow,
  last,
  title,
}: {
  children: ReactNode;
  grow?: boolean;
  last?: boolean;
  title: string;
}) {
  return (
    <Stack className={bandClass(grow, last)} gap={4}>
      <Text className="text-[10px] font-medium tracking-wide" tone="tertiary">
        {title}
      </Text>
      {children}
    </Stack>
  );
}

export function Box({
  children,
  dashed,
  hi,
}: {
  children: ReactNode;
  dashed?: boolean;
  hi?: boolean;
}) {
  return (
    <Stack className={boxClass(dashed, hi)} gap={4}>
      {children}
    </Stack>
  );
}

export function Chip({ on, text }: { on?: boolean; text: string }) {
  return (
    <Text
      className={
        on
          ? "border border-foreground bg-foreground px-1.5 py-0.5 text-[10px] text-background"
          : "border border-foreground px-1.5 py-0.5 text-[10px]"
      }
    >
      {text}
    </Text>
  );
}

export function AppNav({
  active,
}: {
  active: "hosts" | "sessions" | "inbox";
}) {
  const items = [
    { id: "hosts", label: "主机" },
    { id: "sessions", label: "工作台" },
    { id: "inbox", label: "通知 n" },
  ] as const;
  return (
    <Row className="border-t border-foreground" gap={0}>
      {items.map((item) => (
        <Text
          className={
            item.id === active
              ? "flex-1 bg-foreground py-2 text-center text-[11px] text-background"
              : "flex-1 py-2 text-center text-[11px]"
          }
          key={item.id}
        >
          {item.label}
        </Text>
      ))}
    </Row>
  );
}

export function SessionTabs({
  active,
}: {
  active: "term" | "diff" | "files";
}) {
  const items = [
    { id: "term", label: "终端" },
    { id: "diff", label: "变更" },
    { id: "files", label: "文件" },
  ] as const;
  return (
    <Row className="border-b border-foreground" gap={0}>
      {items.map((item) => (
        <Text
          className={
            item.id === active
              ? "flex-1 bg-foreground py-1.5 text-center text-[11px] text-background"
              : "flex-1 py-1.5 text-center text-[11px]"
          }
          key={item.id}
        >
          {item.label}
        </Text>
      ))}
    </Row>
  );
}
