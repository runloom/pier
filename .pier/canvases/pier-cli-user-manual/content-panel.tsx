import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Alert,
  AlertDescription,
  AlertTitle,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
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
import { useEffect, useMemo, useState } from "react";
import { CommandInventory } from "./command-block.tsx";
import type { NavId } from "./nav.ts";
import type { Domain, ManualData } from "./types.ts";
import { CodeBlock, Lead, PageTitle, StepText } from "./ui-bits.tsx";

export type ContentFocus = {
  taskId?: string;
  domainId?: string;
  commandId?: string;
  faqIndex?: number;
};

function SectionHeading({ children }: { children: string }) {
  return (
    <Text as="h3" className="text-sm font-semibold tracking-tight">
      {children}
    </Text>
  );
}

function useScrollToFocus(focusKey: string | undefined) {
  useEffect(() => {
    if (!focusKey) {
      return;
    }
    const id = window.setTimeout(() => {
      const el = document.getElementById(focusKey);
      el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 50);
    return () => window.clearTimeout(id);
  }, [focusKey]);
}

function domainSelectLabel(domain: Domain): string {
  const total = domain.commands.length;
  const unfinished = domain.commands.filter((c) => c.status !== "shipped")
    .length;
  if (unfinished === 0) {
    return `${domain.label} · ${total} 条`;
  }
  return `${domain.label} · ${total} 条（${unfinished} 暂未实现）`;
}

function StartPage({ data }: { data: ManualData }) {
  return (
    <Stack gap={14}>
      <Stack gap={6}>
        <PageTitle>开始</PageTitle>
        <Alert>
          <AlertTitle>先读这一段</AlertTitle>
          <AlertDescription>{data.bluf}</AlertDescription>
        </Alert>
      </Stack>

      <Stack gap={8}>
        <SectionHeading>四步上手</SectionHeading>
        <Lead>按顺序复制即可。脚本请始终带 --json。</Lead>
        <div className="grid gap-3 sm:grid-cols-2">
          {data.quickStart.firstCommands.map((step) => (
            <Card key={step.title}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">
                  {step.title}
                </CardTitle>
                <Text tone="tertiary" className="text-xs">
                  {step.note}
                </Text>
              </CardHeader>
              <CardContent>
                <CodeBlock inCard>{step.cmd}</CodeBlock>
              </CardContent>
            </Card>
          ))}
        </div>
      </Stack>

      {data.design.principles && data.design.principles.length > 0 ? (
        <Stack gap={6}>
          <SectionHeading>怎么写命令</SectionHeading>
          <Stack gap={3}>
            {data.design.principles.map((line) => (
              <Text key={line} className="text-sm">
                {line}
              </Text>
            ))}
          </Stack>
        </Stack>
      ) : null}

      <Separator />

      <Stack gap={6}>
        <SectionHeading>使用前</SectionHeading>
        <Lead>{data.quickStart.prerequisite}</Lead>
        <Alert>
          <AlertTitle>连不上时</AlertTitle>
          <AlertDescription>
            确认 Pier 已运行，且与 CLI 为同一用户、同一应用数据目录。
          </AlertDescription>
        </Alert>
      </Stack>

      <Stack gap={6}>
        <SectionHeading>怎么调用 pier</SectionHeading>
        <Stack gap={4}>
          {data.quickStart.binPaths.map((line) => (
            <CodeBlock key={line}>{line}</CodeBlock>
          ))}
        </Stack>
      </Stack>

      <Accordion className="w-full" type="multiple">
        <AccordionItem value="options">
          <AccordionTrigger
            className="text-left text-sm no-underline hover:no-underline"
            style={{ textDecoration: "none" }}
          >
            全局选项
          </AccordionTrigger>
          <AccordionContent>
            <div className="overflow-x-auto rounded-lg border border-border">
              <Table>
                <TableCaption className="sr-only">全局 CLI 选项</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40%]">选项</TableHead>
                    <TableHead>说明</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.globalOptions.map((opt) => (
                    <TableRow key={opt.flag}>
                      <TableCell className="font-mono text-xs whitespace-nowrap">
                        {opt.flag}
                      </TableCell>
                      <TableCell className="text-sm">{opt.meaning}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="output">
          <AccordionTrigger
            className="text-left text-sm no-underline hover:no-underline"
            style={{ textDecoration: "none" }}
          >
            输出约定（成功 / 失败示意）
          </AccordionTrigger>
          <AccordionContent>
            <Stack gap={8}>
              <Lead>示意形态；以实际 --json 返回为准。</Lead>
              <Stack gap={2}>
                <Text className="text-xs font-medium">成功</Text>
                <CodeBlock>{data.outputShapes.success}</CodeBlock>
              </Stack>
              <Stack gap={2}>
                <Text className="text-xs font-medium">失败</Text>
                <CodeBlock>{data.outputShapes.failure}</CodeBlock>
              </Stack>
            </Stack>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </Stack>
  );
}

function TasksPage({
  data,
  focusTaskId,
}: {
  data: ManualData;
  focusTaskId?: string;
}) {
  const openIds =
    focusTaskId && data.tasks.some((t) => t.id === focusTaskId)
      ? [focusTaskId]
      : [];

  useScrollToFocus(focusTaskId ? `task-${focusTaskId}` : undefined);

  return (
    <Stack gap={12}>
      <Stack gap={4}>
        <PageTitle>常用任务</PageTitle>
        <Lead>按场景展开步骤。需要完整参数与输出时，转到「命令参考」。</Lead>
      </Stack>
      <Accordion
        className="w-full"
        defaultValue={openIds}
        key={focusTaskId ?? "tasks-all-closed"}
        type="multiple"
      >
        {data.tasks.map((task) => (
          <AccordionItem id={`task-${task.id}`} key={task.id} value={task.id}>
            <AccordionTrigger
              className="text-left text-sm no-underline hover:no-underline"
              style={{ textDecoration: "none" }}
            >
              <span className="flex min-w-0 flex-col items-start gap-0.5">
                <span>{task.title}</span>
                <span className="font-normal text-muted-foreground text-xs">
                  {task.when}
                </span>
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <ol className="grid list-decimal gap-2 pl-5 text-sm leading-relaxed">
                {task.steps.map((step) => (
                  <li key={step}>
                    <StepText step={step} />
                  </li>
                ))}
              </ol>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </Stack>
  );
}

function ReferencePage({
  data,
  focusDomainId,
  focusCommandId,
}: {
  data: ManualData;
  focusDomainId?: string;
  focusCommandId?: string;
}) {
  const fallback = data.domains[0]?.id ?? "";
  const initial =
    focusDomainId && data.domains.some((d) => d.id === focusDomainId)
      ? focusDomainId
      : fallback;
  const [domainId, setDomainId] = useState(initial);

  useEffect(() => {
    if (focusDomainId && data.domains.some((d) => d.id === focusDomainId)) {
      setDomainId(focusDomainId);
    }
  }, [focusDomainId, data.domains]);

  useScrollToFocus(focusCommandId ? `cmd-${focusCommandId}` : undefined);

  const domain = data.domains.find((d) => d.id === domainId);
  const commands = domain?.commands ?? [];
  const openIds =
    focusCommandId && commands.some((c) => c.id === focusCommandId)
      ? [focusCommandId]
      : [];

  return (
    <Stack gap={12}>
      <Stack gap={4}>
        <PageTitle>命令参考</PageTitle>
        <Lead>
          先选领域，再展开命令查看写法与输出。带「暂未实现」标记的勿写进脚本。
        </Lead>
      </Stack>
      <Select value={domainId} onValueChange={setDomainId}>
        <SelectTrigger aria-label="命令领域" className="max-w-md">
          <SelectValue placeholder="选择领域" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {data.domains.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {domainSelectLabel(d)}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {domain ? (
        <Stack gap={8}>
          <Lead>{domain.blurb}</Lead>
          <CommandInventory
            commands={commands}
            highlightId={focusCommandId ?? ""}
            openIds={openIds}
          />
        </Stack>
      ) : (
        <Text tone="secondary" className="text-sm">
          未找到该领域。
        </Text>
      )}
    </Stack>
  );
}

function AgentsPage({
  data,
  focusCommandId,
}: {
  data: ManualData;
  focusCommandId?: string;
}) {
  useScrollToFocus(focusCommandId ? `cmd-${focusCommandId}` : undefined);

  const commands = [...data.agents.shipped, ...data.agents.planned];
  const openIds =
    focusCommandId && commands.some((c) => c.id === focusCommandId)
      ? [focusCommandId]
      : [];

  return (
    <Stack gap={12}>
      <Stack gap={6}>
        <PageTitle>智能体</PageTitle>
        <Lead>{data.agents.intro}</Lead>
        <Text tone="secondary" className="text-sm leading-relaxed">
          启动智能体请在应用内操作；CLI 侧重查看目录与运行中的面板。带「暂未实现」的不要写进脚本。
        </Text>
      </Stack>
      <CommandInventory
        commands={commands}
        highlightId={focusCommandId ?? ""}
        openIds={openIds}
      />
    </Stack>
  );
}

function HelpPage({
  data,
  focusFaqIndex,
}: {
  data: ManualData;
  focusFaqIndex?: number;
}) {
  const openIds = useMemo(() => {
    if (
      focusFaqIndex !== undefined &&
      focusFaqIndex >= 0 &&
      focusFaqIndex < data.faq.length
    ) {
      return [`faq-${focusFaqIndex}`];
    }
    return [];
  }, [focusFaqIndex, data.faq.length]);

  useScrollToFocus(
    focusFaqIndex !== undefined ? `faq-${focusFaqIndex}` : undefined
  );

  return (
    <Stack gap={12}>
      <Stack gap={4}>
        <PageTitle>疑难</PageTitle>
        <Lead>
          连不上或命令失败时先查这里。也可用顶栏搜索命令名或任务关键词。
        </Lead>
      </Stack>
      <Accordion
        className="w-full"
        defaultValue={openIds}
        key={
          focusFaqIndex !== undefined ? `faq-focus-${focusFaqIndex}` : "faq-all"
        }
        type="multiple"
      >
        {data.faq.map((item, index) => (
          <AccordionItem
            id={`faq-${index}`}
            key={item.q}
            value={`faq-${index}`}
          >
            <AccordionTrigger
              className="text-left text-sm no-underline hover:no-underline"
              style={{ textDecoration: "none" }}
            >
              {item.q}
            </AccordionTrigger>
            <AccordionContent>
              <Text tone="secondary" className="text-sm leading-relaxed">
                {item.a}
              </Text>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
      <Text tone="tertiary" className="text-xs">
        脚本请始终加 --json。本 Canvas（data.json）为 CLI
        用户手册唯一真源。
      </Text>
    </Stack>
  );
}

export function ContentPanel({
  navId,
  data,
  focus,
}: {
  navId: NavId;
  data: ManualData;
  focus?: ContentFocus;
}) {
  if (navId === "start") {
    return <StartPage data={data} />;
  }
  if (navId === "tasks") {
    return focus?.taskId ? (
      <TasksPage data={data} focusTaskId={focus.taskId} />
    ) : (
      <TasksPage data={data} />
    );
  }
  if (navId === "reference") {
    if (focus?.domainId && focus.commandId) {
      return (
        <ReferencePage
          data={data}
          focusCommandId={focus.commandId}
          focusDomainId={focus.domainId}
        />
      );
    }
    if (focus?.domainId) {
      return <ReferencePage data={data} focusDomainId={focus.domainId} />;
    }
    if (focus?.commandId) {
      return <ReferencePage data={data} focusCommandId={focus.commandId} />;
    }
    return <ReferencePage data={data} />;
  }
  if (navId === "agents") {
    return focus?.commandId ? (
      <AgentsPage data={data} focusCommandId={focus.commandId} />
    ) : (
      <AgentsPage data={data} />
    );
  }
  if (navId === "help") {
    return focus?.faqIndex !== undefined ? (
      <HelpPage data={data} focusFaqIndex={focus.faqIndex} />
    ) : (
      <HelpPage data={data} />
    );
  }
  return (
    <Text tone="secondary" className="text-sm">
      请从左侧目录选择章节。
    </Text>
  );
}
