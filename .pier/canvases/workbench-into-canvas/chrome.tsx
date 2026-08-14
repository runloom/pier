import { Badge, Button, Input, Row, Text } from "pier/canvas";
import type { CSSProperties, ReactNode } from "react";

export const STAGE: CSSProperties = {
  background: "var(--background)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  overflow: "hidden",
};

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

const PROJECT_TABS = ["环境", "技能", "MCP", "常规"] as const;

export function Screen({
  id,
  title,
  spec,
  children,
}: {
  id: string;
  title: string;
  spec: string;
  children: ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Row gap={8} wrap>
        <Badge variant="outline">{id}</Badge>
        <Text as="h3" className="text-sm font-medium">
          {title}
        </Text>
      </Row>
      <Text tone="secondary" className="text-sm leading-relaxed">
        {spec}
      </Text>
      <div style={STAGE}>{children}</div>
    </div>
  );
}

/** Settings dialog: left nav + project detail. Matches current Pier chrome. */
export function SettingsProjectFrame({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "9.5rem 1fr" }}>
      <div
        style={{
          borderRight: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          gap: 2,
          padding: "8px 6px",
        }}
      >
        <Text tone="tertiary" className="px-2 pb-1 text-xs">
          设置
        </Text>
        {SETTINGS_NAV.map((item) => (
          <div
            key={item}
            style={{
              background: item === "项目" ? "var(--muted)" : undefined,
              borderRadius: 6,
              fontSize: 12,
              padding: "6px 8px",
            }}
          >
            {item}
          </div>
        ))}
      </div>
      <div style={{ minWidth: 0, padding: "12px 14px 14px" }}>
        <div
          style={{
            alignItems: "center",
            display: "flex",
            gap: 8,
            marginBottom: 4,
          }}
        >
          <Text tone="tertiary" className="text-xs">
            ←
          </Text>
          <Text className="text-sm font-medium">pier</Text>
          <Badge variant="secondary">当前</Badge>
        </div>
        <Text tone="tertiary" className="mb-3 block text-xs">
          /Users/sheep/Xyz/pier
        </Text>
        <Row gap={12}>
          {PROJECT_TABS.map((item) => (
            <Text
              key={item}
              className="text-xs"
              tone={item === "常规" ? "default" : "tertiary"}
            >
              {item}
            </Text>
          ))}
        </Row>
        <div
          style={{
            borderBottom: "1px solid var(--border)",
            margin: "6px 0 12px",
          }}
        />
        {children}
      </div>
    </div>
  );
}

export function ExistingCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div style={{ ...STAGE, opacity: 0.55, padding: "12px 14px" }}>
      <Row gap={8}>
        <Text className="text-sm font-medium">{title}</Text>
        <Badge variant="outline">已有</Badge>
      </Row>
      <Text tone="secondary" className="mt-1 text-xs leading-relaxed">
        {description}
      </Text>
      {children}
    </div>
  );
}

export function DialogChrome({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div
      style={{
        background:
          "color-mix(in oklab, var(--foreground) 18%, transparent)",
        padding: 24,
      }}
    >
      <div
        style={{
          ...STAGE,
          margin: "0 auto",
          maxWidth: 420,
        }}
      >
        <div style={{ padding: "16px 20px 0" }}>
          <Text className="text-base font-medium">{title}</Text>
          <Text tone="secondary" className="mt-1 text-sm leading-relaxed">
            {description}
          </Text>
        </div>
        <div style={{ padding: "16px 20px" }}>{children}</div>
        <div
          style={{
            borderTop: "1px solid var(--border)",
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
            padding: "10px 20px 12px",
          }}
        >
          {footer}
        </div>
      </div>
    </div>
  );
}

export function PaletteChrome({
  query,
  children,
}: {
  query: string;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        background:
          "color-mix(in oklab, var(--foreground) 18%, transparent)",
        padding: 28,
      }}
    >
      <div style={{ ...STAGE, margin: "0 auto", maxWidth: 440 }}>
        <div style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>
          <Input aria-label="搜索命令" defaultValue={query} />
        </div>
        {children}
      </div>
    </div>
  );
}

export function FooterPair({ primary }: { primary: string }) {
  return (
    <>
      <Button type="button" variant="outline">
        取消
      </Button>
      <Button type="button">{primary}</Button>
    </>
  );
}
