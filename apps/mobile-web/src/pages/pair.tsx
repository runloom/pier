/**
 * H0 配对页：粘贴 QR payload JSON +（BarcodeDetector 存在时）相机扫码。
 * 载荷经 pairingQrPayloadSchema 解析；POST http://<host>:<port>/pair 换取
 * { deviceId, deviceToken } 存 localStorage 后跳主机列表。
 */

import { DEFAULT_CAPABILITIES_BY_CLIENT_KIND } from "@shared/contracts/permissions.ts";
import {
  type PairingFailureReason,
  pairingFailureReasonSchema,
  pairingQrPayloadSchema,
  pairingRedeemResultSchema,
} from "@shared/contracts/remote.ts";
import { useEffect, useRef, useState } from "react";
import { TopBar } from "../components/top-bar.tsx";
import { type StoredHost, saveHost } from "../lib/paired-hosts.ts";
import { redeemViaRelay } from "../lib/relay-api.ts";
import { navigate } from "../lib/routes.ts";

/** mobile-paired 客户端种类的默认能力集全列（单一来源 @shared，勿手抄清单）。 */
const REQUESTED_CAPABILITIES =
  DEFAULT_CAPABILITIES_BY_CLIENT_KIND["mobile-paired"];

const FAILURE_REASON_TEXT: Record<PairingFailureReason, string> = {
  pairing_expired: "配对码已过期，请在桌面端重新生成二维码",
  pairing_invalid: "配对码无效，请重新扫码或粘贴",
};

interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}

type BarcodeDetectorCtor = new (options?: {
  formats?: string[];
}) => BarcodeDetectorLike;

function barcodeDetectorCtor(): BarcodeDetectorCtor | null {
  const ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor })
    .BarcodeDetector;
  return ctor ?? null;
}

export function PairPage() {
  const [payloadText, setPayloadText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detector = barcodeDetectorCtor();

  const stopScan = () => {
    for (const track of streamRef.current?.getTracks() ?? []) {
      track.stop();
    }
    streamRef.current = null;
    setScanning(false);
  };

  useEffect(
    () => () => {
      for (const track of streamRef.current?.getTracks() ?? []) {
        track.stop();
      }
    },
    []
  );

  const submit = async (text: string) => {
    setError(null);
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      setError("内容不是有效的 JSON，请粘贴二维码中的完整文本");
      return;
    }
    const payload = pairingQrPayloadSchema.safeParse(raw);
    if (!payload.success) {
      setError("二维码内容不符合 Pier 配对载荷格式");
      return;
    }
    // 会合路径：QR 带 relayHint + hostId + pairSecret → 密封赎回，可跨网。
    if (
      payload.data.relayHint !== null &&
      payload.data.hostId !== undefined &&
      payload.data.pairSecret !== undefined
    ) {
      await submitViaRelay(payload.data.relayHint, {
        fingerprint: payload.data.fingerprint,
        host: payload.data.host,
        hostId: payload.data.hostId,
        pairingCode: payload.data.pairingCode,
        pairSecret: payload.data.pairSecret,
        port: payload.data.port,
      });
      return;
    }
    const host = payload.data.host ?? window.location.hostname;
    if (payload.data.port === undefined) {
      setError("配对载荷缺少端口，无法连接宿主机");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`http://${host}:${payload.data.port}/pair`, {
        body: JSON.stringify({
          code: payload.data.pairingCode,
          name: navigator.userAgent.slice(0, 64),
          requestedCapabilities: REQUESTED_CAPABILITIES,
          shell: "web",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (response.ok) {
        const result = pairingRedeemResultSchema.parse(await response.json());
        const record: StoredHost = {
          deviceToken: result.deviceToken,
          deviceId: result.deviceId,
          host,
          pairedAt: Date.now(),
          port: payload.data.port,
        };
        saveHost(record);
        navigate({ page: "hosts" });
        return;
      }
      const body: unknown = await response.json().catch(() => null);
      const reason = pairingFailureReasonSchema.safeParse(
        (body as { reason?: unknown } | null)?.reason
      );
      setError(
        reason.success
          ? FAILURE_REASON_TEXT[reason.data]
          : `配对失败（HTTP ${response.status}）`
      );
    } catch {
      setError(`无法连接宿主机 ${host}:${payload.data.port}`);
    } finally {
      setBusy(false);
    }
  };

  const submitViaRelay = async (
    relayUrl: string,
    qr: {
      fingerprint: string;
      host: string | undefined;
      hostId: string;
      pairingCode: string;
      pairSecret: string;
      port: number | undefined;
    }
  ) => {
    setBusy(true);
    try {
      const outcome = await redeemViaRelay({
        fingerprint: qr.fingerprint,
        hostId: qr.hostId,
        pairSecret: qr.pairSecret,
        relayUrl,
        request: {
          code: qr.pairingCode,
          name: navigator.userAgent.slice(0, 64),
          requestedCapabilities: [...REQUESTED_CAPABILITIES],
          shell: "web",
        },
      });
      if (!outcome.ok) {
        const known = pairingFailureReasonSchema.safeParse(outcome.reason);
        setError(
          known.success
            ? FAILURE_REASON_TEXT[known.data]
            : `配对失败（${outcome.reason}）`
        );
        return;
      }
      // relay 宿主用 hostId 作稳定键；host/port 仅展示占位（连接走会合）。
      const record: StoredHost = {
        deviceId: outcome.deviceId,
        deviceToken: outcome.deviceToken,
        fingerprint: qr.fingerprint,
        host: qr.host ?? new URL(relayUrl).hostname,
        hostId: qr.hostId,
        pairedAt: Date.now(),
        // relay 宿主 port 仅展示占位（连接走 relayUrl + hostId）；443 满足
        // storedHostSchema 的 positive 约束，稳定键用 hostId 不受其影响。
        port: qr.port ?? 443,
        relayUrl,
      };
      saveHost(record);
      navigate({ page: "hosts" });
    } catch {
      setError("无法经远程连接完成配对，请稍后重试");
    } finally {
      setBusy(false);
    }
  };

  const startScan = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      setScanning(true);
      const video = videoRef.current;
      const DetectorCtor = barcodeDetectorCtor();
      const detectorInstance =
        DetectorCtor === null
          ? null
          : new DetectorCtor({ formats: ["qr_code"] });
      if (video === null || detectorInstance === null) {
        return;
      }
      video.srcObject = stream;
      await video.play();
      const timer = setInterval(() => {
        detectorInstance
          .detect(video)
          .then((codes) => {
            const first = codes[0];
            if (first !== undefined && first.rawValue.length > 0) {
              clearInterval(timer);
              stopScan();
              setPayloadText(first.rawValue);
              submit(first.rawValue).catch(() => undefined);
            }
          })
          .catch(() => {});
      }, 400);
    } catch {
      setError("相机不可用，请改为粘贴二维码内容");
      stopScan();
    }
  };

  return (
    <div className="flex min-h-dvh flex-col bg-neutral-950 text-neutral-100">
      <TopBar back={{ page: "hosts" }} title="添加设备" />
      <main className="flex-1 px-4 py-4">
        <p className="mb-3 text-neutral-400 text-xs">
          在桌面端「设置 ·
          远程访问」生成配对码：用系统相机扫二维码后复制文本粘贴到下方，或点桌面端「复制配对内容」把文本发到手机。
        </p>
        <textarea
          className="mb-3 h-40 w-full rounded border border-neutral-700 bg-neutral-900 p-2 font-mono text-xs"
          data-testid="pair-payload-input"
          onChange={(event) => {
            setPayloadText(event.target.value);
          }}
          placeholder="粘贴配对内容（一段 JSON 文本）"
          value={payloadText}
        />
        {error !== null && (
          <p
            className="mb-3 text-red-400 text-xs"
            data-testid="pair-error"
            role="alert"
          >
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <button
            className="flex-1 rounded bg-emerald-600 py-2 text-center text-sm text-white disabled:opacity-50"
            data-testid="pair-submit"
            disabled={busy || payloadText.trim().length === 0}
            onClick={() => {
              submit(payloadText).catch(() => undefined);
            }}
            type="button"
          >
            {busy ? "配对中…" : "配对"}
          </button>
          {detector !== null && !scanning && (
            <button
              className="rounded border border-neutral-600 px-4 py-2 text-sm"
              data-testid="pair-scan"
              onClick={() => {
                startScan().catch(() => undefined);
              }}
              type="button"
            >
              相机扫码
            </button>
          )}
        </div>
        {scanning && (
          <div className="mt-4">
            <video
              className="w-full rounded border border-neutral-700"
              data-testid="pair-video"
              muted
              playsInline
              ref={videoRef}
            />
            <button
              className="mt-2 text-neutral-400 text-xs"
              onClick={stopScan}
              type="button"
            >
              取消扫码
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
