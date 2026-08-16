import {
  Badge,
  Button,
  Separator,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "pier/canvas";
import type { ReactNode } from "react";

function Section({
  children,
  title,
  trailing,
}: {
  children: ReactNode;
  title: string;
  trailing?: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium text-sm">{title}</h3>
        {trailing}
      </div>
      {children}
    </section>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <div className="rounded-md border bg-muted/20 px-3 py-2.5">
      <p className="font-mono text-xs leading-relaxed">{children}</p>
    </div>
  );
}

const SPECIMENS: {
  name: string;
  action: string;
  variant?: "outline" | "secondary" | "destructive";
  disabled?: boolean;
}[] = [
  { name: "default", action: "保存" },
  { name: "outline", action: "取消", variant: "outline" },
  { name: "secondary", action: "更多", variant: "secondary" },
  { name: "destructive", action: "删除", variant: "destructive" },
  { name: "disabled", action: "保存", disabled: true },
];

export function MaterialsDetailDialog() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-overlay-scrim p-8">
      <article
        aria-describedby="material-button-lead"
        aria-labelledby="material-button-title"
        aria-modal="true"
        className="relative flex max-h-full min-h-0 w-full max-w-2xl flex-col overflow-hidden rounded-[min(var(--radius-4xl),24px)] bg-popover text-popover-foreground shadow-xl"
        role="dialog"
      >
        <header className="shrink-0 border-border/60 border-b px-6 py-5 pr-14">
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h2
                className="font-medium text-base leading-none"
                id="material-button-title"
              >
                Button
              </h2>
              <Badge size="xs" variant="secondary">
                系统
              </Badge>
              <Badge size="xs" variant="outline">
                控件
              </Badge>
            </div>
            <p
              className="text-muted-foreground text-sm"
              id="material-button-lead"
            >
              触发主操作。默认、描边、次要、破坏四种外观。
            </p>
          </div>
          <Button
            aria-label="关闭"
            className="absolute top-4 right-4"
            size="icon-sm"
            type="button"
            variant="secondary"
          >
            <svg aria-hidden data-icon="inline-start" fill="none" viewBox="0 0 16 16">
              <path
                d="M4 4 12 12M12 4 4 12"
                stroke="currentColor"
                strokeWidth="1.5"
              />
            </svg>
            <span className="sr-only">关闭</span>
          </Button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-5">
          <Section title="实样">
            <div className="flex flex-col gap-3">
              {SPECIMENS.map((item) => (
                <div className="flex items-center gap-4" key={item.name}>
                  <p className="w-28 shrink-0 font-mono text-muted-foreground text-xs">
                    {item.name}
                  </p>
                  <Button
                    disabled={item.disabled}
                    type="button"
                    {...(item.variant ? { variant: item.variant } : {})}
                  >
                    {item.action}
                  </Button>
                </div>
              ))}
            </div>
          </Section>
          <Separator />
          <Section
            title="安装"
            trailing={
              <Button size="xs" type="button" variant="ghost">
                复制
              </Button>
            }
          >
            <CodeBlock>{`import { Button } from "pier/canvas"`}</CodeBlock>
          </Section>
          <Section title="用法">
            <CodeBlock>{`<Button variant="outline">取消</Button>`}</CodeBlock>
          </Section>
          <Separator />
          <Section title="接口">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead>默认</TableHead>
                  <TableHead>说明</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="font-mono text-xs">variant</TableCell>
                  <TableCell className="whitespace-normal font-mono text-muted-foreground text-xs">
                    default | outline | secondary | destructive | ghost
                  </TableCell>
                  <TableCell className="font-mono text-muted-foreground text-xs">
                    default
                  </TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">
                    外观。主操作用默认，次要用描边。
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-mono text-xs">disabled</TableCell>
                  <TableCell className="font-mono text-muted-foreground text-xs">
                    boolean
                  </TableCell>
                  <TableCell className="font-mono text-muted-foreground text-xs">
                    false
                  </TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">
                    禁用后不可点。
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-mono text-xs">type</TableCell>
                  <TableCell className="whitespace-normal font-mono text-muted-foreground text-xs">
                    button | submit
                  </TableCell>
                  <TableCell className="font-mono text-muted-foreground text-xs">
                    button
                  </TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">
                    画布里用 button，避免误提交。
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Section>
        </div>
      </article>
    </div>
  );
}
