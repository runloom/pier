import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Stack,
  Text,
} from "pier/canvas";
import type { CommandDetail } from "./types.ts";
import { CodeBlock, FieldLabel, StatusPill } from "./ui-bits.tsx";

function isShipped(status: string): boolean {
  return status === "shipped";
}

function CommandDetailBody({ cmd }: { cmd: CommandDetail }) {
  const outputLabel = isShipped(cmd.status)
    ? "输出示例（示意）"
    : "预期输出（规划示意）";

  return (
    <Stack gap={10}>
      <Stack gap={2}>
        <FieldLabel>怎么写</FieldLabel>
        <CodeBlock inCard>{cmd.synopsis}</CodeBlock>
      </Stack>
      {cmd.examples && cmd.examples.length > 0 ? (
        <Stack gap={2}>
          <FieldLabel>示例</FieldLabel>
          <CodeBlock inCard>{cmd.examples.join("\n")}</CodeBlock>
        </Stack>
      ) : null}
      {cmd.humanSample ? (
        <Stack gap={2}>
          <FieldLabel>不加 --json 时（示意）</FieldLabel>
          <CodeBlock inCard>{cmd.humanSample}</CodeBlock>
        </Stack>
      ) : null}
      <Stack gap={2}>
        <FieldLabel>{outputLabel}</FieldLabel>
        <CodeBlock inCard>{cmd.output}</CodeBlock>
      </Stack>
    </Stack>
  );
}

/**
 * 单一 Accordion 清单：不拆「表 + 下方再列一遍」。
 * 已实现不打标；仅暂未实现 / CLI 默认不可用 显示角标。
 */
export function CommandInventory({
  commands,
  openIds = [],
  highlightId = "",
}: {
  commands: CommandDetail[];
  openIds?: string[];
  highlightId?: string;
}) {
  if (commands.length === 0) {
    return (
      <Text tone="secondary" className="text-sm">
        没有匹配的命令。
      </Text>
    );
  }

  // 已实现在前，未实现在后（仍同一列表）
  const ordered = [...commands].sort((a, b) => {
    const aShip = isShipped(a.status) ? 0 : 1;
    const bShip = isShipped(b.status) ? 0 : 1;
    return aShip - bShip;
  });

  const defaultOpen = openIds.filter((id) =>
    ordered.some((c) => c.id === id)
  );

  return (
    <Accordion
      className="w-full"
      defaultValue={defaultOpen}
      key={`inv-${highlightId || "none"}-${defaultOpen.join(",")}`}
      type="multiple"
    >
      {ordered.map((cmd) => {
        const hit = highlightId === cmd.id;
        return (
          <AccordionItem id={`cmd-${cmd.id}`} key={cmd.id} value={cmd.id}>
            <AccordionTrigger
              className={
                hit ? "bg-muted/50 text-left text-sm" : "text-left text-sm"
              }
              style={{ textDecoration: "none" }}
            >
              <span className="flex min-w-0 flex-col items-start gap-0.5 pr-2">
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="font-mono font-medium">{cmd.name}</span>
                  {isShipped(cmd.status) ? null : (
                    <StatusPill status={cmd.status} />
                  )}
                </span>
                <span className="font-normal text-muted-foreground text-xs leading-relaxed">
                  {cmd.description}
                </span>
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <CommandDetailBody cmd={cmd} />
            </AccordionContent>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
}
