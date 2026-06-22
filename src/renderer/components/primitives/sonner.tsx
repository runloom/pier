// @ts-nocheck — vendored shadcn radix-nova: 与 tsconfig exactOptionalPropertyTypes:true 不兼容。
// 注意: 此组件用 next-themes 的 useTheme(); 项目 theme source-of-truth 是
// stores/theme.store.ts (走 documentElement.classList)。实际接入 Sonner 时
// 需要把这里改成订阅 theme store, 否则 toast 主题永远是 next-themes 默认值。
"use client";

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      theme={theme as ToasterProps["theme"]}
      toastOptions={{
        classNames: {
          toast: "cn-toast app-no-drag",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
