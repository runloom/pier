import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Row,
  Stack,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
} from "pier/canvas";
import type { ReactNode } from "react";
import {
  groupNotes,
  presentCompletionAuthority,
  presentScopeModel,
  scopeItemLabel,
  splitNote,
  type NoteParts,
} from "./note-presentation.ts";
import { presentStatus, type StatusTone } from "./status-presentation.ts";

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <Text as="h2" className="text-lg font-semibold tracking-tight">
      {children}
    </Text>
  );
}

export function SubTitle({ children }: { children: ReactNode }) {
  return (
    <Text as="h3" className="text-sm font-semibold tracking-tight">
      {children}
    </Text>
  );
}

export function SectionLead({ children }: { children: ReactNode }) {
  return (
    <Text className="max-w-3xl text-sm leading-relaxed text-muted-foreground">{children}</Text>
  );
}

export function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="grid min-w-0 gap-2 text-sm leading-relaxed">
      {items.map((item) => (
        <li className="flex min-w-0 gap-2" key={item}>
          <span aria-hidden className="text-muted-foreground">
            —
          </span>
          <span className="min-w-0 break-words">{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function StatusBadge({ label, tone }: { label: string; tone?: StatusTone }) {
  const presentation = presentStatus(label);
  const known = presentation.label !== "状态未知" || label === "unknown" || label === "状态未知";
  return (
    <Badge size="xs" variant={tone ?? presentation.tone}>
      {known ? presentation.label : label}
    </Badge>
  );
}

export function DataTable({
  caption,
  headers,
  rows,
  monoFirst = false,
}: {
  caption: string;
  headers: string[];
  rows: ReactNode[][];
  monoFirst?: boolean;
}) {
  return (
    <div className="w-full max-w-full min-w-0 overflow-x-auto rounded-lg border border-border/70 bg-muted/10">
      <Table>
        <TableCaption className="sr-only">{caption}</TableCaption>
        <TableHeader>
          <TableRow>
            {headers.map((header) => (
              <TableHead
                className="min-w-28 whitespace-normal align-bottom text-xs leading-snug text-muted-foreground"
                key={header}
              >
                {header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, rowIndex) => (
            <TableRow key={`${caption}-${rowIndex}`}>
              {row.map((cell, cellIndex) => (
                <TableCell
                  className={
                    monoFirst && cellIndex === 0
                      ? "min-w-24 max-w-56 align-top whitespace-normal break-words font-mono text-xs"
                      : "min-w-32 max-w-80 align-top whitespace-normal break-words text-xs leading-relaxed text-muted-foreground"
                  }
                  key={`${caption}-${rowIndex}-${cellIndex}`}
                >
                  {cell}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export type ReferenceItem = {
  value: string;
  title: string;
  content: ReactNode;
};

/**
 * L3 查阅区：标准 Accordion（圆角边框 + chevron），多段成组。
 * 默认全部收起；type=multiple 可同时展开多项。
 */
export function ReferenceAccordion({
  items,
  type = "multiple",
}: {
  items: ReferenceItem[];
  type?: "single" | "multiple";
}) {
  if (items.length === 0) {
    return null;
  }
  if (type === "single") {
    return (
      <Accordion className="w-full min-w-0" collapsible type="single">
        {items.map((item) => (
          <AccordionItem key={item.value} value={item.value}>
            <AccordionTrigger className="text-left">{item.title}</AccordionTrigger>
            <AccordionContent className="min-w-0 overflow-x-auto">{item.content}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    );
  }
  return (
    <Accordion className="w-full min-w-0" type="multiple">
      {items.map((item) => (
        <AccordionItem key={item.value} value={item.value}>
          <AccordionTrigger className="text-left">{item.title}</AccordionTrigger>
          <AccordionContent className="min-w-0 overflow-x-auto">{item.content}</AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

export function DualPathCards() {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Card className="min-w-0" size="sm">
        <CardHeader className="gap-2">
          <Row align="center" gap={8} wrap>
            <Badge size="xs" variant="secondary">
              一次性
            </Badge>
            <CardTitle className="text-sm">原生 agent CLI（不经 Pier）</CardTitle>
          </Row>
        </CardHeader>
        <CardContent>
          <Stack gap={4}>
            <Text className="text-sm leading-relaxed">
              直接使用 codex / claude 等 headless 能力取得本次回复。
            </Text>
            <Text tone="tertiary" className="text-xs leading-relaxed">
              Pier 不封装、不实现 agents invoke；不进协作台 UI。
            </Text>
          </Stack>
        </CardContent>
      </Card>
      <Card className="min-w-0" size="sm">
        <CardHeader className="gap-2">
          <Row align="center" gap={8} wrap>
            <Badge size="xs" variant="info">
              持久会话 · 主路径
            </Badge>
            <CardTitle className="text-sm">start → turn → screen / wait</CardTitle>
          </Row>
        </CardHeader>
        <CardContent>
          <Stack gap={4}>
            <Text className="text-sm leading-relaxed">
              CLI 给出当前画面与完整 WorktreeRef。
            </Text>
            <Text tone="tertiary" className="text-xs leading-relaxed">
              文件与 Git 由调用方本地工具读取；无公共 transcript / 回放。
            </Text>
          </Stack>
        </CardContent>
      </Card>
    </div>
  );
}

/** 范围契约全量展示：不截断、不 +N、禁令全文。 */
export function OwnershipBlocks({
  pierOwns,
  callerOwns,
  forbiddenInPier,
  completionAuthority,
  scopeModel,
}: {
  pierOwns: string[];
  callerOwns: string[];
  forbiddenInPier: string[];
  completionAuthority?: string;
  scopeModel?: string;
}) {
  return (
    <Stack gap={8}>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <OwnershipTagColumn items={pierOwns} title="Pier 拥有" tone="info" />
        <OwnershipTagColumn items={callerOwns} title="调用方拥有" tone="success" />
      </div>
      <section className="min-w-0 rounded-lg border border-status-warning-border/50 bg-status-warning-bg/20 p-3">
        <Stack gap={6}>
          <Text className="text-xs font-semibold tracking-tight">明确禁止</Text>
          <ul className="grid min-w-0 gap-2.5">
            {forbiddenInPier.map((item) => (
              <li
                className="min-w-0 border-l-2 border-status-warning-border pl-2.5 text-xs leading-relaxed break-words"
                key={item}
              >
                {item}
              </li>
            ))}
          </ul>
        </Stack>
      </section>
      {completionAuthority || scopeModel ? (
        <Text tone="secondary" className="text-xs leading-relaxed">
          {[
            completionAuthority ? presentCompletionAuthority(completionAuthority) : null,
            scopeModel ? presentScopeModel(scopeModel) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      ) : null}
    </Stack>
  );
}

function OwnershipTagColumn({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "info" | "success";
}) {
  return (
    <section className="min-w-0 rounded-lg border border-border/70 bg-muted/15 p-3">
      <Stack gap={6}>
        <Text className="text-xs font-semibold tracking-tight">{title}</Text>
        {/* 短标签横向流式换行，避免单列竖排在宽卡片中大片留白 */}
        <div className="flex min-w-0 flex-wrap content-start gap-1.5">
          {items.map((item) => (
            <Badge
              className="h-auto max-w-full shrink-0 py-0.5 whitespace-normal break-words"
              key={item}
              size="xs"
              variant={tone}
            >
              {scopeItemLabel(item)}
            </Badge>
          ))}
        </div>
      </Stack>
    </section>
  );
}

/**
 * 架构长文：主题 + 扁平结论/细则卡片。
 * 故意不用内层 Accordion，避免嵌在 ReferenceAccordion 时双层折叠。
 */
export function GroupedNoteCards({ items }: { items: string[] }) {
  const groups = groupNotes(items);
  return (
    <Stack className="min-w-0" gap={10}>
      {groups.map((group) => (
        <Stack className="min-w-0" gap={4} key={group.topic}>
          <SubTitle>{group.topic}</SubTitle>
          <FlatNoteList notes={group.notes} valuePrefix={group.topic} />
        </Stack>
      ))}
    </Stack>
  );
}

/** 护栏 / 反模式等：扁平摘要 + 细则（可嵌在查阅 Accordion 内）。 */
export function ExpandableNoteList({ items }: { items: string[] }) {
  const notes = items.map((item) => splitNote(item));
  return <FlatNoteList notes={notes} valuePrefix="note" />;
}

function FlatNoteList({
  notes,
  valuePrefix,
}: {
  notes: NoteParts[];
  valuePrefix: string;
}) {
  return (
    <ul className="grid min-w-0 gap-2.5">
      {notes.map((note, index) => (
        <li
          className="min-w-0 rounded-lg border border-border/60 bg-muted/10 px-3 py-2.5"
          key={`${valuePrefix}-${index}-${note.summary.slice(0, 24)}`}
        >
          <Stack gap={3}>
            <Text className="text-sm font-medium leading-relaxed">{note.summary}</Text>
            {note.detail ? (
              <Text tone="secondary" className="text-xs leading-relaxed break-words">
                {note.detail}
              </Text>
            ) : null}
          </Stack>
        </li>
      ))}
    </ul>
  );
}

export function MetricStrips({
  items,
}: {
  items: Array<{ metric: string; target: string }>;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <section
          className="min-w-0 rounded-lg border border-border/60 bg-background/40 px-3 py-2.5"
          key={item.metric}
        >
          <Stack gap={3}>
            <Text className="text-sm font-medium leading-snug">{item.metric}</Text>
            <Text tone="secondary" className="text-xs leading-relaxed">
              {item.target}
            </Text>
          </Stack>
        </section>
      ))}
    </div>
  );
}

export function DayStepCards({
  steps,
}: {
  steps: Array<{ title: string; cmd: string; why: string; userSees: string }>;
}) {
  return (
    <ol className="grid min-w-0 gap-3">
      {steps.map((step, index) => (
        <li
          className="min-w-0 rounded-lg border border-border/70 bg-muted/15 p-3"
          key={`${step.title}-${index}`}
        >
          <Stack gap={6}>
            <Row align="center" gap={8} wrap>
              <Badge size="xs" variant="outline">
                第 {index + 1} 步
              </Badge>
              <Text className="text-sm font-semibold tracking-tight">{step.title}</Text>
            </Row>
            <pre className="overflow-x-auto rounded-md border bg-background/60 p-2.5 font-mono text-xs leading-relaxed whitespace-pre-wrap">
              {step.cmd.replace(/\s+/g, " ").trim()}
            </pre>
            <Text className="text-xs leading-relaxed text-muted-foreground">{step.why}</Text>
            <Text tone="tertiary" className="text-xs leading-relaxed">
              返回：{step.userSees}
            </Text>
          </Stack>
        </li>
      ))}
    </ol>
  );
}

export function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-border/70 bg-muted/20 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
      {children}
    </pre>
  );
}

/** 硬约束：扁平 id + 结论 + 细则（可嵌在查阅 Accordion 内，不再套二层 Accordion）。 */
export function IdConstraintList({
  items,
}: {
  items: Array<{ id: string; text: string }>;
}) {
  return (
    <ul className="grid min-w-0 gap-2.5">
      {items.map((item) => {
        const note = splitNote(item.text);
        return (
          <li
            className="min-w-0 rounded-lg border border-border/60 bg-muted/10 px-3 py-2.5"
            key={item.id}
          >
            <Stack gap={3}>
              <Text className="font-mono text-xs text-muted-foreground">{item.id}</Text>
              <Text className="text-sm font-medium leading-relaxed">{note.summary}</Text>
              {note.detail ? (
                <Text tone="secondary" className="text-xs leading-relaxed break-words">
                  {note.detail}
                </Text>
              ) : null}
            </Stack>
          </li>
        );
      })}
    </ul>
  );
}
