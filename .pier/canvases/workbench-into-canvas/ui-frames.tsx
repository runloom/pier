import { Stack, Text } from "pier/canvas";
import type { ReactNode } from "react";

export function PageLead({ answers }: { answers: string }) {
  return (
    <Text tone="secondary" className="text-sm leading-relaxed">
      本页：{answers}
    </Text>
  );
}

export function H2({ children }: { children: ReactNode }) {
  return (
    <Text as="h2" className="text-base font-medium tracking-tight">
      {children}
    </Text>
  );
}

export function Lines({ items }: { items: string[] }) {
  return (
    <Stack gap={4}>
      {items.map((item) => (
        <Text key={item} className="text-sm leading-relaxed">
          · {item}
        </Text>
      ))}
    </Stack>
  );
}
