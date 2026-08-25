import type { PierCapability } from "@shared/contracts/permissions.ts";
import {
  BRIDGE_PROTOCOL_VERSION,
  type BridgeFrame,
  type BridgeMethodDescriptor,
} from "@shared/contracts/plugin/bridge.ts";
import { useEffect, useMemo, useRef } from "react";
import { SandboxBridge } from "./bridge.ts";

/**
 * 沙箱轨 iframe 容器（Phase 2 M2）。
 *
 * - `sandbox="allow-scripts"` 且**无** `allow-same-origin` ⇒ opaque origin，
 *   插件无法触达宿主 DOM / storage / window.pier。
 * - srcdoc 引导脚本持一次性令牌，回带令牌的帧才被桥接受。
 * - 上行只允许字符串帧；下行经 contentWindow.postMessage（opaque origin 下
 *   targetOrigin 只能为 "*"，接收方靠令牌鉴别——这是该模型的既定边界）。
 */
export interface SandboxIframeHostProps {
  allowedChannels: readonly string[];
  /** 已验签插件包内的 renderer 入口 URL。 */
  bundleUrl: string;
  grantedCapabilities: readonly PierCapability[];
  methods: ReadonlyMap<string, BridgeMethodDescriptor>;
  onFrozen?: (reason: string) => void;
  pluginId: string;
  title: string;
  /** 缺省时每次挂载自动生成一次性令牌。 */
  token?: string;
}

/** CSP source-list tokens must not contain whitespace or `;`, `,`. */
export function sandboxBundleCspSource(bundleUrl: string): string | null {
  if (bundleUrl.length === 0 || /[\s;,<>"'\\]/u.test(bundleUrl)) {
    return null;
  }
  return bundleUrl;
}

export function buildSandboxDocumentCsp(bundleUrl: string): string {
  const bundleSource = sandboxBundleCspSource(bundleUrl);
  const scriptSrc = bundleSource
    ? `'unsafe-inline' ${bundleSource}`
    : "'unsafe-inline'";
  return `default-src 'none'; script-src ${scriptSrc}; connect-src 'none'`;
}

export function isSandboxSrcDocHref(href: string): boolean {
  return href === "" || href === "about:srcdoc" || href === "about:blank";
}

export function buildSandboxSrcDoc(input: {
  token: string;
  bundleUrl: string;
}): string {
  const bundleUrl = JSON.stringify(input.bundleUrl);
  const csp = buildSandboxDocumentCsp(input.bundleUrl);
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="${csp}">
</head>
<body>
<div id="pier-sandbox-root"></div>
<script>
(() => {
  const TOKEN = ${JSON.stringify(input.token)};
  const PROTO = ${BRIDGE_PROTOCOL_VERSION};
  let seq = 1;
  const pending = new Map();
  const listeners = new Map();
  function rawSend(frame) {
    try { window.parent.postMessage(JSON.stringify({ ...frame, token: TOKEN }), "*"); } catch {}
  }
  window.__PIER_SANDBOX_BRIDGE__ = {
    send: rawSend,
    token: TOKEN,
  };
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    let frame;
    try { frame = JSON.parse(String(event.data)); } catch { return; }
    if (frame.t === "event") {
      for (const cb of listeners.get(frame.channel) ?? []) cb(frame.payload);
      return;
    }
    if (frame.t === "result") {
      const pendingCall = pending.get(frame.id);
      if (!pendingCall) return;
      pending.delete(frame.id);
      if (frame.ok) pendingCall.resolve(frame.data);
      else pendingCall.reject(Object.assign(new Error(frame.error.message), { code: frame.error.code }));
    }
  });
  rawSend({ t: "hello", proto: PROTO });
  window.pierSandbox = {
    call(method, params) {
      const id = seq += 1;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        rawSend({ id, method, params: params ?? null, t: "call" });
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            reject(new Error("call timed out"));
          }
        }, 10_000);
      });
    },
    subscribe(channel, cb) {
      const list = listeners.get(channel) ?? [];
      list.push(cb);
      listeners.set(channel, list);
      rawSend({ channel, t: "subscribe" });
      return () => {
        listeners.set(channel, (listeners.get(channel) ?? []).filter((x) => x !== cb));
      };
    },
  };
  const script = document.createElement("script");
  script.src = ${bundleUrl};
  document.body.append(script);
})();
</script>
</body>
</html>`;
}

function generateBridgeToken(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `tok_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function SandboxIframeHost(
  props: SandboxIframeHostProps
): React.ReactNode {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const token = useMemo(
    () => props.token ?? generateBridgeToken(),
    [props.token]
  );
  const srcDoc = useMemo(
    () => buildSandboxSrcDoc({ bundleUrl: props.bundleUrl, token }),
    [props.bundleUrl, token]
  );

  const documentCsp = useMemo(
    () => buildSandboxDocumentCsp(props.bundleUrl),
    [props.bundleUrl]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: bridge lifecycle is keyed by token; other props are mount-time constants
  useEffect(() => {
    const iframe = iframeRef.current;
    const bridge = new SandboxBridge({
      allowedChannels: props.allowedChannels,
      grantedCapabilities: props.grantedCapabilities,
      methods: props.methods,
      onAudit: (event) => {
        const reporter = window.pier?.managedPlugins.reportSandboxAudit;
        if (!reporter) {
          return;
        }
        // 审计落档失败不面向用户（与 renderer activation report 同路径）。
        reporter({
          detail: event.detail,
          event: event.event,
          pluginId: props.pluginId,
        }).catch(() => undefined);
      },
      onFrozen: (reason) => props.onFrozen?.(reason),
      pluginId: props.pluginId,
      send: (frame: BridgeFrame) => {
        // opaque origin 下 targetOrigin 仅能为 "*"；接收方以令牌鉴别。
        iframeRef.current?.contentWindow?.postMessage(
          JSON.stringify(frame),
          "*"
        );
      },
      token,
    });

    function onMessage(event: MessageEvent): void {
      if (event.source !== iframeRef.current?.contentWindow) return;
      bridge.handleIncoming(event.data);
    }
    function onIframeLoad(): void {
      if (!iframe) {
        return;
      }
      try {
        const href = iframe.contentWindow?.location.href ?? "";
        if (isSandboxSrcDocHref(href)) {
          return;
        }
      } catch {
        // Cross-origin after self-navigation: contentWindow.location is opaque.
      }
      bridge.freezeFromHost("iframe navigated");
    }
    window.addEventListener("message", onMessage);
    iframe?.addEventListener("load", onIframeLoad);
    iframe?.setAttribute("csp", documentCsp);
    return () => {
      window.removeEventListener("message", onMessage);
      iframe?.removeEventListener("load", onIframeLoad);
      bridge.dispose();
    };
    // 桥生命周期绑定 token（每次挂载/换代新建）；其余 props 视为挂载期常量。
  }, [props.token]);

  return (
    <iframe
      ref={iframeRef}
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      style={{ border: "none", height: "100%", width: "100%" }}
      title={props.title}
    />
  );
}
