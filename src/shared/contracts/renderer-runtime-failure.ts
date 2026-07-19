export const RENDERER_RUNTIME_FAILURE_LIMITS = {
  componentStack: 8000,
  message: 2000,
  name: 128,
  stack: 12_000,
} as const;

export interface RendererRuntimeFailureReport {
  componentStack?: string;
  message: string;
  name: string;
  stack?: string;
}

function boundedString(
  value: unknown,
  maxLength: number,
  required: boolean
): string | undefined {
  if (typeof value !== "string") {
    return;
  }
  const normalized = value.trim();
  if (required && normalized.length === 0) {
    return;
  }
  return normalized.slice(0, maxLength);
}

/**
 * Renderer 是可信宿主代码，但故障对象仍须在 IPC 边界限长，避免异常递归或超长
 * 组件树把主进程诊断日志撑爆。未知字段不进入日志。
 */
export function parseRendererRuntimeFailureReport(
  value: unknown
): RendererRuntimeFailureReport | null {
  if (!(value && typeof value === "object")) {
    return null;
  }
  const name = boundedString(
    Reflect.get(value, "name"),
    RENDERER_RUNTIME_FAILURE_LIMITS.name,
    true
  );
  const message = boundedString(
    Reflect.get(value, "message"),
    RENDERER_RUNTIME_FAILURE_LIMITS.message,
    true
  );
  if (!(name && message)) {
    return null;
  }
  const stack = boundedString(
    Reflect.get(value, "stack"),
    RENDERER_RUNTIME_FAILURE_LIMITS.stack,
    false
  );
  const componentStack = boundedString(
    Reflect.get(value, "componentStack"),
    RENDERER_RUNTIME_FAILURE_LIMITS.componentStack,
    false
  );
  return {
    message,
    name,
    ...(stack ? { stack } : {}),
    ...(componentStack ? { componentStack } : {}),
  };
}
