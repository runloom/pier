import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldLabel,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "pier/canvas";
import { MaterialsDetailDialog } from "./kit-detail.tsx";

export { MaterialsDetailDialog };

type Kind = "版式" | "控件" | "图示" | "数据" | "文件" | "页面";
type Origin = "系统" | "项目";

const ALL_ROWS: {
  kind: Kind;
  name: string;
  origin: Origin;
  lead?: string;
  path?: string;
}[] = [
  {
    kind: "页面",
    name: "发布方案",
    origin: "项目",
    path: ".pier/canvases/release-plan/release-plan.canvas.tsx",
  },
  {
    kind: "页面",
    name: "Canvas 物料金标准",
    origin: "项目",
    path: ".pier/canvases/workbench-into-canvas/workbench-into-canvas.canvas.tsx",
  },
  { kind: "版式", name: "Frame", origin: "系统", lead: "固定宽高的画板容器" },
  { kind: "版式", name: "Stack", origin: "系统", lead: "纵向或横向排列子项" },
  { kind: "版式", name: "Artboard", origin: "系统", lead: "带标题的设计稿帧" },
  { kind: "控件", name: "Button", origin: "系统", lead: "主操作、次要与破坏动作" },
  { kind: "控件", name: "Tabs", origin: "系统", lead: "同一页里切换分段" },
  { kind: "控件", name: "Badge", origin: "系统", lead: "短状态或分类标记" },
  { kind: "控件", name: "Input", origin: "系统", lead: "单行输入" },
  { kind: "控件", name: "Select", origin: "系统", lead: "从列表里选一项" },
  { kind: "图示", name: "Table", origin: "系统", lead: "行列对照" },
  { kind: "图示", name: "DataChart", origin: "系统", lead: "数值趋势与对比" },
  {
    kind: "图示",
    name: "Mermaid",
    origin: "系统",
    lead: "流程图、时序、状态、类图、实体关系和思维导图。",
  },
  {
    kind: "数据",
    name: "file",
    origin: "系统",
    lead: "文件命令与广播",
  },
  {
    kind: "数据",
    name: "git",
    origin: "系统",
    lead: "Git 命令与广播",
  },
  {
    kind: "文件",
    name: "canvasFile",
    origin: "系统",
    lead: "读写相邻文件，含冲突",
  },
];

function fileName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

function Specimen({ name, origin }: { name: string; origin: Origin }) {
  if (origin === "项目") {
    return <p className="px-3 text-center font-medium text-sm">{name}</p>;
  }
  if (name === "Button") {
    return (
      <div className="inline-flex h-7 items-center rounded-md bg-primary px-2.5 text-primary-foreground text-sm">
        保存
      </div>
    );
  }
  if (name === "Tabs") {
    return (
      <div className="flex gap-3 border-border border-b">
        <span className="border-foreground border-b-2 pb-1 text-sm">一段</span>
        <span className="pb-1 text-muted-foreground text-sm">二段</span>
      </div>
    );
  }
  if (name === "Badge") {
    return <Badge variant="secondary">进行中</Badge>;
  }
  if (name === "Input") {
    return (
      <div className="h-7 w-40 rounded-md border px-2 text-muted-foreground text-sm leading-7">
        输入
      </div>
    );
  }
  if (name === "Select") {
    return (
      <div className="inline-flex h-7 items-center rounded-md border bg-background px-2.5 text-sm">
        选项
      </div>
    );
  }
  if (name === "Frame") {
    return <div className="h-14 w-24 rounded-md border" />;
  }
  if (name === "Stack") {
    return (
      <div className="flex w-24 flex-col gap-1">
        <div className="h-3 rounded-sm bg-muted-foreground/20" />
        <div className="h-3 rounded-sm bg-muted-foreground/20" />
        <div className="h-3 w-2/3 rounded-sm bg-muted-foreground/20" />
      </div>
    );
  }
  if (name === "Artboard") {
    return (
      <div className="flex h-14 w-28 flex-col justify-between rounded-md border p-1.5">
        <p className="text-muted-foreground text-xs">K1</p>
        <div className="h-4 rounded-sm bg-muted-foreground/20" />
      </div>
    );
  }
  if (name === "Table") {
    return (
      <div className="flex w-20 flex-col gap-0.5">
        <div className="h-1.5 rounded-sm bg-muted-foreground/40" />
        <div className="h-1.5 rounded-sm bg-muted-foreground/20" />
        <div className="h-1.5 rounded-sm bg-muted-foreground/20" />
      </div>
    );
  }
  if (name === "Mermaid") {
    return (
      <div className="flex items-center gap-1">
        <div className="rounded-sm border border-status-info-border bg-info/15 px-1.5 py-0.5 text-xs">
          A
        </div>
        <div className="h-px w-4 bg-border" />
        <div className="rounded-sm border border-status-success-border bg-success/15 px-1.5 py-0.5 text-xs">
          B
        </div>
      </div>
    );
  }
  if (name === "DataChart") {
    return (
      <div className="flex h-12 items-end gap-1">
        <div className="h-5 w-2 rounded-sm bg-muted-foreground/30" />
        <div className="h-8 w-2 rounded-sm bg-muted-foreground/30" />
        <div className="h-6 w-2 rounded-sm bg-muted-foreground/30" />
        <div className="h-10 w-2 rounded-sm bg-muted-foreground/30" />
      </div>
    );
  }
  if (name === "file" || name === "git" || name === "canvasFile") {
    return null;
  }
  return <p className="font-medium text-sm">{name}</p>;
}

function MaterialCard({
  kind,
  name,
  origin,
  lead,
  path,
  selected,
}: {
  kind: Kind;
  name: string;
  origin: Origin;
  lead?: string;
  path?: string;
  selected?: boolean;
}) {
  const description = path ? fileName(path) : lead;
  const isApi = kind === "数据" || kind === "文件";
  return (
    <button
      className={
        selected
          ? "flex w-full flex-col overflow-hidden rounded-xl border bg-muted text-left outline-none ring-1 ring-ring/40 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          : "flex w-full flex-col overflow-hidden rounded-xl border border-border/60 bg-card text-left outline-none hover:border-border hover:bg-accent/30 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
      }
      type="button"
    >
      {isApi ? null : (
        <div
          aria-hidden
          className="pointer-events-none flex h-28 w-full items-center justify-center overflow-hidden border-b bg-muted/20 p-4"
          inert
        >
          <Specimen name={name} origin={origin} />
        </div>
      )}
      <div
        className={
          isApi
            ? "flex min-h-28 flex-col justify-center gap-1 p-3"
            : "flex flex-col gap-1 p-3"
        }
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium text-sm">{name}</span>
          <span className="shrink-0 text-muted-foreground text-xs">{kind}</span>
          {origin === "项目" ? (
            <Badge size="xs" variant="secondary">
              项目
            </Badge>
          ) : null}
        </div>
        {description ? (
          <p
            className={
              path
                ? "truncate font-mono text-muted-foreground text-xs"
                : "line-clamp-2 text-muted-foreground text-xs"
            }
          >
            {description}
          </p>
        ) : null}
      </div>
    </button>
  );
}

export function MaterialsList({
  filter = "全部",
  idPrefix,
  selected,
}: {
  filter?: string;
  idPrefix: string;
  selected?: string;
}) {
  const rows =
    filter === "全部" ? ALL_ROWS : ALL_ROWS.filter((row) => row.kind === filter);
  const searchId = `${idPrefix}-search`;
  const kindId = `${idPrefix}-kind`;
  return (
    <Card className="overflow-visible border border-border shadow-none ring-0">
      <CardHeader>
        <CardTitle>物料</CardTitle>
        <CardDescription>系统积木与本项目画布</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Field className="min-w-0 flex-1">
            <FieldLabel className="sr-only" htmlFor={searchId}>
              搜索物料
            </FieldLabel>
            <InputGroup>
              <InputGroupAddon>
                <svg aria-hidden fill="none" viewBox="0 0 16 16">
                  <circle
                    cx="7"
                    cy="7"
                    r="4.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                  <path
                    d="M10.5 10.5 13.5 13.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                </svg>
              </InputGroupAddon>
              <InputGroupInput
                id={searchId}
                placeholder="搜索名称，如 Button…"
                readOnly
              />
            </InputGroup>
          </Field>
          <div className="w-32 shrink-0">
            <Field>
              <FieldLabel className="sr-only" htmlFor={kindId}>
                类型
              </FieldLabel>
              <Button
                aria-label="物料类型"
                className="w-full"
                id={kindId}
                type="button"
                variant="outline"
              >
                {filter}
              </Button>
            </Field>
          </div>
        </div>
        <p className="text-muted-foreground text-xs" role="status">
          {rows.length} / {ALL_ROWS.length}
        </p>
        <div className="grid grid-cols-2 gap-3">
          {rows.map((row) => (
            <MaterialCard
              key={row.name}
              kind={row.kind}
              name={row.name}
              origin={row.origin}
              {...(row.lead ? { lead: row.lead } : {})}
              {...(row.path ? { path: row.path } : {})}
              selected={row.name === selected}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
