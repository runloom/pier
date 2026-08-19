import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Stack,
  Text,
} from "pier/canvas";
import type { ReactNode } from "react";

export function KitSection({
  children,
  hint,
  title,
}: {
  children: ReactNode;
  hint?: string;
  title: string;
}) {
  return (
    <Stack gap={10}>
      <Stack gap={4}>
        <Text as="h2" className="text-base font-semibold">
          {title}
        </Text>
        {hint ? (
          <Text className="text-sm leading-relaxed" tone="secondary">
            {hint}
          </Text>
        ) : null}
      </Stack>
      {children}
    </Stack>
  );
}

export function KitGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{children}</div>
  );
}

export function MaterialCard({
  children,
  install,
  lead,
  name,
}: {
  children: ReactNode;
  install: string;
  lead: string;
  name: string;
}) {
  return (
    <Card className="min-w-0 overflow-hidden">
      <div className="flex min-h-28 items-center justify-center overflow-hidden border-b bg-muted/40 p-4">
        {children}
      </div>
      <CardHeader className="gap-1">
        <CardTitle className="text-sm">{name}</CardTitle>
        <CardDescription>{lead}</CardDescription>
      </CardHeader>
      <CardContent>
        <Text className="block font-mono text-xs leading-relaxed" tone="secondary">
          {install}
        </Text>
      </CardContent>
    </Card>
  );
}
