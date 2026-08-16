import { Badge, Tabs, TabsList, TabsTrigger } from "pier/canvas";
import type { ReactNode } from "react";

const SETTINGS_NAV = [
  "外观",
  "终端",
  "快捷键",
  "智能体",
  "通知",
  "项目",
  "工作区",
  "插件",
  "更新",
] as const;

export function SettingsChrome({
  children,
  project = "feat-canvas-20260815",
}: {
  children: ReactNode;
  project?: string;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="shrink-0 border-b px-6 py-3">
        <h2 className="font-medium text-base leading-none">设置</h2>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[10rem_1fr]">
        <nav className="min-h-0 overflow-y-auto border-r p-2">
          <div className="flex flex-col gap-0.5">
            {SETTINGS_NAV.map((name) => (
              <div
                className={
                  name === "项目"
                    ? "rounded-md bg-muted px-2 py-1.5 text-sm font-medium"
                    : "rounded-md px-2 py-1.5 text-sm text-muted-foreground"
                }
                key={name}
              >
                {name}
              </div>
            ))}
          </div>
        </nav>
        <div className="flex min-h-0 min-w-0 flex-col px-4 pb-3">
          <div className="flex min-w-0 items-center gap-2 pt-3 pb-2">
            <h1 className="min-w-0 truncate text-xl">{project}</h1>
            <Badge variant="secondary">当前</Badge>
          </div>
          <p className="truncate pb-3 text-muted-foreground text-xs">
            /Users/xyz/ABC/{project}
          </p>
          <Tabs className="gap-1" value="materials">
            <TabsList className="gap-3" variant="line">
              <TabsTrigger value="environment">环境</TabsTrigger>
              <TabsTrigger value="skills">技能</TabsTrigger>
              <TabsTrigger value="mcp">MCP</TabsTrigger>
              <TabsTrigger value="general">常规</TabsTrigger>
              <TabsTrigger value="materials">物料</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden pt-3">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
